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

  batchDurationMs: number | null;
  tps: number | null;
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
  const t2 = r.timestamps.t2_observe;
  if (typeof t1 !== "number" || typeof t2 !== "number") return null;
  return Math.max(0, t2 - t1);
}

export function computeMetrics(cfg: RunConfig, records: RunRecord[], batchDurationMs?: number): MetricsReport {
  const successes = records.filter(r => r.success);
  const failures = records.filter(r => !r.success);

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

  const totalRuns = records.length;
  const successCount = successes.length;
  const failureCount = totalRuns - successCount;
  const successRate = totalRuns ? successCount / totalRuns : 0;

  const tps =
    (typeof batchDurationMs === "number" && batchDurationMs > 0)
      ? successCount / (batchDurationMs / 1000)
      : null;

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
    batchDurationMs: batchDurationMs ?? null,
    tps,
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
