import { Client, dropsToXrp } from "xrpl";
import type { ChainAdapter, RunContext, SourceOutput, TargetOutput, GasRefundOutput } from "../../types";
import { getXrplWallet } from "../../utils/environment";
import chalk from "chalk";

/**
 * FAsset XRPL Adapter (XRPL → Flare)
 *
 * This adapter uses a manual bridging flow where the user performs the bridge transaction manually.
 * The submit() function watches for an OUTGOING XRP payment from your wallet to a FAsset deposit address.
 * The observe() function watches for an INCOMING XRP payment (for the reverse direction).
 */
export const xrplAdapter: ChainAdapter = {

    async prepare(ctx: RunContext) {
        const client = new Client(ctx.cfg.networks.xrpl.wsUrl);
        await client.connect();

        const wallet = getXrplWallet();
        ctx.cache.xrpl = { client, wallet };
        ctx.cleaner.trackXrpl(client, wallet.address);

        console.log(chalk.cyan(`\n🔧 XRPL Adapter prepared`));
        console.log(chalk.dim(`   Wallet: ${wallet.address}`));
    },

    /**
     * SUBMIT: Watch for OUTGOING XRP payment (manual bridge initiation)
     * This function waits for the user to manually send XRP to a FAsset deposit address
     */
    async submit(ctx: RunContext): Promise<SourceOutput> {
        const { client, wallet } = ctx.cache.xrpl!;
        if (!client || !wallet) throw new Error("XRPL not prepared");

        console.log(chalk.bold.yellow('\n⏸️  MANUAL ACTION REQUIRED'));
        console.log(chalk.cyan('═'.repeat(60)));
        console.log(chalk.yellow(`Please send ${ctx.cfg.xrpAmount} XRP from your wallet to the FAsset deposit address`));
        console.log(chalk.dim(`Your XRPL address: ${wallet.address}`));
        console.log(chalk.cyan('═'.repeat(60)));
        console.log(chalk.cyan(`🔍 Watching for OUTGOING XRP payment from ${wallet.address}...`));
        console.log(chalk.dim(`   Waiting for payment ≥ ${ctx.cfg.xrpAmount} XRP`));

        return await new Promise<SourceOutput>((resolve, reject) => {
            let finished = false;

            const resolveOnce = (v: SourceOutput) => {
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
                rejectOnce(new Error("Timeout: No outgoing XRP payment detected within 10 minutes"));
            }, 10 * 60_000); // 10 minute timeout
            ctx.cleaner.trackTimer(timeoutId);

            const onTx = (data: any) => {
                try {
                    if (!data?.validated) return;

                    const tx = data?.tx_json;
                    const meta = data?.meta;

                    // Only interested in Payment transactions
                    if (!tx || tx.TransactionType !== "Payment") return;

                    // Only interested in OUTGOING payments FROM our wallet
                    if (tx.Account !== wallet.address) return;

                    // Skip incoming payments (where we are the destination)
                    if (tx.Destination === wallet.address) {
                        console.log(chalk.dim(`   Skipping incoming payment in tx ${data.hash}`));
                        return;
                    }

                    const deliveredXrp = Number(dropsToXrp(meta?.delivered_amount || tx.Amount));
                    const txFeeXrp = Number(dropsToXrp(tx.Fee));
                    const submittedAt = Date.now();

                    console.log(chalk.green(`\n✅ Found OUTGOING XRP payment!`));
                    console.log(chalk.dim(`   To: ${tx.Destination}`));
                    console.log(chalk.dim(`   Amount: ${deliveredXrp} XRP`));
                    console.log(chalk.dim(`   Fee: ${txFeeXrp} XRP`));
                    console.log(chalk.dim(`   Tx: ${data.hash}`));
                    console.log(chalk.dim(`   Explorer: https://livenet.xrpl.org/transactions/${data.hash}`));

                    // Validate amount is sufficient
                    if (deliveredXrp < ctx.cfg.xrpAmount) {
                        console.log(chalk.yellow(`⚠️  Payment amount (${deliveredXrp} XRP) is less than expected (${ctx.cfg.xrpAmount} XRP)`));
                        console.log(chalk.yellow(`   Waiting for a payment of at least ${ctx.cfg.xrpAmount} XRP...`));
                        return;
                    }

                    // Store deposit address for potential filtering in observe
                    if (ctx.cache.xrpl) {
                        ctx.cache.xrpl.depositAddress = tx.Destination;
                    }

                    resolveOnce({
                        xrpAmount: deliveredXrp,
                        txHash: data.hash,
                        submittedAt,
                        txFee: txFeeXrp,
                        currency: 'XRP',
                    });
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
     * OBSERVE: Watch for INCOMING XRP payment (bridge completion on XRPL side)
     * This is for the reverse direction (Flare → XRPL)
     */
    async observe(ctx: RunContext): Promise<TargetOutput> {
        const { client, wallet, depositAddress } = ctx.cache.xrpl!;
        if (!client || !wallet) throw new Error("XRPL not prepared");

        console.log(chalk.cyan(`\n🔍 Watching for INCOMING XRP payment to ${wallet.address}...`));
        if (depositAddress) {
            console.log(chalk.dim(`   Excluding payments FROM deposit address: ${depositAddress}`));
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
                rejectOnce(new Error("Timeout: No incoming XRP payment received within 10 minutes"));
            }, 10 * 60_000);
            ctx.cleaner.trackTimer(timeoutId);

            const onTx = (data: any) => {
                try {
                    if (!data?.validated) return;

                    const tx = data?.tx_json;
                    const meta = data?.meta;

                    if (!tx || tx.TransactionType !== "Payment") return;

                    // Only interested in INCOMING payments TO our wallet
                    if (tx.Destination !== wallet.address) return;

                    // Exclude payments FROM the deposit address (our original outgoing payment)
                    if (depositAddress && tx.Account === depositAddress) {
                        console.log(chalk.dim(`   Skipping payment from original deposit address in tx ${data.hash}`));
                        return;
                    }

                    const deliveredXrp = Number(dropsToXrp(meta?.delivered_amount || tx.Amount));
                    const txFeeXrp = Number(dropsToXrp(tx.Fee));
                    const finalizedAt = Date.now();

                    console.log(chalk.green(`\n✅ Found INCOMING XRP payment!`));
                    console.log(chalk.dim(`   From: ${tx.Account}`));
                    console.log(chalk.dim(`   Amount: ${deliveredXrp} XRP`));
                    console.log(chalk.dim(`   Fee: ${txFeeXrp} XRP`));
                    console.log(chalk.dim(`   Tx: ${data.hash}`));
                    console.log(chalk.dim(`   Explorer: https://livenet.xrpl.org/transactions/${data.hash}`));

                    resolveOnce({
                        xrpAmount: deliveredXrp,
                        txHash: data.hash,
                        finalizedAt,
                        txFee: txFeeXrp,
                        currency: 'XRP',
                    });
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

    async observeGasRefund(ctx: RunContext): Promise<GasRefundOutput> {
        // No gas refund for FAsset bridge
        return { xrpAmount: 0, txHash: "n/a" };
    }
};
