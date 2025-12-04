import { GasRefundOutput, RunConfig, RunContext, RunRecord, SourceOutput, TargetOutput } from "../types";
import { CleanupManager } from "../utils/cleanup";

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
 */
export function createRunRecord(
    ctx: RunContext,
    srcOutput: SourceOutput,
    trgOutput: TargetOutput,
    success: boolean,
    gasRfdOutput?: GasRefundOutput,
    abortReason?: string
): RunRecord {
    const gasRefund = gasRfdOutput?.xrpAmount || 0;

    // For FAsset manual bridge, don't calculate bridge fees (token decimals issues)
    // Just record transaction fees
    const isFasset = ctx.cfg.bridgeName === 'fasset';

    return {
        runId: ctx.cfg.tag,
        cfg: ctx.cfg,
        timestamps: { ...ctx.ts },
        txs: { ...ctx.txs },
        costs: {
            sourceFee: srcOutput.txFee,
            targetFee: trgOutput.txFee,
            // For FAsset, set bridge fee to null due to token decimal issues
            bridgeFee: isFasset ? null : (srcOutput.xrpAmount - trgOutput.xrpAmount - gasRefund),
            // For FAsset, only sum the transaction fees
            totalBridgeCost: isFasset ? null : (srcOutput.xrpAmount + srcOutput.txFee - gasRefund - trgOutput.xrpAmount),
            // For FAsset, total cost is just the sum of tx fees
            totalCost: isFasset ? (srcOutput.txFee + trgOutput.txFee) : (srcOutput.xrpAmount + srcOutput.txFee - gasRefund)
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