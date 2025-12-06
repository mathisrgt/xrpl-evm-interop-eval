import type { RunConfig, RunRecord } from "../types";

export interface LatencyStats {
  n: number;
  minMs: number | null;
  p50Ms: number | null;
  p90Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  meanMs: number | null;
  stdDevMs: number | null;
}

export interface CostsStats {
  n: number;
  // All cost stats are now in USD for unified metrics
  meanBridgeUsd: number | null;
  meanSourceFeeUsd: number | null;
  meanTargetFeeUsd: number | null;
}

export interface MetricsSummary {
  timestampIso: string;
  tag: string;
  bridgeName: string;

  direction: string;
  transferAmount: number; // Amount transferred per transaction (native currency)
  transferAmountUsd: number; // Amount transferred in USD (for comparison)
  runsPlanned: number;

  totalRuns: number;
  successCount: number;
  failureCount: number;
  successRate: number;

  latency: LatencyStats;
  costs: CostsStats; // All costs in USD

  batchDurationMs: number;
}

export interface MetricsReport {
  summary: MetricsSummary;
  latenciesMs: number[];
  failureReasons: Record<string, number>;
  cfgEcho: {
    tag: string;
    direction: string;
    xrpAmount: number;
    runs: number;
    xrplUrl: string;
    evmUrl: string;
    xrplAddress?: string;
    evmAddress?: string;
  };
}

function byNumberAsc(a: number, b: number) { return a - b; }
function mean(arr: number[]): number | null {
  return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null;
}
function stddev(arr: number[]): number | null {
  if (!arr.length) return null;
  const m = mean(arr)!;
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}
function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return NaN;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const w = idx - lo;
  return (1 - w) * sortedAsc[lo] + w * sortedAsc[hi];
}

// End-to-end latency: start of submit -> start of observe (both START stamps)
function e2eLatencyMs(r: RunRecord): number | null {
  const t1 = r.timestamps.t1_submit;
  const t3 = r.timestamps.t3_finalized;
  if (typeof t1 !== "number" || typeof t3 !== "number") return null;
  return Math.max(0, t3 - t1);
}


export function computeMetrics(cfg: RunConfig, records: RunRecord[], batchDurationMs: number): MetricsReport {
  const successes = records.filter(r => r.success);
  const failures = records.filter(r => !r.success);

  // Latencies on successful runs
  const latencies = successes
    .map(e2eLatencyMs)
    .filter((x): x is number => typeof x === "number");

  const failureReasons = failures.reduce<Record<string, number>>((acc, r) => {
    const k = r.abort_reason ?? "unknown";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const latSorted = [...latencies].sort(byNumberAsc);
  const latencyStats: LatencyStats = {
    n: latencies.length,
    minMs: latencies.length ? latSorted[0] : null,
    p50Ms: latencies.length ? percentile(latSorted, 0.50) : null,
    p90Ms: latencies.length ? percentile(latSorted, 0.90) : null,
    p95Ms: latencies.length ? percentile(latSorted, 0.95) : null,
    maxMs: latencies.length ? latSorted[latSorted.length - 1] : null,
    meanMs: mean(latencies),
    stdDevMs: stddev(latencies),
  };

  // Extract USD costs from RunCosts
  const bridgeArrUsd = successes
    .map(r => r.costs?.bridgeFeeUsd)
    .filter((x): x is number => typeof x === "number");
  const sourceArrUsd = successes
    .map(r => r.costs?.sourceFeeUsd)
    .filter((x): x is number => typeof x === "number");
  const targetArrUsd = successes
    .map(r => r.costs?.targetFeeUsd)
    .filter((x): x is number => typeof x === "number");

  const costStats: CostsStats = {
    n: bridgeArrUsd.length,
    meanBridgeUsd: mean(bridgeArrUsd),
    meanSourceFeeUsd: mean(sourceArrUsd),
    meanTargetFeeUsd: mean(targetArrUsd),
  };

  const totalRuns = records.length;
  const successCount = successes.length;
  const failureCount = totalRuns - successCount;
  const successRate = totalRuns ? successCount / totalRuns : 0;

  // Note: transferAmountUsd will be computed later when we have price data
  // For now, we'll just use the xrpAmount and set transferAmountUsd to 0
  // This will be properly set when metrics are saved/displayed
  const summary: MetricsSummary = {
    timestampIso: new Date().toISOString(),
    tag: cfg.tag,
    bridgeName: cfg.bridgeName,
    direction: cfg.direction,
    transferAmount: cfg.xrpAmount, // Native currency amount
    transferAmountUsd: 0, // Will be computed when displaying metrics
    runsPlanned: cfg.runs,
    totalRuns,
    successCount,
    failureCount,
    successRate,
    latency: latencyStats,
    costs: costStats,
    batchDurationMs,
  };

  return {
    summary,
    latenciesMs: latencies,
    failureReasons,
    cfgEcho: {
      tag: cfg.tag,
      direction: cfg.direction,
      xrpAmount: cfg.xrpAmount,
      runs: cfg.runs,
      xrplUrl: cfg.networks.xrpl.wsUrl,
      evmUrl: cfg.networks.evm.rpcUrl,
    },
  };
}