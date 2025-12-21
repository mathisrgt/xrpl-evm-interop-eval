import chalk from "chalk";
import { GasRefundOutput, RunConfig, RunContext, RunRecord, SourceOutput, TargetOutput } from "../types";
import { CleanupManager } from "../utils/cleanup";
import { convertToUsd } from "../utils/price-converter";
import { askPriceConversionAction, askNegativeCostAction, BatchAbortedException, RunIgnoredException } from "../utils/data-integrity";

/**
 * Detect error type from error message
 * Returns a standardized error type string or undefined if not detected
 */
function detectErrorType(errorMessage?: string): string | undefined {
    if (!errorMessage) return undefined;

    const lowerError = errorMessage.toLowerCase();

    // Timeout errors
    if (lowerError.includes('timeout')) {
        return 'TIMEOUT';
    }

    // Funding/balance errors
    if (lowerError.includes('not funded') ||
        lowerError.includes('insufficient') ||
        lowerError.includes('underfunded') ||
        lowerError.includes('unfunded')) {
        return 'NOT_FUNDED_ADDRESS';
    }

    // Network/connection errors
    if (lowerError.includes('network') ||
        lowerError.includes('connection') ||
        lowerError.includes('disconnected')) {
        return 'NETWORK_ERROR';
    }

    // Transaction errors
    if (lowerError.includes('transaction failed') ||
        lowerError.includes('tx failed') ||
        lowerError.includes('reverted')) {
        return 'TRANSACTION_FAILED';
    }

    // Gas errors
    if (lowerError.includes('gas') && lowerError.includes('low')) {
        return 'INSUFFICIENT_GAS';
    }

    // RPC errors
    if (lowerError.includes('rpc') || lowerError.includes('rate limit')) {
        return 'RPC_ERROR';
    }

    // If no specific pattern matched, return undefined (empty field)
    return undefined;
}

/**
 * Create a new RunContext with initialized empty state
 */
export function createRunContext(cfg: RunConfig): RunContext {
    
    const runId = `${cfg.tag}_run${cfg.runs}`;

    return {
        cfg,
        runId,
        ts: {
            t0_prepare: undefined,
            t1_submit: undefined,
            t2_observe: undefined,
            t3_finalized: undefined,
        },
        txs: {
            sourceTxHash: undefined,
            targetTxHash: undefined,
            bridgeMessageId: undefined,
        },
        cache: {
            xrpl: undefined,
            evm: undefined,
        },
        cleaner: new CleanupManager()
    };
}

/**
 * Create a RunRecord from a completed RunContext
 * Converts all amounts to USD at transaction time for accurate metrics
 */
