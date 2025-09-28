import { dropsToXrp } from "xrpl";
import { RunContext, RunConfig, RunRecord, SourceOutput, TargetOutput, GasRefundOutput } from "../types";

/**
 * Create a new RunContext with initialized empty state
 */
export function createRunContext(cfg: RunConfig): RunContext {
    return {
        cfg,
        ts: {
            t0_prepare: undefined,
            t1_submit: undefined,
            t2_observe: undefined,
            t3_finalize: undefined,
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

    return {
        runId: ctx.cfg.tag,
        cfg: ctx.cfg,
        timestamps: { ...ctx.ts },
        txs: { ...ctx.txs },
        costs: {
            sourceFee: srcOutput.txFee,
            targetFee: trgOutput.txFee,
            bridgeFee: srcOutput.xrpAmount - trgOutput.xrpAmount - gasRefund,
            totalBridgeCost: srcOutput.xrpAmount + srcOutput.txFee - gasRefund - trgOutput.xrpAmount,
            totalCost: srcOutput.xrpAmount + srcOutput.txFee - gasRefund
        },
        success,
        abort_reason: abortReason,
    };
}

export function updateTimestamp(
    ctx: RunContext,
    phase: 't0_prepare' | 't1_submit' | 't2_observe' | 't3_finalize',
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