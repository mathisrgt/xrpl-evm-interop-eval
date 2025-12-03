import { dropsToXrp } from "xrpl";
import { RunContext, RunConfig, RunRecord, SourceOutput, TargetOutput, GasRefundOutput } from "../types";
import { CleanupManager } from "../utils/cleanup";

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