export async function createRunRecord(
    ctx: RunContext,
    srcOutput: SourceOutput,
    trgOutput: TargetOutput,
    success: boolean,
    gasRfdOutput?: GasRefundOutput,
    abortReason?: string
): Promise<RunRecord> {
    const gasRefund = gasRfdOutput?.xrpAmount || 0;

    // For FAsset manual bridge, don't calculate bridge fees (token decimals issues)
    // Just record transaction fees
    const isFasset = ctx.cfg.bridgeName === 'fasset';

    // Check if source and target use different currencies (e.g., XRP vs USDC)
    const isCrossCurrency = srcOutput.currency !== trgOutput.currency;

    // Helper function to convert with retry logic
    const convertWithRetry = async (amount: number, currency: string, timestamp: number, description: string): Promise<number | null> => {
        let maxRetries = 3;
        while (maxRetries > 0) {
            try {
                return await convertToUsd(amount, currency, timestamp);
            } catch (error) {
                maxRetries--;
                if (maxRetries === 0) {
                    // Ask user what to do
                    const action = await askPriceConversionAction(currency, amount, error as Error);

                    if (action === 'retry') {
                        maxRetries = 3; // Reset retries
                        continue;
                    } else if (action === 'ignore-run') {
                        throw new RunIgnoredException(`User chose to ignore run due to failed price conversion for ${description}`);
                    } else if (action === 'abort-batch') {
                        throw new BatchAbortedException(`User chose to abort batch due to failed price conversion for ${description}`);
                    }
                }
            }
        }
        return null;
    };

    // Initialize fee variables
    let sourceFee: number | null = null;
    let targetFee: number | null = null;
    let bridgeFee: number | null = null;
    let totalBridgeCost: number | null = null;
    let totalCost: number | null = null;
    let sourceFeeUsd: number | null = null;
    let targetFeeUsd: number | null = null;
    let bridgeFeeUsd: number | null = null;
    let totalBridgeCostUsd: number | null = null;
    let totalCostUsd: number | null = null;

    // Calculate fees based on currency type
    if (isCrossCurrency || isFasset) {
        // For cross-currency bridges, calculate all fees in USD
        // Convert gas refund to USD if present
        let gasRefundUsd = 0;
        if (gasRefund > 0 && srcOutput.currency) {
            gasRefundUsd = await convertWithRetry(gasRefund, srcOutput.currency, srcOutput.submittedAt, 'gas refund') || 0;
        }

        // Convert source and target amounts to USD
        const sourceAmountUsd = srcOutput.currency
            ? await convertWithRetry(srcOutput.xrpAmount, srcOutput.currency, srcOutput.submittedAt, 'source amount')
            : null;

        const targetAmountUsd = trgOutput.currency
            ? await convertWithRetry(trgOutput.xrpAmount, trgOutput.currency, trgOutput.finalizedAt, 'target amount')
            : null;

        // Convert transaction fees to USD
        const sourceTxFeeUsd = srcOutput.txFeeUsd ?? (
            srcOutput.currency ? await convertWithRetry(srcOutput.txFee, srcOutput.currency, srcOutput.submittedAt, 'source transaction fee') : null
        );

        const targetTxFeeUsd = trgOutput.txFeeUsd ?? (
            trgOutput.currency ? await convertWithRetry(trgOutput.txFee, trgOutput.currency, trgOutput.finalizedAt, 'target transaction fee') : null
        );

        // Convert approval fees to USD if present
        let sourceApprovalFeeUsd: number | null = null;
        if (srcOutput.approvalFee) {
            const approvalCurrency = 'FLR'; // Approval always pays in native token
            sourceApprovalFeeUsd = srcOutput.approvalFeeUsd ?? await convertWithRetry(
                srcOutput.approvalFee,
                approvalCurrency,
                srcOutput.submittedAt,
                'source approval transaction fee'
            );
        }

        let targetApprovalFeeUsd: number | null = null;
        if (trgOutput.approvalFee) {
            const approvalCurrency = 'FLR';
            targetApprovalFeeUsd = trgOutput.approvalFeeUsd ?? await convertWithRetry(
                trgOutput.approvalFee,
                approvalCurrency,
                trgOutput.finalizedAt,
                'target approval transaction fee'
            );
        }

        // Calculate total fees in USD
        sourceFeeUsd = sourceTxFeeUsd;
        if (sourceFeeUsd !== null && sourceApprovalFeeUsd !== null) {
            sourceFeeUsd += sourceApprovalFeeUsd;
        } else if (sourceApprovalFeeUsd !== null) {
            sourceFeeUsd = sourceApprovalFeeUsd;
        }

        targetFeeUsd = targetTxFeeUsd;
        if (targetFeeUsd !== null && targetApprovalFeeUsd !== null) {
            targetFeeUsd += targetApprovalFeeUsd;
        } else if (targetApprovalFeeUsd !== null) {
            targetFeeUsd = targetApprovalFeeUsd;
        }

        // Calculate bridge fees in USD
        if (sourceAmountUsd !== null && targetAmountUsd !== null) {
            bridgeFeeUsd = sourceAmountUsd - targetAmountUsd - gasRefundUsd;
            totalBridgeCostUsd = sourceAmountUsd + (sourceFeeUsd || 0) - gasRefundUsd - targetAmountUsd;
            totalCostUsd = sourceAmountUsd + (sourceFeeUsd || 0) - gasRefundUsd;
        }

        // For cross-currency bridges, assign USD values to native currency fields as well
        // This ensures native currency fields are not null but contain USD-denominated values
        sourceFee = sourceFeeUsd;
        targetFee = targetFeeUsd;
        bridgeFee = bridgeFeeUsd;
        totalBridgeCost = totalBridgeCostUsd;
        totalCost = totalCostUsd;
    } else {
        // For same-currency bridges, calculate in native currency first
        // Include approval fee if present (for ERC20 token bridges like FAsset)
        sourceFee = srcOutput.txFee + (srcOutput.approvalFee || 0);
        targetFee = trgOutput.txFee + (trgOutput.approvalFee || 0);
        bridgeFee = srcOutput.xrpAmount - trgOutput.xrpAmount - gasRefund;
        totalBridgeCost = srcOutput.xrpAmount + sourceFee - gasRefund - trgOutput.xrpAmount;
        totalCost = srcOutput.xrpAmount + sourceFee - gasRefund;

        // Convert all native currency costs to USD using prices at transaction time
        // For approval fee, convert separately if not already in USD
        let sourceApprovalFeeUsd: number | null = null;
        if (srcOutput.approvalFee) {
            // Approval fee is typically in the native chain currency (e.g., FLR for Flare)
            // For Flare, currency would be 'FLR', so we need to specify that
            const approvalCurrency = 'FLR'; // Approval always pays in native token
            sourceApprovalFeeUsd = srcOutput.approvalFeeUsd ?? await convertWithRetry(
                srcOutput.approvalFee,
                approvalCurrency,
                srcOutput.submittedAt,
                'source approval transaction fee'
            );
        }

        let targetApprovalFeeUsd: number | null = null;
        if (trgOutput.approvalFee) {
            // Target approval fee is also typically in the native chain currency (e.g., FLR for Flare)
            const approvalCurrency = 'FLR'; // Approval always pays in native token
            targetApprovalFeeUsd = trgOutput.approvalFeeUsd ?? await convertWithRetry(
                trgOutput.approvalFee,
                approvalCurrency,
                trgOutput.finalizedAt,
                'target approval transaction fee'
            );
        }

        // Source fee includes both transaction fee and approval fee
        sourceFeeUsd = srcOutput.txFeeUsd ?? (
            srcOutput.currency ? await convertWithRetry(srcOutput.txFee, srcOutput.currency, srcOutput.submittedAt, 'source transaction fee') : null
        );

        // Add source approval fee in USD if present
        if (sourceFeeUsd !== null && sourceApprovalFeeUsd !== null) {
            sourceFeeUsd += sourceApprovalFeeUsd;
        } else if (sourceApprovalFeeUsd !== null) {
            sourceFeeUsd = sourceApprovalFeeUsd;
        }

        // Target fee calculation (transaction fee only, without approval for now)
        const targetTxFeeOnly = trgOutput.txFee;
        targetFeeUsd = trgOutput.txFeeUsd ?? (
            trgOutput.currency ? await convertWithRetry(targetTxFeeOnly, trgOutput.currency, trgOutput.finalizedAt, 'target transaction fee') : null
        );

        // Add target approval fee in USD if present
        if (targetFeeUsd !== null && targetApprovalFeeUsd !== null) {
            targetFeeUsd += targetApprovalFeeUsd;
        } else if (targetApprovalFeeUsd !== null) {
            targetFeeUsd = targetApprovalFeeUsd;
        }

        // Convert native currency bridge fees to USD
        if (bridgeFee !== null && srcOutput.currency) {
            bridgeFeeUsd = await convertWithRetry(bridgeFee, srcOutput.currency, srcOutput.submittedAt, 'bridge fee');
        }

        if (totalBridgeCost !== null && srcOutput.currency) {
            totalBridgeCostUsd = await convertWithRetry(totalBridgeCost, srcOutput.currency, srcOutput.submittedAt, 'total bridge cost');
        }

        if (totalCost !== null && srcOutput.currency) {
            totalCostUsd = await convertWithRetry(totalCost, srcOutput.currency, srcOutput.submittedAt, 'total cost');
        }
    }

    // Validate for negative costs (data integrity check)
    const validateNegativeCost = async (costValue: number | null, costName: string, currency: string) => {
        if (costValue !== null && costValue < 0) {
            // Accept small negative values < 1 USD without prompting
            if (currency === 'USD' && Math.abs(costValue) < 1) {
                console.log(chalk.dim(`   ℹ️  Small negative ${costName} detected (${costValue.toFixed(4)} ${currency}) - automatically accepted`));
                return;
            }

            const action = await askNegativeCostAction(costName, costValue, currency);

            if (action === 'ignore-run') {
                throw new RunIgnoredException(`User chose to ignore run due to negative ${costName}: ${costValue} ${currency}`);
            } else if (action === 'abort-batch') {
                throw new BatchAbortedException(`User chose to abort batch due to negative ${costName}: ${costValue} ${currency}`);
            } else if (action === 'save-anyway') {
                // User chose to save anyway, so we just continue
                console.log(chalk.dim(`   ℹ️  Continuing with negative ${costName}: ${costValue} ${currency}`));
            }
        }
    };

    // Check all native currency costs
    // For same-currency bridges, validate in native currency
    // For cross-currency bridges, native fields contain USD values, so validate as USD
    const nativeCurrency = (isCrossCurrency || isFasset) ? 'USD' : srcOutput.currency;
    if (nativeCurrency) {
        await validateNegativeCost(sourceFee, 'source fee', nativeCurrency);
        await validateNegativeCost(bridgeFee, 'bridge fee', nativeCurrency);
        await validateNegativeCost(totalBridgeCost, 'total bridge cost', nativeCurrency);
        await validateNegativeCost(totalCost, 'total cost', nativeCurrency);
    }
    if (!isCrossCurrency && !isFasset && trgOutput.currency) {
        await validateNegativeCost(targetFee, 'target fee', trgOutput.currency);
    } else if ((isCrossCurrency || isFasset)) {
        await validateNegativeCost(targetFee, 'target fee', 'USD');
    }

    // Check all USD costs (these will be the same as native for cross-currency)
    await validateNegativeCost(sourceFeeUsd, 'source fee (USD)', 'USD');
    await validateNegativeCost(targetFeeUsd, 'target fee (USD)', 'USD');
    await validateNegativeCost(bridgeFeeUsd, 'bridge fee (USD)', 'USD');
    await validateNegativeCost(totalBridgeCostUsd, 'total bridge cost (USD)', 'USD');
    await validateNegativeCost(totalCostUsd, 'total cost (USD)', 'USD');

    return {
        runId: ctx.cfg.tag,
        cfg: ctx.cfg,
        timestamps: { ...ctx.ts },
        txs: { ...ctx.txs },
        costs: {
            // Native currency values
            sourceFee,
            targetFee,
            bridgeFee,
            totalBridgeCost,
            totalCost,
            // USD values
            sourceFeeUsd,
            targetFeeUsd,
            bridgeFeeUsd,
            totalBridgeCostUsd,
            totalCostUsd,
        },
        success,
        abort_reason: abortReason,
        error_type: detectErrorType(abortReason),
    };
}

export function updateTimestamp(
    ctx: RunContext,
    phase: 't0_prepare' | 't1_submit' | 't2_observe' | 't3_finalized' | 't4_finalized_gas_refund',
    timestamp: number = Date.now()
): void {
    ctx.ts[phase] = timestamp;
}

export function updateTxHash(
    ctx: RunContext,
    txType: 'sourceTxHash' | 'targetTxHash' | 'bridgeMessageId',
    hash: string
): void {
    ctx.txs[txType] = hash;
}