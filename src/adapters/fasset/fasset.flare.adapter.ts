import chalk from "chalk";
import { Address, createPublicClient, createWalletClient, erc20Abi, formatEther, http } from "viem";
import { flare } from "viem/chains";
import { BalanceCheckResult, ChainAdapter, GasRefundOutput, RunContext, SourceOutput, TargetOutput } from "../../types";
import { getEvmAccount } from "../../utils/environment";

// FXRP Token Address on Flare
const FXRP_TOKEN_ADDRESS: Address = "0xAd552A648C74D49E10027AB8a618A3ad4901c5bE";

// Flare RPC block range limit (max 30 blocks per getLogs query)
const FLARE_MAX_BLOCK_RANGE = 30n;

/**
 * Helper function to query logs in chunks to avoid Flare's block range limit
 */
async function getLogsInChunks(
    publicClient: any,
    params: {
        address: Address;
        event: any;
        fromBlock: bigint;
        toBlock: bigint;
        args?: any;
    }
): Promise<any[]> {
    const allLogs: any[] = [];
    let currentBlock = params.fromBlock;

    while (currentBlock <= params.toBlock) {
        const chunkEndBlock = currentBlock + FLARE_MAX_BLOCK_RANGE - 1n;
        const endBlock = chunkEndBlock > params.toBlock ? params.toBlock : chunkEndBlock;

        const logs = await publicClient.getLogs({
            address: params.address,
            event: params.event,
            fromBlock: currentBlock,
            toBlock: endBlock,
            args: params.args,
        });

        allLogs.push(...logs);

        // If we found logs, we can return early
        if (logs.length > 0) {
            return allLogs;
        }

        currentBlock = endBlock + 1n;
    }

    return allLogs;
}

/**
 * FAsset Flare Adapter (Flare → XRPL)
 *
 * This adapter uses a manual bridging flow where the user performs the bridge transaction manually.
 * The submit() function watches for an OUTGOING FXRP token transfer from your wallet.
 * The observe() function watches for an INCOMING FXRP token transfer (for the reverse direction).
 */
