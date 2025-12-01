import { Address, createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, formatEther, http, parseEther, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xrplevmTestnet } from "viem/chains";
import { ChainAdapter, GasRefundOutput, RunContext, SourceOutput, TargetOutput } from "../../types";
import { xrplevm } from "../../utils/chains";
import {
    EVM_GATEWAY_ABI,
    GAS_SERVICE_ADDRESS,
    INTERCHAIN_GAS_AMOUNT,
    INTERCHAIN_TOKEN_SERVICE_ABI,
    INTERCHAIN_TOKEN_SERVICE_ADDRESS,
    NATIVE_TOKEN_ADDRESS,
    XRP_TOKEN_ID
} from "../../utils/constants";
import { EVM_WALLET_PRIVATE_KEY, SQUID_INTEGRATOR_ID } from "../../utils/environment";
import { waitWithCountdown } from "../../utils/time";
import axios from "axios";
import chalk from "chalk";

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

        // Get XRPL wallet for toAddress
        const { wallet } = ctx.cache.xrpl!;
        if (!wallet) throw new Error("XRPL not prepared - run XRPL prepare first");

        // Prepare Squid route parameters
        const fromChainId = '1440000'; // XRPL-EVM
        const toChainId = 'xrpl-mainnet';
        const fromToken = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
        const toToken = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
        const fromAmount = parseEther(ctx.cfg.xrpAmount.toString()).toString();

        const formattedFromToken = getTokenAddress(fromChainId, fromToken);
        const formattedToToken = getTokenAddress(toChainId, toToken);

        const params = {
            fromAddress: account.address,
            fromChain: fromChainId,
            fromToken: formattedFromToken,
            fromAmount,
            toChain: toChainId,
            toToken: formattedToToken,
            toAddress: wallet.address,
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

    async submit(ctx: RunContext): Promise<SourceOutput> {
        const { account, walletClient, publicClient } = ctx.cache.evm!;
        const { route } = ctx.cache.squid!;

        if (!walletClient || !account || !publicClient) throw new Error("EVM not prepared");
        if (!route) throw new Error("Squid route not prepared");

        const target = route.transactionRequest.target;
        const data = route.transactionRequest.data;
        const value = route.transactionRequest.value;
        const fromToken = route.params?.fromToken || "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
        const fromAmount = route.params?.fromAmount || value;

        console.log(chalk.cyan('📤 Submitting EVM transaction...'));
        console.log(chalk.dim(`Target: ${target}`));
        console.log(chalk.dim(`Value: ${formatEther(BigInt(value || "0"))} XRP`));

        const submittedAt = Date.now();

        // Approve if not native token
        if (fromToken !== "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" && fromToken !== "xrp") {
            console.log(chalk.yellow('Approving token...'));
            const approveTx = await walletClient.writeContract({
                address: fromToken as Address,
                abi: erc20Abi,
                functionName: 'approve',
                args: [target as Address, BigInt(fromAmount)],
                account,
                chain: ctx.cache.evm?.chain
            });
            await publicClient.waitForTransactionReceipt({ hash: approveTx });
            console.log(chalk.green('✓ Token approved'));
        }

        // Execute the transaction
        const txHash = await walletClient.sendTransaction({
            account,
            to: target as Address,
            data: data as Address,
            value: BigInt(value || "0"),
            gas: BigInt(route.transactionRequest.gasLimit || "500000"),
            chain: ctx.cache.evm?.chain
        });

        console.log(chalk.green(`✓ EVM transaction submitted`));
        console.log(chalk.dim(`TX Hash: ${txHash}`));

        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

        const gasUsed = receipt.gasUsed;
        const effectiveGasPrice = receipt.effectiveGasPrice || 0n;
        const gasFeeWei = gasUsed * effectiveGasPrice;
        const txFee = Number(formatEther(gasFeeWei));

        return { xrpAmount: ctx.cfg.xrpAmount, txHash, submittedAt, txFee };
    },

    /**
    * Observe the target-side inbound event using getLogs to watch for XRP token transfers
    * Watches for ERC-20 Transfer events instead of native transfers since Squid uses wrapped tokens
    */
    async observe(ctx: RunContext): Promise<TargetOutput> {
        const { publicClient, account } = ctx.cache.evm!;

        if (!publicClient || !account) throw new Error("EVM not prepared");

        const timeoutMs = 10 * 60_000;

        // Get starting block
        const startBlock = await publicClient.getBlockNumber();

        console.log(chalk.cyan(`🔍 Watching for XRP token transfers TO ${account.address} on XRPL-EVM (from block ${startBlock})`));

        return await new Promise<TargetOutput>((resolve, reject) => {
            let finished = false;
            let unwatch: (() => void) | undefined;

            const resolveOnce = (v: TargetOutput) => {
                if (finished) return;
                finished = true;
                clearTimeout(timeoutId);
                try { unwatch?.(); } catch {}
                resolve(v);
            };

            const rejectOnce = (e: unknown) => {
                if (finished) return;
                finished = true;
                clearTimeout(timeoutId);
                try { unwatch?.(); } catch {}
                reject(e instanceof Error ? e : new Error(String(e)));
            };

            const timeoutId = setTimeout(() => {
                rejectOnce(new Error("Timeout: Axelar bridge not completed"));
            }, timeoutMs);
            ctx.cleaner.trackTimer(timeoutId);

            // Function to check for ERC-20 Transfer events to our account
            const checkForTransfers = async (toBlock: bigint) => {
                try {
                    // Watch for ANY ERC-20 Transfer events to our account
                    // We don't specify the token address since we don't know which wrapped XRP token Squid uses
                    const logs = await publicClient.getLogs({
                        event: {
                            type: "event",
                            name: "Transfer",
                            inputs: [
                                { indexed: true, name: "from", type: "address" },
                                { indexed: true, name: "to", type: "address" },
                                { indexed: false, name: "value", type: "uint256" },
                            ],
                        },
                        fromBlock: startBlock,
                        toBlock: toBlock,
                        args: { to: account.address },
                    });

                    if (logs.length > 0) {
                        console.log(chalk.dim(`   Found ${logs.length} token transfer(s) to account`));
                    }

                    // Take the first incoming transfer
                    const log = logs.length > 0 ? logs[0] : undefined;

                    if (log) {
                        const from = (log as any).args?.from as string;
                        const value = (log as any).args?.value as bigint | undefined;
                        const xrpAmount = value ? Number(formatEther(value)) : 0;

                        console.log(chalk.green(`✅ Found incoming XRP token transfer!`));
                        console.log(chalk.dim(`   Token: ${log.address}`));
                        console.log(chalk.dim(`   From: ${from}`));
                        console.log(chalk.dim(`   Amount: ${xrpAmount} XRP`));
                        console.log(chalk.dim(`   Tx: ${log.transactionHash}`));

                        const receipt = await publicClient.getTransactionReceipt({ hash: log.transactionHash as Address });
                        const gasUsed = receipt.gasUsed;
                        const effectiveGasPrice = receipt.effectiveGasPrice || 0n;
                        const gasFeeWei = gasUsed * effectiveGasPrice;
                        const txFee = Number(formatEther(gasFeeWei));

                        resolveOnce({
                            xrpAmount,
                            txHash: log.transactionHash as Address,
                            finalizedAt: Date.now(),
                            txFee,
                        });
                    }
                } catch (err) {
                    console.warn(chalk.yellow("Error checking for transfers:"), err);
                }
            };

            // Check immediately for any existing transfers
            (async () => {
                try {
                    const currentBlock = await publicClient.getBlockNumber();
                    await checkForTransfers(currentBlock);
                } catch (err) {
                    console.warn(chalk.yellow("Error in initial transfer check:"), err);
                }
            })();

            // Then watch for new blocks
            unwatch = publicClient.watchBlockNumber({
                onError: (e) => rejectOnce(e),
                onBlockNumber: async (bn) => {
                    try {
                        console.log(chalk.dim(`🔍 Checking block ${bn}...`));
                        await checkForTransfers(bn);
                    } catch (err) {
                        console.warn(chalk.yellow("Error watching blocks:"), err);
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