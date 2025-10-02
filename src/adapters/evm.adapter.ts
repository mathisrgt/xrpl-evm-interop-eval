import { createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xrplevmTestnet } from "viem/chains";
import { ChainAdapter, GasRefundOutput, RunContext, SourceOutput, TargetOutput } from "../types";
import { xrplevm } from "../utils/chains";
import { EVM_WALLET_PRIVATE_KEY } from "../utils/environment";

export const evmAdapter: ChainAdapter = {

    async prepare(ctx: RunContext) {
        const rpcUrl = ctx.cfg.networks.evm.rpcUrl;

        const chain = ctx.cfg.networks.mode === "mainnet" ? xrplevm : xrplevmTestnet;

        const publicClient = createPublicClient({
            chain: chain,
            transport: http(rpcUrl)
        });

        const walletClient = createWalletClient({
            chain: chain,
            transport: http(rpcUrl)
        });

        const account = privateKeyToAccount(`0x${EVM_WALLET_PRIVATE_KEY}`);

        ctx.cache.evm = { publicClient, walletClient, account, chain };
    },

    async submit(ctx: RunContext): Promise<SourceOutput> {
        const { account, walletClient, publicClient } = ctx.cache.evm!;
        const { wallet: xrplWallet } = ctx.cache.xrpl!;


        if (!xrplWallet || !walletClient || !account || !publicClient) throw new Error("EVM not prepared");

        const amountInWei = BigInt(Math.floor(ctx.cfg.xrpAmount * 1e18));

        const submittedAt = Date.now();

        const txHash = await walletClient.writeContract({
            account,
            address: `0x${ctx.cfg.networks.evm.gateway}`,
            abi: [{
                "inputs": [
                    {
                        "internalType": "bytes32",
                        "name": "tokenId",
                        "type": "bytes32"
                    },
                    {
                        "internalType": "string",
                        "name": "destinationChain",
                        "type": "string"
                    },
                    {
                        "internalType": "bytes",
                        "name": "destinationAddress",
                        "type": "bytes"
                    },
                    {
                        "internalType": "uint256",
                        "name": "amount",
                        "type": "uint256"
                    },
                    {
                        "internalType": "bytes",
                        "name": "metadata",
                        "type": "bytes"
                    },
                    {
                        "internalType": "uint256",
                        "name": "gasValue",
                        "type": "uint256"
                    }
                ],
                "name": "interchainTransfer",
                "outputs": [],
                "stateMutability": "payable",
                "type": "function"
            }],
            functionName: "interchainTransfer",
            args: [
                "0xba5a21ca88ef6bba2bfff5088994f90e1077e2a1cc3dcc38bd261f00fce2824f",
                "xrpl",
                `0x${Buffer.from(xrplWallet.address).toString("hex")}`,
                amountInWei,
                "0x",
                500000000000000000n,
            ],
            value: 0n,
            chain: ctx.cache.evm?.chain
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

        // TODO: Handle an abort

        const tx = await publicClient.getTransaction({ hash: txHash });

        const gasUsed = receipt.gasUsed;
        const effectiveGasPrice = receipt.effectiveGasPrice || 0n;
        const gasFeeWei = gasUsed * effectiveGasPrice;
        const txFee = Number(formatEther(gasFeeWei));

        return { xrpAmount: ctx.cfg.xrpAmount, txHash, submittedAt, txFee };
    },

    /**
    * Observe the target-side inbound event by polling Blockscout API on each new block.
    * Filters for recent transfers *to* our address and *from* the expected gateway.
    */
    async observe(ctx: RunContext): Promise<TargetOutput> {
        const { publicClient, account } = ctx.cache.evm!;

        if (!publicClient || !account) throw new Error("EVM not prepared");

        const url = `${ctx.cache.evm?.chain.blockExplorers?.default.apiUrl}/addresses/${account.address}/token-transfers?filter=to`;

        const recentBlocks = 10;
        const timeoutMs = 10 * 60_000;

        return await new Promise<TargetOutput>((resolve, reject) => {
            let done = false;

            const finish = (fn: () => void) => {
                if (done) return;
                done = true;
                unwatch();
                clearTimeout(timeoutId);
                fn();
            };

            const timeoutId = setTimeout(() => {
                finish(() => reject(new Error("EVM observe timeout: no matching transfer")));
            }, timeoutMs);

            const unwatch = publicClient.watchBlockNumber({
                onError: (e) => finish(() => reject(e)),
                onBlockNumber: async (bn) => {
                    try {
                        const res = await fetch(url, { headers: { accept: "application/json" } });
                        if (!res.ok) throw new Error(`explorer http ${res.status}`);
                        const data: any = await res.json();

                        const current = Number(bn);

                        console.log(`🔍 (📦 ${bn})`);

                        const recentTxs = data.items.filter((tx: any) => Number(tx.block_number) > current - recentBlocks);

                        const txFound = recentTxs.find((tx: any) => {
                            const from = tx.from.hash.toLowerCase();
                            return from === '0x0000000000000000000000000000000000000000';
                        });

                        if (txFound) {
                            const txReceipt = await publicClient.getTransactionReceipt({
                                hash: txFound.transaction_hash
                            });

                            const gasUsed = txReceipt.gasUsed;
                            const effectiveGasPrice = txReceipt.effectiveGasPrice;
                            const gasFeeWei = gasUsed * effectiveGasPrice;
                            const txFee = Number(formatEther(gasFeeWei));

                            finish(() =>
                                resolve({
                                    xrpAmount: Number(formatEther(BigInt(txFound.total.value))),
                                    txHash: txFound.transaction_hash,
                                    finalizedAt: Date.now(),
                                    txFee
                                } as TargetOutput)
                            );
                        }
                    } catch (err) {
                        // Transient fetch error: ignore; watch continues
                        // If you prefer, log debug here.
                    }
                },
            });
            
            ctx.cleaner.trackViemUnwatch(unwatch);
        });
    },

    /**
    * Observe gas refund transactions by polling Blockscout API on each new block.
    * Filters for recent transactions *to* our address from gas service contracts.
    */
    async observeGasRefund(ctx: RunContext): Promise<GasRefundOutput> {
        const { publicClient, account } = ctx.cache.evm!;

        if (!publicClient || !account) throw new Error("EVM not prepared");

        const url = `${ctx.cache.evm?.chain.blockExplorers?.default.apiUrl}/addresses/${account.address}/internal-transactions?filter=to`;

        const recentBlocks = 10;
        const timeoutMs = 5 * 60_000;

        return await new Promise<GasRefundOutput>((resolve, reject) => {
            let done = false;

            const finish = (fn: () => void) => {
                if (done) return;
                done = true;
                unwatch();
                clearTimeout(timeoutId);
                fn();
            };

            const timeoutId = setTimeout(() => {
                finish(() => reject(new Error("EVM gas refund timeout: no matching transaction")));
            }, timeoutMs);

            const unwatch = publicClient.watchBlockNumber({
                onError: (e) => finish(() => reject(e)),
                onBlockNumber: async (bn) => {
                    try {
                        const res = await fetch(url, { headers: { accept: "application/json" } });
                        if (!res.ok) throw new Error(`explorer http ${res.status}`);
                        const data: any = await res.json();

                        const current = Number(bn);

                        console.log(`🔍 (📦 ${bn})`);

                        const recentTxs = data.items.filter((tx: any) => Number(tx.block_number) > current - recentBlocks);

                        const gasRefundTx = recentTxs.find((tx: any) => {
                            const to = tx.to.hash.toLowerCase();
                            return to === account.address.toLocaleLowerCase();
                        });

                        if (gasRefundTx) {
                            const refundAmount = Number(formatEther(gasRefundTx.value));

                            finish(() =>
                                resolve({
                                    xrpAmount: refundAmount,
                                    txHash: gasRefundTx.transaction_hash
                                })
                            );
                        }
                    } catch (err) {
                        console.warn("Error fetching gas refund transactions:", err);
                    }
                },
            });
        });
    }
}