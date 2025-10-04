import type { RunConfig, RunRecord } from "../types";

export interface LatencyStats {
  n: number;
  minMs: number | null;
  p50Ms: number | null;
  p90Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  meanMs: number | null;
  stdDevMs: number | null;
}

export interface CostsStats {
  n: number;
  meanTotalXrp: number | null;
  minTotalXrp: number | null;
  maxTotalXrp: number | null;
  stdDevTotalXrp: number | null;

  meanBridgeXrp: number | null;
  meanSourceFeeXrp: number | null;
  meanTargetFeeXrp: number | null;
}

export interface MetricsSummary {
  timestampIso: string;
  tag: string;

  direction: string;
  xrpAmount: number;
  runsPlanned: number;

  totalRuns: number;
  successCount: number;
  failureCount: number;
  successRate: number;

  latency: LatencyStats;
  costs: CostsStats;

  batchDurationMs: number;
}

export interface MetricsReport {
  summary: MetricsSummary;
  latenciesMs: number[];
  failureReasons: Record<string, number>;
  cfgEcho: {
    tag: string;
    mode: string;
    direction: string;
    xrpAmount: number;
    runs: number;
    xrplUrl: string;
    evmUrl: string;
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

/** Best-effort total cost in XRP - using correct property names */
function totalCostXrp(r: RunRecord): number | null {
  const c = r.costs;
  if (!c) return null;
  
  // Use the actual property names from RunCosts
  if (typeof c.totalCost === "number") return c.totalCost;

  const parts = [c.bridgeFee, c.sourceFee, c.targetFee]
    .filter((x): x is number => typeof x === "number");

  return parts.length ? parts.reduce((s: number, x: number) => s + x, 0) : null;
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
    p99Ms: latencies.length ? percentile(latSorted, 0.99) : null,
    maxMs: latencies.length ? latSorted[latSorted.length - 1] : null,
    meanMs: mean(latencies),
    stdDevMs: stddev(latencies),
  };

  // Extract costs using correct property names
  const totals = successes
    .map(totalCostXrp)
    .filter((x): x is number => typeof x === "number");
  const totalsSorted = [...totals].sort(byNumberAsc);

  // Use actual property names from RunCosts interface
  const bridgeArr = successes
    .map(r => r.costs?.bridgeFee)
    .filter((x): x is number => typeof x === "number");
  const sourceArr = successes
    .map(r => r.costs?.sourceFee)
    .filter((x): x is number => typeof x === "number");
  const targetArr = successes
    .map(r => r.costs?.targetFee)
    .filter((x): x is number => typeof x === "number");

  const costStats: CostsStats = {
    n: totals.length,
    meanTotalXrp: mean(totals),
    minTotalXrp: totals.length ? totalsSorted[0] : null,
    maxTotalXrp: totals.length ? totalsSorted[totalsSorted.length - 1] : null,
    stdDevTotalXrp: stddev(totals),

    meanBridgeXrp: mean(bridgeArr),
    meanSourceFeeXrp: mean(sourceArr),
    meanTargetFeeXrp: mean(targetArr),
  };

  const totalRuns = records.length;
  const successCount = successes.length;
  const failureCount = totalRuns - successCount;
  const successRate = totalRuns ? successCount / totalRuns : 0;

  const summary: MetricsSummary = {
    timestampIso: new Date().toISOString(),
    tag: cfg.tag,
    direction: cfg.direction,
    xrpAmount: cfg.xrpAmount,
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
      mode: cfg.networks.mode,
      direction: cfg.direction,
      xrpAmount: cfg.xrpAmount,
      runs: cfg.runs,
      xrplUrl: cfg.networks.xrpl.wsUrl,
      evmUrl: cfg.networks.evm.rpcUrl,
    },
  };
}