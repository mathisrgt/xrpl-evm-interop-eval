import { Client, dropsToXrp } from "xrpl";
import type { BalanceCheckResult, ChainAdapter, RunContext, SourceOutput, TargetOutput, GasRefundOutput } from "../../types";
import { getXrplWallet } from "../../utils/environment";
import chalk from "chalk";
import { Address, createPublicClient, erc20Abi, formatEther, http } from "viem";
import { flare } from "viem/chains";

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
        console.log('');
        console.log(chalk.bold.cyan('🔗 Use FSwap to bridge: ') + chalk.blue.underline('https://fswap.luminite.app/'));
        console.log(chalk.cyan('═'.repeat(60)));

        // Import getEvmAccount for EVM operations
        const { getEvmAccount } = await import("../../utils/environment");

        // Create Flare EVM client for approval monitoring
        const publicClient = createPublicClient({
            chain: flare,
            transport: http()
        });
        const evmAccount = getEvmAccount();

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
        } catch (error) {
            console.log(chalk.dim(`   Using default 18 decimals for FXRP`));
        }

        // Get starting block for approval monitoring
        const currentBlock = await publicClient.getBlockNumber();
        const startBlock = currentBlock;

        console.log(chalk.cyan(`\n🔍 Step 1: Watching for reserveCollateral transaction on Flare from ${evmAccount.address}...`));
        console.log(chalk.dim(`   Starting from block ${startBlock}`));
        console.log(chalk.dim(`   Looking for AssetManager contract interaction`));

        // First, wait for reserveCollateral transaction on Flare EVM
        // This is the transaction that reserves collateral for minting FXRP
        let reserveCollateralFee = 0;
        let reserveCollateralFeeWei = 0n;
        let reserveCollateralTxHash: string | undefined;

        try {
            const reserveResult = await new Promise<{ fee: number; feeWei: bigint; txHash: string }>((resolve, reject) => {
                let finished = false;

                const timeoutId = setTimeout(() => {
                    if (!finished) {
                        finished = true;
                        clearInterval(pollInterval);
                        reject(new Error("Timeout: No reserveCollateral transaction detected within 10 minutes"));
                    }
                }, timeoutMs);

                const checkForReserveCollateral = async () => {
                    if (finished) return;

                    try {
                        const toBlock = await publicClient.getBlockNumber();

                        // Get all transactions from user's address in the block range
                        let fromBlock = startBlock;
                        const blockRange = toBlock - fromBlock;

                        // Limit block range to avoid RPC issues (max 100 blocks at a time)
                        if (blockRange > 100n) {
                            fromBlock = toBlock - 100n;
                        }

                        // Check blocks one by one for transactions from our address
                        for (let blockNum = fromBlock; blockNum <= toBlock && !finished; blockNum++) {
                            try {
                                const block = await publicClient.getBlock({
                                    blockNumber: blockNum,
                                    includeTransactions: true
                                });

                                if (block && block.transactions) {
                                    for (const tx of block.transactions) {
                                        if (typeof tx === 'object' && tx.from?.toLowerCase() === evmAccount.address.toLowerCase()) {
                                            // Found a transaction from our address
                                            // Check if it has value (collateral payment)
                                            if (tx.value && tx.value > 0n) {
                                                const txHash = tx.hash;

                                                // Get transaction receipt for gas details
                                                const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
                                                const gasUsed = receipt.gasUsed;
                                                const effectiveGasPrice = receipt.effectiveGasPrice || 0n;
                                                const gasFeeWei = gasUsed * effectiveGasPrice;
                                                const fee = Number(formatEther(gasFeeWei));
                                                const collateralValue = Number(formatEther(tx.value));

                                                console.log(chalk.green(`\n✅ Found reserveCollateral transaction on Flare!`));
                                                console.log(chalk.dim(`   Collateral: ${collateralValue.toFixed(6)} FLR`));
                                                console.log(chalk.dim(`   Gas fee: ${fee.toFixed(6)} FLR`));
                                                console.log(chalk.dim(`   Tx: ${txHash}`));
                                                console.log(chalk.dim(`   Block: ${blockNum}`));

                                                finished = true;
                                                clearInterval(pollInterval);
                                                clearTimeout(timeoutId);

                                                resolve({ fee, feeWei: gasFeeWei, txHash });
                                                return;
                                            }
                                        }
                                    }
                                }
                            } catch (blockErr: any) {
                                // Ignore individual block errors, continue checking
                            }
                        }
                    } catch (err: any) {
                        // Ignore errors during polling, will retry
                    }
                };

                // Poll every 3 seconds
                const pollInterval = setInterval(checkForReserveCollateral, 3000);

                // Check immediately (don't wait 3 seconds for first check)
                checkForReserveCollateral();
            });

            reserveCollateralFee = reserveResult.fee;
            reserveCollateralFeeWei = reserveResult.feeWei;
            reserveCollateralTxHash = reserveResult.txHash;

            console.log(chalk.cyan(`\n🔍 Step 2: Watching for OUTGOING XRP payment from ${wallet.address}...`));
            console.log(chalk.dim(`   Waiting for payment ≥ ${ctx.cfg.xrpAmount} XRP`));
        } catch (err) {
            console.log(chalk.yellow(`\n⚠️  No reserveCollateral transaction detected, proceeding to watch for XRP payment...`));
            console.log(chalk.cyan(`🔍 Watching for OUTGOING XRP payment from ${wallet.address}...`));
            console.log(chalk.dim(`   Waiting for payment ≥ ${ctx.cfg.xrpAmount} XRP`));
        }

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
                        approvalFee: reserveCollateralFee > 0 ? reserveCollateralFee : undefined,
                        approvalTxHash: reserveCollateralTxHash,
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

        // Record when observation starts
        const observeStartTime = Date.now();

        console.log(chalk.cyan(`\n🔍 Watching for INCOMING XRP payment to ${wallet.address}...`));
        console.log(chalk.dim(`   Only accepting transactions after ${new Date(observeStartTime).toISOString()}`));
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

                    // Only interested in INCOMING payments to our wallet
                    if (tx.Destination !== wallet.address) return;

                    // Skip if this is the same transaction hash from the previous run
                    if (ctx.previousTargetTxHash && data.hash === ctx.previousTargetTxHash) {
                        console.log(chalk.dim(`   Ignoring previous run's transaction (hash: ${data.hash?.substring(0, 8)}...)`));
                        return;
                    }

                    const deliveredXrp = Number(dropsToXrp(meta?.delivered_amount || tx.Amount));
                    const txFeeXrp = Number(dropsToXrp(tx.Fee));
                    const finalizedAt = Date.now();

                    // Skip small gas return transactions (< 0.001 XRP)
                    if (deliveredXrp < 0.001) {
                        console.log(chalk.dim(`   Ignoring small gas return transaction: ${deliveredXrp.toFixed(6)} XRP (hash: ${data.hash?.substring(0, 8)}...)`));
                        return;
                    }

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
