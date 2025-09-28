import { RunContext, RunConfig, RunRecord, SourceOutput, TargetOutput } from "../types";

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
    abortReason?: string
): RunRecord {
    console.log("srcOutput: ", srcOutput);
    console.log("trgOutput: ", trgOutput);

    // Calculate fees based on direction
    let sourceFee: number;
    let targetFee: number;
    let bridgeFee: number;

    if (ctx.cfg.direction === 'xrpl_to_evm') {
        // XRPL → EVM: source is XRPL, target is EVM
        sourceFee = srcOutput.txFee;
        targetFee = trgOutput.txFee;

        // Bridge fee calculation for XRPL→EVM
        // The gas allowance is reserved on XRPL side, actual EVM gas fee is deducted
        bridgeFee = calculateBridgeFee(ctx.cfg, trgOutput.txFee);

    } else {
        // EVM → XRPL: source is EVM, target is XRPL
        sourceFee = srcOutput.txFee;
        targetFee = trgOutput.txFee;

        // Bridge fee calculation for EVM→XRPL
        // Similar mechanism but reversed
        bridgeFee = calculateBridgeFee(ctx.cfg, trgOutput.txFee);
    }

    // Total cost includes all fees plus bridge service fee
    const totalCost = sourceFee + targetFee + bridgeFee;

    // Amount difference (slippage/loss during bridge)
    const amountDifference = srcOutput.xrpAmount - trgOutput.xrpAmount;

    return {
        runId: ctx.cfg.tag,
        cfg: ctx.cfg,
        timestamps: { ...ctx.ts },
        txs: { ...ctx.txs },
        costs: {
            sourceFee,
            targetFee,
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