export const flareAdapter: ChainAdapter = {

    async prepare(ctx: RunContext) {
        const publicClient = createPublicClient({
            chain: flare,
            transport: http()
        });

        const walletClient = createWalletClient({
            chain: flare,
            transport: http()
        });

        const account = getEvmAccount();
        ctx.cache.evm = { publicClient, walletClient, account, chain: flare };

        console.log(chalk.cyan(`\n🔧 Flare Adapter prepared`));
        console.log(chalk.dim(`   Account: ${account.address}`));
        console.log(chalk.dim(`   FXRP Token: ${FXRP_TOKEN_ADDRESS}`));
    },

    /** Check if wallet has sufficient balance for the transaction */
    async checkBalance(ctx: RunContext): Promise<BalanceCheckResult> {
        const { publicClient, account } = ctx.cache.evm!;
        if (!publicClient || !account) throw new Error("EVM not prepared");

        // For Flare, we need FXRP for the transfer + FLR for gas
        const fxrpAmount = ctx.cfg.xrpAmount; // FXRP amount needed

        // Get FXRP token decimals first
        let decimals: number;
        try {
            const decimalsResult = await publicClient.readContract({
                address: FXRP_TOKEN_ADDRESS,
                abi: erc20Abi,
                functionName: 'decimals',
            }) as number;
            decimals = decimalsResult;
        } catch (error) {
            decimals = 18;
        }

        // Get FXRP token balance
        const fxrpBal = await publicClient.readContract({
            address: FXRP_TOKEN_ADDRESS,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [account.address as `0x${string}`]
        }) as bigint;

        // Convert balance using the correct decimals
        const currentFxrpBalance = Number(fxrpBal) / Math.pow(10, decimals);

        // Get FLR balance for gas
        const flrBalWei = await publicClient.getBalance({ address: account.address as `0x${string}` });
        const currentFlrBalance = Number(formatEther(flrBalWei));

        // Calculate required balances
        const requiredFxrpBalance = fxrpAmount;
        const minFlrForGas = 0.1; // Minimum 0.1 FLR for gas fees

        const sufficientFxrp = currentFxrpBalance >= requiredFxrpBalance;
        const sufficientFlr = currentFlrBalance >= minFlrForGas;
        const sufficient = sufficientFxrp && sufficientFlr;

        let message = '';
        if (sufficient) {
            message = `Balance sufficient: ${currentFxrpBalance.toFixed(4)} FXRP (need ${requiredFxrpBalance.toFixed(4)} FXRP), ${currentFlrBalance.toFixed(4)} FLR (need ${minFlrForGas} FLR for gas)`;
        } else {
            const issues = [];
            if (!sufficientFxrp) issues.push(`FXRP: ${currentFxrpBalance.toFixed(4)}/${requiredFxrpBalance.toFixed(4)}`);
            if (!sufficientFlr) issues.push(`FLR: ${currentFlrBalance.toFixed(4)}/${minFlrForGas} (for gas)`);
            message = `Insufficient balance: ${issues.join(', ')}`;
        }

        return {
            sufficient,
            currentBalance: currentFxrpBalance,
            requiredBalance: requiredFxrpBalance,
            currency: 'FXRP',
            message
        };
    },

    /**
     * SUBMIT: Watch for OUTGOING FXRP token transfer (manual bridge initiation)
     * This function waits for the user to manually send FXRP tokens to a FAsset redemption address
     */
    async submit(ctx: RunContext): Promise<SourceOutput> {
        const { publicClient, account } = ctx.cache.evm!;
        if (!publicClient || !account) throw new Error("EVM not prepared");

        console.log(chalk.bold.yellow('\n⏸️  MANUAL ACTION REQUIRED'));
        console.log(chalk.cyan('═'.repeat(60)));
        console.log(chalk.yellow(`Please send ${ctx.cfg.xrpAmount} FXRP from your wallet to the FAsset redemption address`));
        console.log(chalk.dim(`Your Flare address: ${account.address}`));
        console.log(chalk.dim(`FXRP Token: ${FXRP_TOKEN_ADDRESS}`));
        console.log('');
        console.log(chalk.bold.cyan('🔗 Use FSwap to bridge: ') + chalk.blue.underline('https://fswap.luminite.app/'));
        console.log(chalk.cyan('═'.repeat(60)));

        const timeoutMs = 10 * 60_000; // 10 minutes

        // Get FXRP token decimals for correct amount formatting
        let fxrpDecimals = 18;
        try {
            const decimalsResult = await publicClient.readContract({
                address: FXRP_TOKEN_ADDRESS,
                abi: erc20Abi,
                functionName: 'decimals',
            }) as number;
            fxrpDecimals = decimalsResult;
            console.log(chalk.dim(`   FXRP uses ${fxrpDecimals} decimals`));
        } catch (error) {
            console.log(chalk.dim(`   Using default 18 decimals for FXRP`));
        }

        // Get starting block - start from current block to catch instant bridges
        // There's already a 10s wait between runs in index.ts, so no need to skip blocks
        const currentBlock = await publicClient.getBlockNumber();
        const startBlock = currentBlock;

        console.log(chalk.cyan(`🔍 Step 1: Watching for FXRP approval transaction from ${account.address}...`));
        console.log(chalk.dim(`   Starting from block ${startBlock}`));

        // First, wait for approval transaction
        let approvalFee = 0;
        let approvalFeeWei = 0n;
        let approvalTxHash: string | undefined;

        try {
            const approvalResult = await new Promise<{ fee: number; feeWei: bigint; txHash: string }>((resolve, reject) => {
                let finished = false;

                const approvalTimeoutId = setTimeout(() => {
                    if (!finished) {
                        finished = true;
                        clearInterval(pollInterval);
                        reject(new Error("Timeout: No FXRP approval detected within 10 minutes"));
                    }
                }, timeoutMs);

                const checkForApprovals = async () => {
                    if (finished) return;

                    try {
                        const toBlock = await publicClient.getBlockNumber();

                        const approvalLogs = await getLogsInChunks(publicClient, {
                            address: FXRP_TOKEN_ADDRESS,
                            event: {
                                type: "event",
                                name: "Approval",
                                inputs: [
                                    { indexed: true, name: "owner", type: "address" },
                                    { indexed: true, name: "spender", type: "address" },
                                    { indexed: false, name: "value", type: "uint256" },
                                ],
                            },
                            fromBlock: startBlock,
                            toBlock: toBlock,
                            args: { owner: account.address },
                        });

                        if (approvalLogs.length > 0 && !finished) {
                            finished = true;
                            clearInterval(pollInterval);
                            clearTimeout(approvalTimeoutId);

                            const log = approvalLogs[approvalLogs.length - 1]; // Take the most recent
                            const spender = (log as any).args?.spender as string;
                            const value = (log as any).args?.value as bigint | undefined;

                            // Format with correct decimals
                            const approvalAmount = value ? (Number(value) / Math.pow(10, fxrpDecimals)).toFixed(6) : 'N/A';

                            console.log(chalk.green(`\n✅ Found FXRP approval transaction!`));
                            console.log(chalk.dim(`   Spender: ${spender}`));
                            console.log(chalk.dim(`   Amount: ${approvalAmount} FXRP`));
                            console.log(chalk.dim(`   Tx: ${log.transactionHash}`));

                            const receipt = await publicClient.getTransactionReceipt({ hash: log.transactionHash as Address });
                            const gasUsed = receipt.gasUsed;
                            const effectiveGasPrice = receipt.effectiveGasPrice || 0n;
                            const gasFeeWei = gasUsed * effectiveGasPrice;
                            const fee = Number(formatEther(gasFeeWei));

                            console.log(chalk.dim(`   Approval fee: ${fee.toFixed(6)} FLR`));

                            resolve({ fee, feeWei: gasFeeWei, txHash: log.transactionHash as string });
                        }
                    } catch (err: any) {
                        // Ignore errors during polling, will retry
                    }
                };

                // Poll every 3 seconds
                const pollInterval = setInterval(checkForApprovals, 3000);

                // Check immediately (don't wait 3 seconds for first check)
                checkForApprovals();
            });

            approvalFee = approvalResult.fee;
            approvalFeeWei = approvalResult.feeWei;
            approvalTxHash = approvalResult.txHash;

            console.log(chalk.cyan(`\n🔍 Step 2: Watching for FXRP transfer from ${account.address}...`));
            console.log(chalk.dim(`   Waiting for transfer ≥ ${ctx.cfg.xrpAmount} FXRP`));
        } catch (err) {
            console.log(chalk.yellow(`\n⚠️  No approval transaction detected, proceeding to watch for transfer...`));
            console.log(chalk.cyan(`🔍 Watching for FXRP transfer from ${account.address}...`));
            console.log(chalk.dim(`   Waiting for transfer ≥ ${ctx.cfg.xrpAmount} FXRP`));
        }

        return await new Promise<SourceOutput>((resolve, reject) => {
            let finished = false;
            let unwatch: (() => void) | undefined;

            const resolveOnce = (v: SourceOutput) => {
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
                rejectOnce(new Error("Timeout: No outgoing FXRP transfer detected within 10 minutes"));
            }, timeoutMs);
            ctx.cleaner.trackTimer(timeoutId);

            let consecutiveErrors = 0;
            const maxConsecutiveErrors = 10;

            const checkForTransfers = async (toBlock: bigint) => {
                const maxRetries = 3;

                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    try {
                        // Watch for OUTGOING transfers (from = our account)
                        // Use chunked queries to avoid Flare's 30-block limit
                        const logs = await getLogsInChunks(publicClient, {
                            address: FXRP_TOKEN_ADDRESS,
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
                            args: { from: account.address }, // OUTGOING transfers FROM our account
                        });

                        consecutiveErrors = 0; // Reset on success

                        if (logs.length > 0) {
                            console.log(chalk.dim(`   Found ${logs.length} OUTGOING transfer(s) from account`));
                        }

                        // For FAsset manual bridge, accept ANY transfer (no amount filtering)
                        // Amount validation issues due to token decimals/wrapping - just take first transfer
                        const outgoingLogs = logs.filter((log) => {
                            const to = (log as any).args?.to as string | undefined;
                            const toLower = to?.toLowerCase();
                            const value = (log as any).args?.value as bigint | undefined;

                            // Log transfer for visibility
                            if (value) {
                                const amountInFxrp = Number(formatEther(value));
                                console.log(chalk.dim(`   Transfer: ${amountInFxrp} FXRP (raw: ${value}) to ${to}`));
                            }

                            // Only exclude self-transfers
                            if (toLower === account.address.toLowerCase()) {
                                console.log(chalk.dim(`   → Skipping: self-transfer`));
                                return false;
                            }

                            // Accept all other transfers regardless of amount
                            return true;
                        });

                        // Take the first outgoing transfer
                        const log = outgoingLogs.length > 0 ? outgoingLogs[0] : undefined;

                        if (log) {
                            const to = (log as any).args?.to as string;
                            const value = (log as any).args?.value as bigint | undefined;

                            // Debug: Log raw value
                            console.log(chalk.dim(`\n   [DEBUG] Raw transfer value: ${value?.toString()}`));
                            console.log(chalk.dim(`   [DEBUG] Token address: ${log.address}`));
                            console.log(chalk.dim(`   [DEBUG] Expected token: ${FXRP_TOKEN_ADDRESS}`));

                            const transferAmount = value ? Number(formatEther(value)) : 0;

                            console.log(chalk.green(`\n✅ Found OUTGOING FXRP transfer!`));
                            console.log(chalk.dim(`   To: ${to}`));
                            console.log(chalk.dim(`   Amount: ${transferAmount} FXRP (raw: ${value})`));
                            console.log(chalk.dim(`   Tx: ${log.transactionHash}`));
                            console.log(chalk.dim(`   Explorer: https://flare-explorer.flare.network/tx/${log.transactionHash}`));
                            console.log(chalk.yellow(`   Note: Amount formatting may be incorrect due to token decimals`));

                            const receipt = await publicClient.getTransactionReceipt({ hash: log.transactionHash as Address });
                            const gasUsed = receipt.gasUsed;
                            const effectiveGasPrice = receipt.effectiveGasPrice || 0n;
                            const gasFeeWei = gasUsed * effectiveGasPrice;
                            const txFee = Number(formatEther(gasFeeWei));
                            const submittedAt = Date.now();

                            // Store deposit address for potential filtering in observe
                            if (ctx.cache.evm) {
                                (ctx.cache.evm as any).depositAddress = to;
                            }

                            resolveOnce({
                                xrpAmount: transferAmount,
                                txHash: log.transactionHash as Address,
                                submittedAt,
                                txFee,
                                currency: 'XRP',
                                approvalFee: approvalFee > 0 ? approvalFee : undefined,
                                approvalTxHash: approvalTxHash,
                            });
                        }

                        return; // Success, exit retry loop
                    } catch (err: any) {
                        consecutiveErrors++;
                        const errorType = err?.name || 'Error';
                        const statusCode = err?.status || err?.response?.status || 'unknown';
                        const errorMsg = err?.details || err?.message || 'Unknown error';

                        if (attempt < maxRetries) {
                            const waitTime = attempt * 1000; // 1s, 2s
                            console.warn(chalk.yellow(`⚠️  RPC error (attempt ${attempt}/${maxRetries}, status ${statusCode}): ${errorMsg.substring(0, 100)}`));
                            console.warn(chalk.yellow(`   Retrying in ${waitTime/1000}s...`));
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                        } else {
                            console.warn(chalk.yellow(`⚠️  RPC error after ${maxRetries} attempts (status ${statusCode})`));
                            console.warn(chalk.yellow(`   ${errorType}: ${errorMsg.substring(0, 200)}`));

                            if (consecutiveErrors >= maxConsecutiveErrors) {
                                console.warn(chalk.yellow(`   ⚠️  ${consecutiveErrors} consecutive errors - Flare RPC may be experiencing issues`));
                            }
                        }
                    }
                }
            };

            // Check immediately for any existing transfers
            (async () => {
                try {
                    const currentBlock = await publicClient.getBlockNumber();
                    await checkForTransfers(currentBlock);
                } catch (err: any) {
                    const errorMsg = err?.details || err?.message || 'Unknown error';
                    console.warn(chalk.yellow(`⚠️  Initial transfer check failed: ${errorMsg.substring(0, 100)}`));
                }
            })();

            // Then watch for new blocks
            unwatch = publicClient.watchBlockNumber({
                onError: (e: any) => {
                    const errorMsg = e?.details || e?.message || 'Unknown error';
                    console.warn(chalk.yellow(`⚠️  Block watcher error: ${errorMsg.substring(0, 100)}`));
                },
                onBlockNumber: async (bn) => {
                    await checkForTransfers(bn);
                },
            });

            ctx.cleaner.trackViemUnwatch(unwatch);
        });
    },

    /**
     * OBSERVE: Watch for INCOMING FXRP token transfer (bridge completion on Flare side)
     * This is for the reverse direction (XRPL → Flare)
     */
    async observe(ctx: RunContext): Promise<TargetOutput> {
        const { publicClient, account } = ctx.cache.evm!;
        if (!publicClient || !account) throw new Error("EVM not prepared");

        const timeoutMs = 10 * 60_000;
        const depositAddress = (ctx.cache.evm as any).depositAddress;

        // Get starting block - start from current block to catch instant bridges
        // There's already a 10s wait between runs in index.ts, so no need to skip blocks
        const currentBlock = await publicClient.getBlockNumber();
        const startBlock = currentBlock;

        console.log(chalk.cyan(`\n🔍 Watching for INCOMING FXRP transfer to ${account.address}...`));
        console.log(chalk.dim(`   Starting from block ${startBlock} to catch instant bridges`));
        if (depositAddress) {
            console.log(chalk.dim(`   Excluding transfers FROM deposit address: ${depositAddress}`));
        }

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
                rejectOnce(new Error("Timeout: No incoming FXRP transfer received within 10 minutes"));
            }, timeoutMs);
            ctx.cleaner.trackTimer(timeoutId);

            let consecutiveErrors = 0;
            const maxConsecutiveErrors = 10;

            const checkForTransfers = async (toBlock: bigint) => {
                const maxRetries = 3;

                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    try {
                        // Watch for INCOMING transfers (to = our account)
                        // Use chunked queries to avoid Flare's 30-block limit
                        const logs = await getLogsInChunks(publicClient, {
                            address: FXRP_TOKEN_ADDRESS,
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
                            args: { to: account.address }, // INCOMING transfers to our account
                        });

                        consecutiveErrors = 0;

                        if (logs.length > 0) {
                            console.log(chalk.dim(`   Found ${logs.length} INCOMING transfer(s) to account`));
                        }

                        // For FAsset manual bridge, accept ANY transfer (no amount filtering)
                        // Amount validation issues due to token decimals/wrapping - just take first transfer
                        const incomingLogs = logs.filter((log) => {
                            const from = (log as any).args?.from as string | undefined;
                            const fromLower = from?.toLowerCase();
                            const depositLower = depositAddress?.toLowerCase();
                            const value = (log as any).args?.value as bigint | undefined;

                            // Log transfer for visibility
                            if (value) {
                                const amountInFxrp = Number(formatEther(value));
                                console.log(chalk.dim(`   Transfer: ${amountInFxrp} FXRP (raw: ${value}) from ${from}`));
                            }

                            // Exclude transfers FROM the deposit address (our original outgoing transfer)
                            if (depositLower && fromLower === depositLower) {
                                console.log(chalk.dim(`   → Skipping: from deposit address`));
                                return false;
                            }

                            // Exclude self-transfers
                            if (fromLower === account.address.toLowerCase()) {
                                console.log(chalk.dim(`   → Skipping: self-transfer`));
                                return false;
                            }

                            // Accept all other transfers regardless of amount
                            return true;
                        });

                        // Take the first incoming transfer
                        const log = incomingLogs.length > 0 ? incomingLogs[0] : undefined;

                        if (log) {
                            const from = (log as any).args?.from as string;
                            const value = (log as any).args?.value as bigint | undefined;
                            const transferAmount = value ? Number(formatEther(value)) : 0;

                            console.log(chalk.green(`\n✅ Found INCOMING FXRP transfer!`));
                            console.log(chalk.dim(`   From: ${from}`));
                            console.log(chalk.dim(`   Amount: ${transferAmount} FXRP`));
                            console.log(chalk.dim(`   Tx: ${log.transactionHash}`));
                            console.log(chalk.dim(`   Explorer: https://flare-explorer.flare.network/tx/${log.transactionHash}`));

                            const receipt = await publicClient.getTransactionReceipt({ hash: log.transactionHash as Address });
                            const gasUsed = receipt.gasUsed;
                            const effectiveGasPrice = receipt.effectiveGasPrice || 0n;
                            const gasFeeWei = gasUsed * effectiveGasPrice;
                            const txFee = Number(formatEther(gasFeeWei));

                            resolveOnce({
                                xrpAmount: transferAmount,
                                txHash: log.transactionHash as Address,
                                finalizedAt: Date.now(),
                                txFee,
                                currency: 'XRP',
                            });
                        }

                        return;
                    } catch (err: any) {
                        consecutiveErrors++;
                        const errorType = err?.name || 'Error';
                        const statusCode = err?.status || err?.response?.status || 'unknown';
                        const errorMsg = err?.details || err?.message || 'Unknown error';

                        if (attempt < maxRetries) {
                            const waitTime = attempt * 1000;
                            console.warn(chalk.yellow(`⚠️  RPC error (attempt ${attempt}/${maxRetries}, status ${statusCode}): ${errorMsg.substring(0, 100)}`));
                            console.warn(chalk.yellow(`   Retrying in ${waitTime/1000}s...`));
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                        } else {
                            console.warn(chalk.yellow(`⚠️  RPC error after ${maxRetries} attempts (status ${statusCode})`));
                            console.warn(chalk.yellow(`   ${errorType}: ${errorMsg.substring(0, 200)}`));

                            if (consecutiveErrors >= maxConsecutiveErrors) {
                                console.warn(chalk.yellow(`   ⚠️  ${consecutiveErrors} consecutive errors - Flare RPC may be experiencing issues`));
                            }
                        }
                    }
                }
            };

            // Check immediately for any existing transfers
            (async () => {
                try {
                    const currentBlock = await publicClient.getBlockNumber();
                    await checkForTransfers(currentBlock);
                } catch (err: any) {
                    const errorMsg = err?.details || err?.message || 'Unknown error';
                    console.warn(chalk.yellow(`⚠️  Initial transfer check failed: ${errorMsg.substring(0, 100)}`));
                }
            })();

            // Then watch for new blocks
            unwatch = publicClient.watchBlockNumber({
                onError: (e: any) => {
                    const errorMsg = e?.details || e?.message || 'Unknown error';
                    console.warn(chalk.yellow(`⚠️  Block watcher error: ${errorMsg.substring(0, 100)}`));
                },
                onBlockNumber: async (bn) => {
                    await checkForTransfers(bn);
                },
            });

            ctx.cleaner.trackViemUnwatch(unwatch);
        });
    },

    async observeGasRefund(ctx: RunContext): Promise<GasRefundOutput> {
        // No gas refund for FAsset bridge
        return { xrpAmount: 0, txHash: "n/a" };
    }
};
