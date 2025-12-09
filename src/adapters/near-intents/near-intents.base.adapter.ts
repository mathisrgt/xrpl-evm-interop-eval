import { Address, createPublicClient, createWalletClient, erc20Abi, formatEther, formatUnits, http, parseUnits } from "viem";
import chalk from "chalk";
import { BalanceCheckResult, ChainAdapter, GasRefundOutput, RunContext, SourceOutput, TargetOutput } from "../../types";
import { base } from "../../utils/chains";
import { NEAR_INTENTS_TOKEN_IDS, USDC_BASE_ADDRESS } from "../../utils/constants";
import { getEvmAccount, ONE_CLICK_JWT } from "../../utils/environment";
import { OneClickService, OpenAPI, QuoteRequest } from "@defuse-protocol/one-click-sdk-typescript";
import { convertToUsd } from "../../utils/price-converter";
import { askPriceConversionAction, BatchAbortedException, RunIgnoredException } from "../../utils/data-integrity";

/**
 * Helper function to fetch XRP price with retry logic and user prompts
 */
async function fetchXrpPriceWithRetry(): Promise<number> {
    let retries = 3;

    while (true) {
        try {
            const price = await convertToUsd(1, 'XRP');
            return price;
        } catch (error) {
            retries--;
            if (retries === 0) {
                const action = await askPriceConversionAction('XRP', 1, error as Error);

                if (action === 'retry') {
                    retries = 3; // Reset retries
                    continue;
                } else if (action === 'ignore-run') {
                    throw new RunIgnoredException('User chose to ignore run due to failed XRP price fetch');
                } else if (action === 'abort-batch') {
                    throw new BatchAbortedException('User chose to abort batch due to failed XRP price fetch');
                }
            }
        }
    }
}

