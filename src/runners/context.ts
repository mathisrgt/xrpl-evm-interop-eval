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

    // Calculate native currency costs
    // For cross-currency bridges (like Near Intents), we can only calculate fees in USD
    const sourceFee = srcOutput.txFee;
    const targetFee = trgOutput.txFee;
    const bridgeFee = (isFasset || isCrossCurrency) ? null : (srcOutput.xrpAmount - trgOutput.xrpAmount - gasRefund);
    const totalBridgeCost = (isFasset || isCrossCurrency) ? null : (srcOutput.xrpAmount + srcOutput.txFee - gasRefund - trgOutput.xrpAmount);
    const totalCost = (isFasset || isCrossCurrency) ? null : (srcOutput.xrpAmount + srcOutput.txFee - gasRefund);

    // Convert all costs to USD using prices at transaction time
    // Use the USD values already in the output if available, otherwise convert
    let sourceFeeUsd: number | null = null;
    let targetFeeUsd: number | null = null;
    let bridgeFeeUsd: number | null = null;
    let totalBridgeCostUsd: number | null = null;
    let totalCostUsd: number | null = null;

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

    // Convert all costs to USD using prices at transaction time
    sourceFeeUsd = srcOutput.txFeeUsd ?? (
        srcOutput.currency ? await convertWithRetry(sourceFee, srcOutput.currency, srcOutput.submittedAt, 'source transaction fee') : null
    );

    targetFeeUsd = trgOutput.txFeeUsd ?? (
        trgOutput.currency ? await convertWithRetry(targetFee, trgOutput.currency, trgOutput.finalizedAt, 'target transaction fee') : null
    );

    // For native currency bridge fees (only when same currency)
    if (bridgeFee !== null && srcOutput.currency) {
        bridgeFeeUsd = await convertWithRetry(bridgeFee, srcOutput.currency, srcOutput.submittedAt, 'bridge fee');
    }

    if (totalBridgeCost !== null && srcOutput.currency) {
        totalBridgeCostUsd = await convertWithRetry(totalBridgeCost, srcOutput.currency, srcOutput.submittedAt, 'total bridge cost');
    }

    if (totalCost !== null && srcOutput.currency) {
        totalCostUsd = await convertWithRetry(totalCost, srcOutput.currency, srcOutput.submittedAt, 'total cost');
    }

    // For cross-currency bridges, calculate USD fees directly from converted amounts
    if (isCrossCurrency && !isFasset) {
        // Convert source and target amounts to USD
        const sourceAmountUsd = srcOutput.currency
            ? await convertWithRetry(srcOutput.xrpAmount, srcOutput.currency, srcOutput.submittedAt, 'source amount')
            : null;

        const targetAmountUsd = trgOutput.currency
            ? await convertWithRetry(trgOutput.xrpAmount, trgOutput.currency, trgOutput.finalizedAt, 'target amount')
            : null;

        // Calculate USD-based fees
        if (sourceAmountUsd !== null && targetAmountUsd !== null) {
            bridgeFeeUsd = sourceAmountUsd - targetAmountUsd;
            totalBridgeCostUsd = sourceAmountUsd + (sourceFeeUsd || 0) - targetAmountUsd;
            totalCostUsd = sourceAmountUsd + (sourceFeeUsd || 0);
        }
    }

    // Validate for negative costs (data integrity check)
    const validateNegativeCost = async (costValue: number | null, costName: string, currency: string) => {
        if (costValue !== null && costValue < 0) {
            const action = await askNegativeCostAction(costName, costValue, currency);

            if (action === 'ignore-run') {
                throw new RunIgnoredException(`User chose to ignore run due to negative ${costName}: ${costValue} ${currency}`);
            } else if (action === 'abort-batch') {
                throw new BatchAbortedException(`User chose to abort batch due to negative ${costName}: ${costValue} ${currency}`);
            }
        }
    };

    // Check all native currency costs (only for same-currency bridges)
    if (!isCrossCurrency) {
        if (srcOutput.currency) {
            await validateNegativeCost(sourceFee, 'source fee', srcOutput.currency);
            await validateNegativeCost(bridgeFee, 'bridge fee', srcOutput.currency);
            await validateNegativeCost(totalBridgeCost, 'total bridge cost', srcOutput.currency);
            await validateNegativeCost(totalCost, 'total cost', srcOutput.currency);
        }
        if (trgOutput.currency) {
            await validateNegativeCost(targetFee, 'target fee', trgOutput.currency);
        }
    }

    // Check all USD costs
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