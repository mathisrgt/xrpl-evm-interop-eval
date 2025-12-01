import { Client, Payment, Wallet, convertStringToHex, dropsToXrp, xrpToDrops } from "xrpl";
import type { ChainAdapter, RunContext, SourceOutput, TargetOutput, GasRefundOutput } from "../../types";
import chalk from "chalk";

export const xrplAdapter: ChainAdapter = {

    /** Prepare the client and wallet */
    async prepare(ctx: RunContext) {
        const client = new Client(ctx.cfg.networks.xrpl.wsUrl);
        await client.connect();

        const wallet = Wallet.fromSeed(ctx.cfg.networks.xrpl.walletSeed);
        ctx.cache.xrpl = { client, wallet };
        ctx.cleaner.trackXrpl(client, wallet.address);
    },

    /** Submit XRPL Payment with optional memos */
    async submit(ctx: RunContext): Promise<SourceOutput> {
        const { client, wallet } = ctx.cache.xrpl!;
        const { account } = ctx.cache.evm!;
        if (!client || !wallet) throw new Error("XRPL not prepared");

        const tx: Payment = {
            TransactionType: "Payment",
            Account: wallet.address,
            Destination: ctx.cfg.networks.xrpl.gateway,
            Amount: xrpToDrops(ctx.cfg.xrpAmount),
            Memos: [
                {
                    Memo: {
                        MemoType: convertStringToHex("type"),
                        MemoData: convertStringToHex("interchain_transfer")
                    }
                },
                {
                    Memo: {
                        MemoType: convertStringToHex("destination_address"),
                        MemoData: convertStringToHex(account.address.slice(2))
                    }
                },
                {
                    Memo: {
                        MemoType: convertStringToHex("destination_chain"),
                        MemoData: convertStringToHex("xrpl-evm")
                    }
                },
                {
                    Memo: {
                        MemoType: convertStringToHex("gas_fee_amount"),
                        MemoData: convertStringToHex(ctx.cfg.networks.xrpl.gas_fee)
                    }
                }
            ]
        };

        const submittedAt = Date.now();
        const res = await client.submitAndWait(tx, { autofill: true, wallet });

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