export const baseAdapter: ChainAdapter = {

    async prepare(ctx: RunContext) {

        const publicClient = createPublicClient({
            chain: base,
            transport: http()
        });

        const walletClient = createWalletClient({
            chain: base,
            transport: http()
        });

        const account = getEvmAccount();
        ctx.cache.evm = { publicClient, walletClient, account, chain: base };
    },

    /** Check if wallet has sufficient balance for the transaction */
    async checkBalance(ctx: RunContext): Promise<BalanceCheckResult> {
        const { publicClient, account } = ctx.cache.evm!;
        if (!publicClient || !account) throw new Error("EVM not prepared");

        // Fetch real XRP price to calculate accurate USDC amount needed
        console.log(chalk.cyan('💱 Fetching XRP price...'));
        const xrpPriceUsd = await fetchXrpPriceWithRetry();
        console.log(chalk.dim(`   XRP price: $${xrpPriceUsd.toFixed(4)}`));

        // Calculate USDC needed: XRP amount * XRP price + 10% slippage buffer
        const slippageBuffer = 1.10; // 10% buffer for price slippage and fees
        const usdcAmount = ctx.cfg.xrpAmount * xrpPriceUsd * slippageBuffer;

        console.log(chalk.dim(`   USDC needed: ${ctx.cfg.xrpAmount} XRP × $${xrpPriceUsd.toFixed(4)} × ${slippageBuffer} = ${usdcAmount.toFixed(2)} USDC`));

        // Get USDC balance
        const usdcBal = await publicClient.readContract({
            address: USDC_BASE_ADDRESS,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [account.address as `0x${string}`]
        });
        const currentUsdcBalance = Number(formatUnits(usdcBal as bigint, 6));

        // Get ETH balance for gas
        const ethBalWei = await publicClient.getBalance({ address: account.address as `0x${string}` });
        const currentEthBalance = Number(formatEther(ethBalWei));

        // Calculate required balances
        const requiredUsdcBalance = usdcAmount;
        const minEthForGas = 0.001; // Minimum 0.001 ETH for gas fees

        const sufficientUsdc = currentUsdcBalance >= requiredUsdcBalance;
        const sufficientEth = currentEthBalance >= minEthForGas;
        const sufficient = sufficientUsdc && sufficientEth;

        let message = '';
        if (sufficient) {
            message = `Balance sufficient: ${currentUsdcBalance.toFixed(2)} USDC (need ${requiredUsdcBalance.toFixed(2)} USDC), ${currentEthBalance.toFixed(4)} ETH (need ${minEthForGas} ETH for gas)`;
        } else {
            const issues = [];
            if (!sufficientUsdc) issues.push(`USDC: ${currentUsdcBalance.toFixed(2)}/${requiredUsdcBalance.toFixed(2)}`);
            if (!sufficientEth) issues.push(`ETH: ${currentEthBalance.toFixed(4)}/${minEthForGas} (for gas)`);
            message = `Insufficient balance: ${issues.join(', ')}`;
        }

        return {
            sufficient,
            currentBalance: currentUsdcBalance,
            requiredBalance: requiredUsdcBalance,
            currency: 'USDC',
            message
        };
    },

    async submit(ctx: RunContext): Promise<SourceOutput> {
        const { account, walletClient, publicClient } = ctx.cache.evm!;
        const { wallet: xrplWallet } = ctx.cache.xrpl!;

        if (!walletClient || !account || !publicClient || !xrplWallet) {
            throw new Error("EVM or XRPL not prepared");
        }

        OpenAPI.BASE = 'https://1click.chaindefuser.com';
        OpenAPI.TOKEN = ONE_CLICK_JWT;

        // Fetch real XRP price to calculate accurate USDC amount needed
        console.log(chalk.cyan('💱 Fetching XRP price...'));
        const xrpPriceUsd = await fetchXrpPriceWithRetry();
        console.log(chalk.dim(`   XRP price: $${xrpPriceUsd.toFixed(4)}`));

        // Calculate USDC needed: XRP amount * XRP price + 10% slippage buffer
        const slippageBuffer = 1.10; // 10% buffer for price slippage and fees
        const usdcAmountFloat = ctx.cfg.xrpAmount * xrpPriceUsd * slippageBuffer;
        const usdcAmount = parseUnits(usdcAmountFloat.toFixed(6), 6); // Convert to USDC units (6 decimals)

        console.log(chalk.dim(`   USDC needed: ${ctx.cfg.xrpAmount} XRP × $${xrpPriceUsd.toFixed(4)} × ${slippageBuffer} = ${usdcAmountFloat.toFixed(2)} USDC`));

        console.log(`\n📋 Near Intents Quote Request:`);
        console.log(`   Origin: USDC on Base → Destination: XRP on XRPL`);
        console.log(`   Amount: ${formatUnits(usdcAmount, 6)} USDC (${ctx.cfg.xrpAmount} XRP at $${xrpPriceUsd.toFixed(4)})`);
        console.log(`   Recipient (XRPL): ${xrplWallet.address}`);
        console.log(`   Refund To (Base): ${account.address}`);

        const quoteRequest: QuoteRequest = {
            dry: false,
            swapType: QuoteRequest.swapType.EXACT_INPUT,
            slippageTolerance: 100,
            originAsset: NEAR_INTENTS_TOKEN_IDS.USDC_ON_BASE,
            depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
            destinationAsset: NEAR_INTENTS_TOKEN_IDS.XRP_ON_XRPL,
            amount: usdcAmount.toString(),
            refundTo: account.address,
            refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
            recipient: xrplWallet.address,
            recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
            deadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
            referral: "xrpl-evm-interop-eval",
            quoteWaitingTimeMs: 3000,
        };

        // Retry logic for getting quote (max 3 attempts)
        let quote;
        let lastError;
        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`\n🔄 Quote attempt ${attempt}/${maxRetries}...`);
                quote = await OneClickService.getQuote(quoteRequest);
                console.log(`✅ Quote obtained successfully`);
                break; // Success, exit retry loop
            } catch (error: any) {
                lastError = error;
                console.log(`❌ Quote attempt ${attempt}/${maxRetries} failed: ${error.message || error}`);

                if (attempt < maxRetries) {
                    const waitTime = attempt * 2000; // Exponential backoff: 2s, 4s
                    console.log(`⏳ Waiting ${waitTime/1000}s before retry...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                } else {
                    console.log(`❌ All ${maxRetries} quote attempts failed`);
                    throw new Error(`Failed to get Near Intents quote after ${maxRetries} attempts: ${error.message || error}`);
                }
            }
        }

        if (!quote) {
            throw new Error(`Failed to get Near Intents quote: ${lastError?.message || 'Unknown error'}`);
        }

        if (!quote.quote?.depositAddress) {
            throw new Error("No deposit address in quote");
        }

        if (!ctx.cache.evm) {
            throw new Error("No xrpl environment in cache");
        }

        const depositAddress = quote.quote?.depositAddress;
        ctx.cache.evm.depositAddress = depositAddress;
        ctx.txs.depositAddress = depositAddress; // Save for explorer URL generation

        console.log(`\n✅ Near Intents Quote Received:`);
        console.log(`   Deposit Address: ${depositAddress}`);
        console.log(`   Deadline: ${new Date(Date.now() + 3 * 60 * 1000).toISOString()}`);

        const submittedAt = Date.now();

        console.log(`\n💸 Transferring USDC to Near Intents deposit address...`);

        const txHash = await walletClient.writeContract({
            account,
            address: USDC_BASE_ADDRESS,
            abi: erc20Abi,
            functionName: 'transfer',
            args: [depositAddress as Address, usdcAmount],
            chain: base
        });

        console.log(`   Tx Hash: ${txHash}`);
        console.log(`   Waiting for confirmation...`);

        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

        console.log(`✅ USDC Transfer Confirmed (Block ${receipt.blockNumber})`);
        console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);
        console.log(`   Status: ${receipt.status === 'success' ? '✅ Success' : '❌ Failed'}`);

        const gasUsed = receipt.gasUsed;
        const effectiveGasPrice = receipt.effectiveGasPrice || 0n;
        const gasFeeWei = gasUsed * effectiveGasPrice;
        const txFee = Number(formatEther(gasFeeWei));

        // For near-intents Base→XRPL, we send USDC (native stablecoin on source chain)
        // Record the intended USDC amount (without slippage buffer) for accurate bridge fee calculation
        // The 10% slippage buffer is for protection but shouldn't count as a "bridge fee"
        const intendedUsdcAmount = ctx.cfg.xrpAmount * xrpPriceUsd;
        return { xrpAmount: intendedUsdcAmount, txHash, submittedAt, txFee, currency: 'USDC' };
    },

    async observe(ctx: RunContext): Promise<TargetOutput> {
        const { publicClient, account, depositAddress } = ctx.cache.evm!;
        if (!publicClient || !account) throw new Error("EVM not prepared");

        const timeoutMs = 10 * 60_000; // 10 minutes timeout

        // There's already a 10s wait between runs in index.ts, so no need to skip blocks
        const submitBlockNumber = (ctx.cache.evm as any).submitBlockNumber;
        const currentBlock = await publicClient.getBlockNumber();
        const startBlock = submitBlockNumber || currentBlock;

        console.log(`🔍 Watching for USDC transfers to ${account.address} on Base (from block ${startBlock})`);
        if (submitBlockNumber) {
            console.log(chalk.dim(`   Starting from submit block: ${submitBlockNumber}`));
        } else {
            console.log(chalk.dim(`   Starting from current block ${currentBlock}`));
        }
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
                rejectOnce(new Error("Timeout: Near Intents execution not completed"));
            }, timeoutMs);
            ctx.cleaner.trackTimer(timeoutId);

            // Track consecutive errors for exponential backoff
            let consecutiveErrors = 0;
            const maxConsecutiveErrors = 10; // Don't give up, but slow down if many errors

            // Function to check for transfers in a given block range with retry logic
            const checkForTransfers = async (toBlock: bigint) => {
                const maxRetries = 3;
                let lastError;

                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    try {
                        const logs = await publicClient.getLogs({
                            address: USDC_BASE_ADDRESS,
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

                        // Success - reset error counter
                        consecutiveErrors = 0;

                        if (logs.length > 0) {
                            console.log(`   Found ${logs.length} transfer(s) to account`);
                        }

                        // Filter out the outgoing transfer to deposit address
                        const incomingLogs = logs.filter((log) => {
                            const from = (log as any).args?.from as string | undefined;
                            const fromLower = from?.toLowerCase();
                            const depositLower = depositAddress?.toLowerCase();

                            // Skip if this is the same transaction hash from the previous run
                            if (ctx.previousTargetTxHash && log.transactionHash === ctx.previousTargetTxHash) {
                                console.log(`   Skipping previous run's transaction (hash: ${log.transactionHash?.substring(0, 10)}...)`);
                                return false;
                            }

                            // Exclude transfers FROM the deposit address (our outgoing transfer)
                            if (depositLower && fromLower === depositLower) {
                                console.log(`   Skipping outgoing transfer to deposit address in tx ${log.transactionHash}`);
                                return false;
                            }

                            // Exclude transfers FROM our own account (self-transfers)
                            if (fromLower === account.address.toLowerCase()) {
                                console.log(`   Skipping self-transfer in tx ${log.transactionHash}`);
                                return false;
                            }

                            return true;
                        });

                        // Take the first incoming transfer (not the last)
                        const log = incomingLogs.length > 0 ? incomingLogs[0] : undefined;

                        if (log) {
                            const from = (log as any).args?.from as string;
                            const value = (log as any).args?.value as bigint | undefined;
                            const targetAmount = value ? Number(formatUnits(value, 6)) : 0;

                            console.log(`✅ Found incoming USDC transfer!`);
                            console.log(`   From: ${from}`);
                            console.log(`   Amount: ${targetAmount} USDC`);
                            console.log(`   Tx: ${log.transactionHash}`);

                            const receipt = await publicClient.getTransactionReceipt({ hash: log.transactionHash as Address });
                            const gasUsed = receipt.gasUsed;
                            const effectiveGasPrice = receipt.effectiveGasPrice || 0n;
                            const gasFeeWei = gasUsed * effectiveGasPrice;
                            const txFee = Number(formatEther(gasFeeWei));

                            // For near-intents XRPL→Base, we receive USDC (stablecoin on target chain)
                            resolveOnce({
                                xrpAmount: targetAmount,
                                txHash: log.transactionHash as Address,
                                finalizedAt: Date.now(),
                                txFee,
                                currency: 'USDC',
                            });
                        }

                        return; // Success, exit retry loop
                    } catch (err: any) {
                        lastError = err;
                        consecutiveErrors++;

                        const errorType = err?.name || 'Error';
                        const statusCode = err?.status || err?.response?.status || 'unknown';
                        const errorMsg = err?.details || err?.message || 'Unknown error';

                        if (attempt < maxRetries) {
                            const waitTime = attempt * 1000; // 1s, 2s
                            console.warn(`⚠️  RPC error (attempt ${attempt}/${maxRetries}, status ${statusCode}): ${errorMsg.substring(0, 100)}`);
                            console.warn(`   Retrying in ${waitTime/1000}s...`);
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                        } else {
                            // Log error but don't reject - just warn and continue watching
                            console.warn(`⚠️  RPC error after ${maxRetries} attempts (status ${statusCode})`);
                            console.warn(`   ${errorType}: ${errorMsg.substring(0, 200)}`);

                            if (consecutiveErrors >= maxConsecutiveErrors) {
                                console.warn(`   ⚠️  ${consecutiveErrors} consecutive errors - Base RPC may be experiencing issues`);
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
                    console.warn(`⚠️  Initial transfer check failed: ${errorMsg.substring(0, 100)}`);
                }
            })();

            // Then watch for new blocks
            unwatch = publicClient.watchBlockNumber({
                onError: (e: any) => {
                    const errorMsg = e?.details || e?.message || 'Unknown error';
                    console.warn(`⚠️  Block watcher error: ${errorMsg.substring(0, 100)}`);
                    // Don't reject immediately - RPC issues are often temporary
                },
                onBlockNumber: async (bn) => {
                    // checkForTransfers handles its own errors with retry logic
                    await checkForTransfers(bn);
                },
            });

            ctx.cleaner.trackViemUnwatch(unwatch);
        });
    },

    async observeGasRefund(ctx: RunContext): Promise<GasRefundOutput> {
        return { xrpAmount: 0, txHash: "n/a" };
    }
}
