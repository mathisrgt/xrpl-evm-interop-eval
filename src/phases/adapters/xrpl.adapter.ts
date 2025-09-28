import { Client, Payment, Wallet, convertStringToHex, dropsToXrp, xrpToDrops } from "xrpl";
import type { ChainAdapter, RunContext, SourceOutput, TargetOutput, GasRefundOutput } from "../../types";
import { XRPL_TX_PAYLOAD } from "../../utils/environment";
import { formatElapsedMs } from "../../utils/time";

export const xrplAdapter: ChainAdapter = {

    // Prepare the client and wallet
    async prepare(ctx: RunContext) {
        const client = new Client(ctx.cfg.networks.xrpl.wsUrl);
        await client.connect();

        const wallet = Wallet.fromSeed(ctx.cfg.networks.xrpl.walletSeed);
        ctx.cache.xrpl = { client, wallet };
    },

    /** Submit XRPL Payment with optional memos */
    async submit(ctx: RunContext): Promise<SourceOutput> {
        const { client, wallet } = ctx.cache.xrpl!;
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
                        MemoType: convertStringToHex("destination_address"), // Target contract on the destination chain
                        MemoData: convertStringToHex(ctx.cfg.networks.evm.contract)
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
                },
                {
                    Memo: {
                        MemoType: convertStringToHex("payload"),
                        MemoData: XRPL_TX_PAYLOAD // TODO: REPLACE BY A DETERMINISTIC FUNCTION AND PARAMS
                    }
                },
            ]
        };

        const submittedAt = Date.now();
        const res = await client.submitAndWait(tx, { autofill: true, wallet });

        if (!res.result.validated) {
            const code = (res.result as any).engine_result || "unknown";
            throw new Error(`XRPL submit failed: ${code}`);
        }

        const txHash = res.result.hash!;

        const txFee = Number(dropsToXrp(res.result.tx_json.Fee || "0"));

        return { xrpAmount: ctx.cfg.xrpAmount, txHash, submittedAt, txFee };
    },

    async observe(ctx: RunContext): Promise<TargetOutput> {
        const { client, wallet } = ctx.cache.xrpl ?? {};
        if (!client || !wallet) throw new Error("XRPL not prepared");

        return await new Promise<TargetOutput>((resolve, reject) => {
            let finished = false;

            const cleanup = async () => {
                if (finished) return;
                finished = true;
                clearTimeout(timeoutId);
                client.off("transaction", onTx);
                try {
                    await client.request({ command: "unsubscribe", accounts: [wallet.address] });
                } catch (err) {
                    console.warn("Failed to unsubscribe from XRPL:", err);
                }
            };

            const timeoutId = setTimeout(() => {
                cleanup().then(() => reject(new Error("⌛️ Timeout: no matching payment on XRPL")));
            }, 10 * 60_000);

            const onTx = (data: any) => {
                // console.log("new tx!: ", data);

                try {
                    // Only consider validated ledgers
                    if (!data?.validated) return;

                    const tx = data?.tx_json;
                    const meta = data?.meta;
                    if (!tx || tx.TransactionType !== "Payment") return;
                    if (tx.Destination !== wallet.address) return;

                    console.log(`📦 Received payment: ${data.hash} from ${tx.Account}`);

                    const delivered = meta?.delivered_amount;
                    const deliveredXrp = Number(dropsToXrp(delivered));

                    const finalizedAt = Date.now();

                    const txFee = Number(dropsToXrp(tx.Fee || "0"));

                    cleanup().then(() =>
                        resolve({
                            xrpAmount: deliveredXrp,
                            txHash: data.hash,
                            finalizedAt,
                            txFee
                        } as TargetOutput)
                    );
                } catch (err) {
                    console.error("Error processing XRPL transaction:", err);
                    cleanup().then(() => reject(err instanceof Error ? err : new Error(String(err))));
                }
            };

            client.on("transaction", onTx);

            client
                .request({ command: "subscribe", accounts: [wallet.address] })
                .then(() => {
                    console.log(`🔍 Monitoring transactions for ${wallet.address}`);
                })
                .catch((err: unknown) => {
                    console.error("Failed to subscribe to XRPL transactions:", err);
                    cleanup().then(() => reject(err instanceof Error ? err : new Error(String(err))));
                });
        });
    },

    /** 
     * Observe gas refund transaction from the bridge refunder contract
     * This runs after the main bridge transfer is complete
     */
    async observeGasRefund(ctx: RunContext): Promise<GasRefundOutput> {
        const { client, wallet } = ctx.cache.xrpl!;
        if (!client || !wallet) throw new Error("XRPL not prepared");

        return new Promise((resolve, reject) => {
            let finished = false;

            const cleanup = async () => {
                if (finished) return;
                finished = true;
                clearTimeout(timeoutId);
                client.off("transaction", onRefundTx);
                // Note: Don't unsubscribe here as main client might still be in use
            };

            const timeoutId = setTimeout(() => {
                cleanup().then(() => reject(new Error("Gas refund timeout")));
            }, 5 * 60_000);

            const onRefundTx = (data: any) => {
                if (!data?.validated) return;

                const tx = data?.tx_json;
                const meta = data?.meta;

                if (!tx || tx.TransactionType !== "Payment") return;
                if (tx.Destination !== wallet.address) return;
                if (tx.Account !== ctx.cfg.networks.xrpl.gas_refunder) return;

                const refundAmount = Number(dropsToXrp(meta?.delivered_amount ?? tx?.Amount));

                console.log(`⛽ Gas refund received: ${refundAmount} XRP from ${tx.Account}`);

                cleanup().then(() =>
                    resolve({
                        xrpAmount: refundAmount,
                        txHash: data.hash
                    })
                );
            };

            client
                .request({ command: "subscribe", accounts: [wallet.address] })
                .then(() => {
                    console.log(`🔍 Monitoring transactions for ${wallet.address}`);
                    client.on("transaction", onRefundTx);
                })
                .catch((err: unknown) => {
                    cleanup().then(() => reject(err instanceof Error ? err : new Error(String(err))));
                });
        });
    }
};
