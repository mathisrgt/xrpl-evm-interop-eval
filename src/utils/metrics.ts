// metrics.ts

/** 
 * Minimal row used for summaries.
 * Build this from each RunRecord after an experiment.
 */
export interface BriefRow {
  /** True if the run reached finality successfully */
  success: boolean;
  /** End-to-end latency in milliseconds (t4 - t1), null if not available */
  latencyMs: number | null;
  /** Total fee in USD for this run, null if not computed */
  totalUsd: number | null;
}

/** 
 * Compact summary of an experiment batch.
 * This is the structure you would include in CSV/plots/tables. 
 */
export interface Summary {
  /** Total number of runs */
  n: number;
  /** Fraction of successful runs [0..1] */
  successRate: number;
  /** Median latency (p50) in ms, null if no successful runs */
  p50LatencyMs: number | null;
  /** 90th percentile latency (p90) in ms, null if no successful runs */
  p90LatencyMs: number | null;
  /** Average cost across runs with valid totalUsd, null if none */
  avgCostUsd: number | null;
}

/**
 * Compute a percentile value from a sorted numeric array.
 *
 * Uses linear interpolation between closest ranks.
 *
 * @param sortedAsc - Array of numbers in ascending order.
 * @param p - Percentile in [0,1], e.g. 0.5 for median, 0.9 for p90.
 * @returns The interpolated percentile value, or NaN if array empty.
 */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  if (p <= 0) return sortedAsc[0];
  if (p >= 1) return sortedAsc[sortedAsc.length - 1];
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const w = idx - lo;
  return (1 - w) * sortedAsc[lo] + w * sortedAsc[hi];
}

/**
 * Compute a compact summary for an experiment.
 *
 * - Success rate = fraction of runs where success=true.
 * - Latency percentiles (p50, p90) = computed only on successful runs
 *   that have a numeric latency.
 * - Average cost = mean totalUsd across runs with numeric values.
 *
 * @param rows - Array of per-run brief rows.
 * @returns A Summary object with success rate, latency stats, and average cost.
 */
export function toSummary(rows: BriefRow[]): Summary {
  const n = rows.length;
  const nSucc = rows.filter(r => r.success).length;
  const successRate = n === 0 ? 0 : nSucc / n;

  // Latencies: successful runs with valid numbers
  const latencies = rows
    .filter(r => r.success && typeof r.latencyMs === "number" && Number.isFinite(r.latencyMs))
    .map(r => r.latencyMs as number)
    .sort((a, b) => a - b);

  const p50LatencyMs = latencies.length ? percentile(latencies, 0.5) : null;
  const p90LatencyMs = latencies.length ? percentile(latencies, 0.9) : null;

  // Costs: all runs with valid totalUsd
  const costs = rows
    .map(r => r.totalUsd)
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const avgCostUsd = costs.length
    ? costs.reduce((a, b) => a + b, 0) / costs.length
    : null;

  return {
    n,
    successRate,
    p50LatencyMs,
    p90LatencyMs,
    avgCostUsd,
  };
}

/**
 * Convert full RunRecord-like objects into BriefRows.
 *
 * @typeParam T - A type that has at least success, timestamps, and costs fields.
 * @param runs - Array of RunRecord-like objects.
 * @returns Array of BriefRow, with only success, latencyMs, and totalUsd extracted.
 *
 * @example
 * const brief = runsToBrief(runRecords);
 * const summary = toSummary(brief);
 */
export function runsToBrief<T extends {
  success: boolean;
  timestamps: { t1_submit_source?: number; t4_finality_target?: number | null };
  costs: { totalUsd?: number | null };
}>(runs: T[]): BriefRow[] {
  return runs.map(r => {
    const t1 = r.timestamps.t1_submit_source;
    const t4 = r.timestamps.t4_finality_target ?? null;
    const latencyMs =
      (typeof t1 === "number" && typeof t4 === "number") ? (t4 - t1) : null;
    return {
      success: r.success,
      latencyMs,
      totalUsd: (typeof r.costs.totalUsd === "number") ? r.costs.totalUsd : null,
    };
  });
}
