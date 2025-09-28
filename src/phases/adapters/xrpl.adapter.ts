import { Client, Payment, Wallet, convertStringToHex, dropsToXrp, xrpToDrops } from "xrpl";
import type { ChainAdapter, RunContext, SourceOutput, TargetOutput } from "../../types";
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

    /**
   * Observe inbound Payment to this wallet and resolve on first match.
   * Uses polling via account_tx for robustness and simple filtering.
   */
    async observe(ctx: RunContext): Promise<TargetOutput> {
        const { client, wallet } = ctx.cache.xrpl ?? {};
        if (!client || !wallet) throw new Error("XRPL not prepared");

        const startAt = Date.now();

        return await new Promise<TargetOutput>((resolve, reject) => {
            let finished = false;

            const cleanup = async () => {
                if (finished) return;
                finished = true;
                clearTimeout(timeoutId);
                client.off("transaction", onTx);
                await client.request({ command: "unsubscribe", accounts: [wallet.address] });
                await client.disconnect();
            };

            const timeoutId = setTimeout(() => {
                cleanup().then(() => reject(new Error("❌⌛️ Timeout: no matching payment on XRPL")));
            }, 5 * 60_000);

            const onTx = (data: any) => {
                // Only consider validated ledgers
                if (!data?.validated) return;

                const tx = data?.transaction;
                const meta = data?.meta;
                if (!tx || tx.TransactionType !== "Payment") return;
                if (tx.Destination !== wallet.address) return;

                // Delivered amount (drops) → XRP
                const delivered = meta?.delivered_amount ?? tx?.Amount;
                const deliveredXrp = Number(dropsToXrp(delivered));

                const finalizedAt = Date.now();

                const txFee = Number(dropsToXrp(tx.result.tx_json.Fee));

                cleanup().then(() =>
                    resolve({
                        xrpAmount: deliveredXrp,
                        txHash: tx.hash,
                        finalizedAt,
                        txFee
                    } as TargetOutput)
                );
            };

            // Subscribe then attach listener
            client
                .request({ command: "subscribe", accounts: [wallet.address] })
                .then(() => {
                    console.log(`🔔 Subscribed to transactions for ${wallet.address}`);
                    client.on("transaction", onTx);
                })
                .catch((err: unknown) => {
                    cleanup().then(() => reject(err instanceof Error ? err : new Error(String(err))));
                });
        });
    }
};
