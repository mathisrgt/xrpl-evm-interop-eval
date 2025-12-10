import chalk from "chalk";
import { Client, dropsToXrp, xrpToDrops } from "xrpl";
import type { BalanceCheckResult, ChainAdapter, GasRefundOutput, RunContext, SourceOutput, TargetOutput } from "../../types";
import { SQUID_INTEGRATOR_ID, getXrplWallet } from "../../utils/environment";

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

        const wallet = getXrplWallet();
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

        // Retry logic for getting Squid route (max 3 attempts)
        const maxRetries = 3;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(chalk.cyan(`🔄 Route attempt ${attempt}/${maxRetries}...`));

                const result = await fetch(
                    "https://v2.api.squidrouter.com/v2/route",
                    {
                        method: 'POST',
                        headers: {
                            "x-integrator-id": SQUID_INTEGRATOR_ID,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify(params)
                    }
                );

                if (!result.ok) {
                    const errorData = await result.json().catch(() => ({}));
                    const errorMsg = errorData.message || errorData || 'Unknown error';
                    throw new Error(`HTTP ${result.status}: ${errorMsg}`);
                }

                const requestId = result.headers.get("x-request-id") || '';
                const data = await result.json();
                ctx.cache.squid = {
                    route: data.route,
                    requestId
                };

                console.log(chalk.green('✓ Squid route obtained successfully'));
                return;
            } catch (error: any) {
                lastError = error;
                const errorMsg = error.message || 'Unknown error';
                const statusCode = error.message?.includes('HTTP') ? error.message.split(':')[0] : 'N/A';

                console.log(chalk.red(`❌ Route attempt ${attempt}/${maxRetries} failed (${statusCode}): ${errorMsg}`));

                if (attempt < maxRetries) {
                    const waitTime = attempt * 2000; // Exponential backoff: 2s, 4s
                    console.log(chalk.yellow(`⏳ Waiting ${waitTime/1000}s before retry...`));
                    await delay(waitTime);
                } else {
                    console.log(chalk.red(`❌ All ${maxRetries} route attempts failed`));
                    if (error.response) {
                        console.error(chalk.red("Last Squid API error:"), error.response.data);
                    }
                    throw new Error(`Failed to get Squid route after ${maxRetries} attempts: ${errorMsg}`);
                }
            }
        }

        throw new Error(`Failed to get Squid route: ${lastError?.message || 'Unknown error'}`);
    },

    /** Check if wallet has sufficient balance for the transaction */
    async checkBalance(ctx: RunContext): Promise<BalanceCheckResult> {
        const { client, wallet } = ctx.cache.xrpl!;
        if (!client || !wallet) throw new Error("XRPL not prepared");

        // Get current balance
        const balanceStr = await client.getXrpBalance(wallet.address);
        const currentBalance = Number(balanceStr);

        // Calculate required balance:
        // - Transfer amount
        // - Reserve requirement (1 XRP minimum for XRPL accounts)
        // - Fee margin (estimate 1 XRP for gas fees to be safe)
        const reserveRequirement = 1;
        const feeMargin = 1;
        const requiredBalance = ctx.cfg.xrpAmount + reserveRequirement + feeMargin;

        const sufficient = currentBalance >= requiredBalance;

        return {
            sufficient,
            currentBalance,
            requiredBalance,
            currency: 'XRP',
            message: sufficient
                ? `Balance sufficient: ${currentBalance.toFixed(4)} XRP (need ${requiredBalance.toFixed(4)} XRP)`
                : `Insufficient balance: ${currentBalance.toFixed(4)} XRP (need ${requiredBalance.toFixed(4)} XRP including ${reserveRequirement} XRP reserve + ${feeMargin} XRP fee margin)`
        };
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

        return { xrpAmount: ctx.cfg.xrpAmount, txHash, submittedAt, txFee, currency: 'XRP' };
    },

    /** Monitor the incoming transaction on the blockchain */
    async observe(ctx: RunContext): Promise<TargetOutput> {
        const { client, wallet } = ctx.cache.xrpl ?? {};
        if (!client || !wallet) throw new Error("XRPL not prepared");

        // Record when observation starts - only accept transactions AFTER this time
        // Start monitoring immediately (there's already a 10s wait between runs in index.ts)
        const observeStartTime = Date.now();

        console.log(`🔍 Monitoring transactions for ${wallet.address}`);
        console.log(chalk.dim(`   Only accepting transactions after ${new Date(observeStartTime).toISOString()}`));

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

                    // Skip if this is the same transaction hash from the previous run
                    if (ctx.previousTargetTxHash && data.hash === ctx.previousTargetTxHash) {
                        console.log(chalk.dim(`   Ignoring previous run's transaction (hash: ${data.hash?.substring(0, 8)}...)`));
                        return;
                    }

                    // Get transaction timestamp from ledger close time
                    // XRPL uses Ripple epoch (946684800 = Jan 1, 2000)
                    const rippleEpochOffset = 946684800;
                    const txTimestamp = tx.date ? (tx.date + rippleEpochOffset) * 1000 : Date.now();

                    // Only accept transactions that occurred AFTER we started observing
                    if (txTimestamp < observeStartTime) {
                        console.log(chalk.dim(`   Ignoring old transaction from ${new Date(txTimestamp).toISOString()} (hash: ${data.hash?.substring(0, 8)}...)`));
                        return;
                    }

                    const deliveredXrp = Number(dropsToXrp(meta?.delivered_amount));
                    const txFeeXrp = Number(dropsToXrp(tx.Fee));
                    const finalizedAt = Date.now();

                    // Skip small gas return transactions (< 0.001 XRP)
                    if (deliveredXrp < 0.001) {
                        console.log(chalk.dim(`   Ignoring small gas return transaction: ${deliveredXrp.toFixed(3)} XRP (hash: ${data.hash?.substring(0, 8)}...)`));
                        return;
                    }

                    resolveOnce({
                        xrpAmount: deliveredXrp,
                        txHash: data.hash,
                        finalizedAt,
                        txFee: txFeeXrp,
                        currency: 'XRP',
                    } as TargetOutput);
                } catch (err) {
                    rejectOnce(err);
                }
            };

            client.on("transaction", onTx);

            client.request({ command: "subscribe", accounts: [wallet.address] })
                .then(() => {
                    console.log(chalk.dim(`   ✓ Subscribed to real-time transaction stream`));
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

        // Record when observation starts - only accept transactions AFTER this time
        // Start monitoring immediately (there's already a 10s wait between runs in index.ts)
        const observeStartTime = Date.now();

        console.log(`🔍 Monitoring gas return transaction for ${wallet.address}`);
        console.log(chalk.dim(`   Only accepting transactions after ${new Date(observeStartTime).toISOString()}`));

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

                    // Get transaction timestamp from ledger close time
                    // XRPL uses Ripple epoch (946684800 = Jan 1, 2000)
                    const rippleEpochOffset = 946684800;
                    const txTimestamp = tx.date ? (tx.date + rippleEpochOffset) * 1000 : Date.now();

                    // Only accept transactions that occurred AFTER we started observing
                    if (txTimestamp < observeStartTime) {
                        console.log(chalk.dim(`   Ignoring old gas refund from ${new Date(txTimestamp).toISOString()} (hash: ${data.hash?.substring(0, 8)}...)`));
                        return;
                    }

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
                    console.log(chalk.dim(`   ✓ Subscribed to real-time transaction stream`));
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
