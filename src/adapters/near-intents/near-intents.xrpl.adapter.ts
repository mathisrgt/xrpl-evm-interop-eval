import { OneClickService, OpenAPI, QuoteRequest } from "@defuse-protocol/one-click-sdk-typescript";
import { Client, Payment, dropsToXrp, xrpToDrops } from "xrpl";
import type { ChainAdapter, GasRefundOutput, RunContext, SourceOutput, TargetOutput } from "../../types";
import { NEAR_INTENTS_TOKEN_IDS } from "../../utils/constants";
import { ONE_CLICK_JWT, getXrplWallet } from "../../utils/environment";

export const xrplAdapter: ChainAdapter = {

    async prepare(ctx: RunContext) {
        const client = new Client(ctx.cfg.networks.xrpl.wsUrl);
        await client.connect();

        const wallet = getXrplWallet();
        ctx.cache.xrpl = { client, wallet };
        ctx.cleaner.trackXrpl(client, wallet.address);
    },

    async submit(ctx: RunContext): Promise<SourceOutput> {
        const { client, wallet } = ctx.cache.xrpl!;
        const { account: evmAccount } = ctx.cache.evm!;
        
        if (!client || !wallet || !evmAccount) {
            throw new Error("XRPL or EVM not prepared");
        }

        OpenAPI.BASE = 'https://1click.chaindefuser.com';
        OpenAPI.TOKEN = ONE_CLICK_JWT;

        console.log(`\n📋 Near Intents Quote Request:`);
        console.log(`   Origin: XRP on XRPL → Destination: USDC on Base`);
        console.log(`   Amount: ${ctx.cfg.xrpAmount} XRP`);
        console.log(`   Recipient (Base): ${evmAccount.address}`);
        console.log(`   Refund To (XRPL): ${wallet.address}`);

        const quoteRequest: QuoteRequest = {
            dry: false,
            swapType: QuoteRequest.swapType.EXACT_INPUT,
            slippageTolerance: 100,
            originAsset: NEAR_INTENTS_TOKEN_IDS.XRP_ON_XRPL,
            depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
            destinationAsset: NEAR_INTENTS_TOKEN_IDS.USDC_ON_BASE,
            amount: xrpToDrops(ctx.cfg.xrpAmount),
            refundTo: wallet.address,
            refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
            recipient: evmAccount.address,
            recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
            deadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
            referral: "xrpl-evm-interop-eval",
            quoteWaitingTimeMs: 3000,
        };

        // Retry logic for getting quote (max 3 attempts)
        let quote;
        let lastError;
        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`\n🔄 Quote attempt ${attempt}/${maxRetries}...`);
                quote = await OneClickService.getQuote(quoteRequest);
                console.log(`✅ Quote obtained successfully`);
                break; // Success, exit retry loop
            } catch (error: any) {
                lastError = error;
                console.log(`❌ Quote attempt ${attempt}/${maxRetries} failed: ${error.message || error}`);

                if (attempt < maxRetries) {
                    const waitTime = attempt * 2000; // Exponential backoff: 2s, 4s
                    console.log(`⏳ Waiting ${waitTime/1000}s before retry...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                } else {
                    console.log(`❌ All ${maxRetries} quote attempts failed`);
                    throw new Error(`Failed to get Near Intents quote after ${maxRetries} attempts: ${error.message || error}`);
                }
            }
        }

        if (!quote) {
            throw new Error(`Failed to get Near Intents quote: ${lastError?.message || 'Unknown error'}`);
        }

        if (!quote.quote?.depositAddress) {
            throw new Error("No deposit address in quote");
        }

        if (!ctx.cache.xrpl) {
            throw new Error("No xrpl environment in cache");
        }

        const depositAddress = quote.quote?.depositAddress;
        ctx.cache.xrpl.depositAddress = depositAddress;

        console.log(`\n✅ Near Intents Quote Received:`);
        console.log(`   Deposit Address (XRPL): ${depositAddress}`);
        console.log(`   Deadline: ${new Date(Date.now() + 3 * 60 * 1000).toISOString()}`);

        const tx: Payment = {
            TransactionType: "Payment",
            Account: wallet.address,
            Destination: depositAddress,
            Amount: xrpToDrops(ctx.cfg.xrpAmount),
        };

        const submittedAt = Date.now();
        const res = await client.submitAndWait(tx, { autofill: true, wallet });

        if (!res.result.validated) {
            const code = (res.result as any).engine_result || "unknown";
            throw new Error(`XRPL submit failed: ${code}`);
        }

        const engineResult = (res.result as any).engine_result || (res.result as any).meta?.TransactionResult;
        if (engineResult !== "tesSUCCESS") {
            throw new Error(`XRPL transaction failed: ${engineResult}`);
        }

        const txHash = res.result.hash!;
        const txFee = Number(dropsToXrp(res.result.tx_json.Fee || "0"));

        // For near-intents XRPL→Base, we send XRP but track the USD value
        // The xrpAmount field represents the expected USD value on the destination
        return { xrpAmount: ctx.cfg.xrpAmount, txHash, submittedAt, txFee, currency: 'USD' };
    },

    async observe(ctx: RunContext): Promise<TargetOutput> {
        const { client, wallet, depositAddress } = ctx.cache.xrpl!;
        if (!client || !wallet) throw new Error("XRPL not prepared");

        console.log(`🔍 Watching for XRP payments TO ${wallet.address} on XRPL`);
        if (depositAddress) {
            console.log(`   Excluding payments FROM deposit address: ${depositAddress}`);
        }

        return await new Promise<TargetOutput>((resolve, reject) => {
            let finished = false;

            const resolveOnce = (v: TargetOutput) => {
                if (finished) return;
                finished = true;
                try { clearTimeout(timeoutId); } catch { }
                try { client.off("transaction", onTx); } catch { }
                resolve(v);
            };

            const rejectOnce = (e: unknown) => {
                if (finished) return;
                finished = true;
                try { clearTimeout(timeoutId); } catch { }
                try { client.off("transaction", onTx); } catch { }
                reject(e instanceof Error ? e : new Error(String(e)));
            };

            const timeoutId = setTimeout(() => {
                rejectOnce(new Error("Timeout: Near Intents execution not completed"));
            }, 10 * 60_000);
            ctx.cleaner.trackTimer(timeoutId);

            const onTx = (data: any) => {
                try {
                    if (!data?.validated) return;

                    const tx = data?.tx_json;
                    const meta = data?.meta;
                    if (!tx || tx.TransactionType !== "Payment") return;
                    if (tx.Destination !== wallet.address) return;

                    // Exclude payments FROM the deposit address (our outgoing payment)
                    if (depositAddress && tx.Account === depositAddress) {
                        console.log(`   Skipping outgoing payment to deposit address in tx ${data.hash}`);
                        return;
                    }

                    const deliveredXrp = Number(dropsToXrp(meta?.delivered_amount));
                    const txFeeXrp = Number(dropsToXrp(tx.Fee));
                    const finalizedAt = Date.now();

                    console.log(`✅ Found incoming XRP payment!`);
                    console.log(`   From: ${tx.Account}`);
                    console.log(`   Amount: ${deliveredXrp} XRP`);
                    console.log(`   Tx: ${data.hash}`);

                    // For near-intents Base→XRPL, we receive XRP
                    // But we track as USD for consistency in metrics
                    resolveOnce({
                        xrpAmount: deliveredXrp,
                        txHash: data.hash,
                        finalizedAt,
                        txFee: txFeeXrp,
                        currency: 'USD',
                    } as TargetOutput);
                } catch (err) {
                    rejectOnce(err);
                }
            };

            client.on("transaction", onTx);

            client.request({ command: "subscribe", accounts: [wallet.address] })
                .then(() => {
                    console.log(`   Subscribed to real-time transaction stream`);
                    ctx.cleaner.add(async () => {
                        try { client.off("transaction", onTx); } catch { }
                        try {
                            await client.request({ command: "unsubscribe", accounts: [wallet.address] });
                        } catch { }
                    });
                })
                .catch((err: unknown) => {
                    rejectOnce(err);
                });
        });
    },

    async observeGasRefund(ctx: RunContext): Promise<GasRefundOutput> {
        return { xrpAmount: 0, txHash: "n/a" };
    }
};
