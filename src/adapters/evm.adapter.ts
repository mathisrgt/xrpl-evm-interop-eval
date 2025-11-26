import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xrplevmTestnet } from "viem/chains";
import { ChainAdapter, GasRefundOutput, RunContext, SourceOutput, TargetOutput } from "../types";
import { xrplevm } from "../utils/chains";
import {
    EVM_GATEWAY_ABI,
    GAS_SERVICE_ADDRESS,
    INTERCHAIN_GAS_AMOUNT,
    INTERCHAIN_TOKEN_SERVICE_ABI,
    INTERCHAIN_TOKEN_SERVICE_ADDRESS,
    NATIVE_TOKEN_ADDRESS,
    XRP_TOKEN_ID
} from "../utils/constants";
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

        // Encode the destination XRPL address as hex bytes
        const destinationAddressHex = `0x${Buffer.from(xrplWallet.address).toString("hex")}` as `0x${string}`;

        // Encode the approval for Interchain Token Service
        const approveTokenServiceCalldata = encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [
                INTERCHAIN_TOKEN_SERVICE_ADDRESS,  // spender: address
                amountInWei                         // amount: uint256
            ]
        });

        // Encode the approval for Gas Service
        const approveGasServiceCalldata = encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [
                GAS_SERVICE_ADDRESS,    // spender: address
                amountInWei             // amount: uint256
            ]
        });

        // Encode the interchainTransfer function call
        const interchainTransferCalldata = encodeFunctionData({
            abi: INTERCHAIN_TOKEN_SERVICE_ABI,
            functionName: "interchainTransfer",
            args: [
                XRP_TOKEN_ID,              // tokenId: bytes32
                "xrpl",                     // destinationChain: string
                destinationAddressHex,      // destinationAddress: bytes
                amountInWei,                // amount: uint256
                "0x",                       // metadata: bytes (empty)
                INTERCHAIN_GAS_AMOUNT       // gasValue: uint256
            ]
        });

        // Construct the multicall array with approvals + interchain transfer
        const multicallData = [
            // 1. Approval for Interchain Token Service
            {
                callType: 1,                            // CallType: 1 (Call with token interaction)
                target: NATIVE_TOKEN_ADDRESS,           // Target: Native XRP token
                value: 0n,                              // Value: 0 (no ETH sent for approval)
                callData: approveTokenServiceCalldata,  // Calldata: approve() function call
                payload: `0x000000000000000000000000${NATIVE_TOKEN_ADDRESS.slice(2).toLowerCase()}0000000000000000000000000000000000000000000000000000000000000001`  // Metadata: token address (bytes32) + operation type 1 (bytes32)
            },
            // 2. Approval for Gas Service
            {
                callType: 1,                            // CallType: 1 (Call with token interaction)
                target: NATIVE_TOKEN_ADDRESS,           // Target: Native XRP token
                value: 0n,                              // Value: 0 (no ETH sent for approval)
                callData: approveGasServiceCalldata,    // Calldata: approve() function call
                payload: `0x000000000000000000000000${NATIVE_TOKEN_ADDRESS.slice(2).toLowerCase()}0000000000000000000000000000000000000000000000000000000000000001`  // Metadata: token address (bytes32) + operation type 1 (bytes32)
            },
            // 3. Interchain transfer of XRP to XRPL address
            {
                callType: 0,                            // CallType: 0 (Default call)
                target: INTERCHAIN_TOKEN_SERVICE_ADDRESS,  // Target: Interchain Token Service contract
                value: INTERCHAIN_GAS_AMOUNT,           // Value: gas payment amount (not full transfer amount!)
                callData: interchainTransferCalldata,   // Calldata: encoded interchainTransfer function call
                payload: `0x000000000000000000000000${NATIVE_TOKEN_ADDRESS.slice(2).toLowerCase()}0000000000000000000000000000000000000000000000000000000000000003`  // Metadata: token address (bytes32) + operation type 3 (bytes32)
            }
        ];

        const txHash = await walletClient.writeContract({
            account,
            address: `0x${ctx.cfg.networks.evm.relayer}`,
            abi: EVM_GATEWAY_ABI,
            functionName: "fundAndRunMulticall",
            args: [
                NATIVE_TOKEN_ADDRESS,       // token: address (native XRP)
                amountInWei,                // amount: uint256 (total XRP amount to transfer)
                multicallData               // calls: tuple[] (array of multicall operations)
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