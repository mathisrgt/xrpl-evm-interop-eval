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
 * Calculate bridge fee with refund mechanism
 * 
 * @param cfg - Run configuration containing gas fee allowance
 * @param actualGasFee - Actual gas fee used in XRP
 * @returns Net bridge fee after refund
 */
function calculateBridgeFee(cfg: RunConfig, actualGasFee: number): number {
    // Gas fee allowance from config (in XRP)
    const gasAllowance = Number(cfg.networks.xrpl.gas_fee) / 1000000; // Convert from drops to XRP

    // Bridge keeps the difference if actual fee is less than allowance
    // If actual fee exceeds allowance, bridge absorbs the extra cost
    return Math.max(0, gasAllowance - actualGasFee);
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
    const bridgeFee = calculateBridgeFee(ctx.cfg, trgOutput.txFee);
    const gasRefund = gasRfdOutput?.xrpAmount || 0;
    const totalCost = srcOutput.txFee + trgOutput.txFee + bridgeFee - gasRefund;
    const amountDifference = srcOutput.xrpAmount - trgOutput.xrpAmount - gasRefund;

    return {
        runId: ctx.cfg.tag,
        cfg: ctx.cfg,
        timestamps: { ...ctx.ts },
        txs: { ...ctx.txs },
        costs: {
            sourceFee: srcOutput.txFee,
            targetFee: trgOutput.txFee,
            bridgeFee,
            amountDifference,
            totalCost
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