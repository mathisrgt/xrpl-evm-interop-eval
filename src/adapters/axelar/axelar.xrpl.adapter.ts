import { Client, Payment, Wallet, convertStringToHex, dropsToXrp, xrpToDrops } from "xrpl";
import type { ChainAdapter, RunContext, SourceOutput, TargetOutput, GasRefundOutput } from "../../types";
import chalk from "chalk";
import axios from "axios";
import { SQUID_INTEGRATOR_ID } from "../../utils/environment";

// Helper to get token address format
function getTokenAddress(chainId: string, tokenAddress: string): string {
    if (chainId === 'xrpl-mainnet') {
        if (tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
            return 'xrp';
        }
    }
    return tokenAddress;
}

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export const xrplAdapter: ChainAdapter = {

    /** Prepare the client, wallet, and Squid route */
    async prepare(ctx: RunContext) {
        const client = new Client(ctx.cfg.networks.xrpl.wsUrl);
        await client.connect();

        const wallet = Wallet.fromSeed(ctx.cfg.networks.xrpl.walletSeed);
        ctx.cache.xrpl = { client, wallet };
        ctx.cleaner.trackXrpl(client, wallet.address);

        // Get EVM account for toAddress
        const { account } = ctx.cache.evm!;
        if (!account) throw new Error("EVM not prepared - run EVM prepare first");

        // Prepare Squid route parameters
        const fromChainId = 'xrpl-mainnet';
        const toChainId = '1440000'; // XRPL-EVM
        const fromToken = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
        const toToken = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
        const fromAmount = xrpToDrops(ctx.cfg.xrpAmount); // Convert XRP to drops

        const formattedFromToken = getTokenAddress(fromChainId, fromToken);
        const formattedToToken = getTokenAddress(toChainId, toToken);

        const params = {
            fromAddress: wallet.address,
            fromChain: fromChainId,
            fromToken: formattedFromToken,
            fromAmount,
            toChain: toChainId,
            toToken: formattedToToken,
            toAddress: account.address,
            quoteOnly: false
        };

        console.log(chalk.cyan('🔍 Getting Squid route...'));

        let retries = 3;
        while (retries > 0) {
            try {
                const result = await axios.post(
                    "https://v2.api.squidrouter.com/v2/route",
                    params,
                    {
                        headers: {
                            "x-integrator-id": SQUID_INTEGRATOR_ID,
                            "Content-Type": "application/json",
                        },
                    }
                );

                const requestId = result.headers["x-request-id"];
                ctx.cache.squid = {
                    route: result.data.route,
                    requestId
                };

                console.log(chalk.green('✓ Squid route obtained'));
                return;
            } catch (error: any) {
                if (error.response?.status === 429 && retries > 1) {
                    console.log(chalk.yellow(`Rate limited, waiting 3s... (${retries - 1} retries left)`));
                    await delay(3000);
                    retries--;
                } else {
                    if (error.response) {
                        console.error(chalk.red("Squid API error:"), error.response.data);
                    }
                    throw error;
                }
            }
        }

        throw new Error('Failed to get Squid route after retries');
    },

    /** Submit XRPL Payment using Squid route */
    async submit(ctx: RunContext): Promise<SourceOutput> {
        const { client, wallet } = ctx.cache.xrpl!;
        const { route } = ctx.cache.squid!;

        if (!client || !wallet) throw new Error("XRPL not prepared");
        if (!route) throw new Error("Squid route not prepared");

        // Get the payment transaction from Squid route
        const payment = route.transactionRequest.data;

        console.log(chalk.cyan('📤 Submitting XRPL transaction...'));
        console.log(chalk.dim(`Destination: ${payment.Destination}`));
        console.log(chalk.dim(`Amount: ${dropsToXrp(payment.Amount)} XRP`));

        const submittedAt = Date.now();

        // Sign and submit the transaction
        const prepared = await client.autofill(payment);
        const signed = wallet.sign(prepared);
        const res = await client.submitAndWait(signed.tx_blob);

        if (!res.result.validated) {
            const code = (res.result as any).engine_result || "unknown";
            throw new Error(`XRPL submit failed: ${code}`);
        }

        const engineResult = (res.result as any).engine_result || (res.result as any).meta?.TransactionResult;
        if (engineResult !== "tesSUCCESS") {
            console.error(chalk.red(`Transaction validated but failed with code: ${engineResult}`));
            console.error(chalk.dim(`TX Hash: ${res.result.hash}`));
            console.error(chalk.dim(`Fee charged: ${dropsToXrp(res.result.tx_json.Fee || "0")} XRP`));

            throw new Error(`XRPL transaction failed: ${engineResult}`);
        }

        const txHash = res.result.hash!;
        const txFee = Number(dropsToXrp(res.result.tx_json.Fee || "0"));

        console.log(chalk.green(`✓ XRPL transaction submitted`));
        console.log(chalk.dim(`TX Hash: ${txHash}`));
        console.log(chalk.dim(`Explorer: https://livenet.xrpl.org/transactions/${txHash}`));

        return { xrpAmount: ctx.cfg.xrpAmount, txHash, submittedAt, txFee };
    },

    /** Monitor the incoming transaction on the blockchain */
    async observe(ctx: RunContext): Promise<TargetOutput> {
        const { client, wallet } = ctx.cache.xrpl ?? {};
        if (!client || !wallet) throw new Error("XRPL not prepared");

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
                rejectOnce(new Error("⌛️ Timeout: no matching payment on XRPL"));
            }, 10 * 60_000);
            ctx.cleaner.trackTimer(timeoutId);

            const onTx = (data: any) => {
                try {
                    if (!data?.validated) return;

                    const tx = data?.tx_json;
                    const meta = data?.meta;
                    if (!tx || tx.TransactionType !== "Payment") return;
                    if (tx.Destination !== wallet.address) return;

                    const deliveredXrp = Number(dropsToXrp(meta?.delivered_amount));
                    const txFeeXrp = Number(dropsToXrp(tx.Fee));
                    const finalizedAt = Date.now();

                    resolveOnce({
                        xrpAmount: deliveredXrp,
                        txHash: data.hash,
                        finalizedAt,
                        txFee: txFeeXrp,
                    } as TargetOutput);
                } catch (err) {
                    rejectOnce(err);
                }
            };

            client.on("transaction", onTx);

            client.request({ command: "subscribe", accounts: [wallet.address] })
                .then(() => {
                    console.log(`🔍 Monitoring transactions for ${wallet.address}`);
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

    /** 
     * Monitor the gas refund transaction from the bridge refunder contract
     * This runs after the main bridge transfer is complete
     */
    async observeGasRefund(ctx: RunContext): Promise<GasRefundOutput> {
        const { client, wallet } = ctx.cache.xrpl!;
        if (!client || !wallet) throw new Error("XRPL not prepared");

        return await new Promise<GasRefundOutput>((resolve, reject) => {
            let finished = false;

            const resolveOnce = (v: GasRefundOutput) => {
                if (finished) return;
                finished = true;
                try { clearTimeout(timeoutId); } catch { }
                try { client.off("transaction", onRefundTx); } catch { }
                resolve(v);
            };

            const rejectOnce = (e: unknown) => {
                if (finished) return;
                finished = true;
                try { clearTimeout(timeoutId); } catch { }
                try { client.off("transaction", onRefundTx); } catch { }
                reject(e instanceof Error ? e : new Error(String(e)));
            };

            const timeoutId = setTimeout(() => {
                rejectOnce(new Error("Gas refund timeout"));
            }, 5 * 60_000);
            ctx.cleaner.trackTimer(timeoutId);

            const onRefundTx = (data: any) => {
                try {
                    if (!data?.validated) return;

                    const tx = data?.tx_json;
                    const meta = data?.meta;

                    if (!tx || tx.TransactionType !== "Payment") return;
                    if (tx.Destination !== wallet.address) return;

                    const refundXrp = Number(dropsToXrp(meta?.delivered_amount));

                    resolveOnce({
                        xrpAmount: refundXrp,
                        txHash: data.hash,
                    });
                } catch (err) {
                    rejectOnce(err);
                }
            };

            client.on("transaction", onRefundTx);

            client.request({ command: "subscribe", accounts: [wallet.address] })
                .then(() => {
                    console.log(`🔍 Monitoring gas return transaction for ${wallet.address}`);
                    ctx.cleaner.add(async () => {
                        try { client.off("transaction", onRefundTx); } catch { }
                        try { await client.request({ command: "unsubscribe", accounts: [wallet.address] }); } catch { }
                    });
                })
                .catch((err: unknown) => {
                    rejectOnce(err);
                });
        });
    }
};
