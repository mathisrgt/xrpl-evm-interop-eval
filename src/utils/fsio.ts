import fs from "node:fs";
import path from "node:path";
import type { RunConfig, RunRecord } from "../types";
import type { MetricsReport, MetricsSummary } from "./metrics";

export interface SavePaths {
  dir: string;
  jsonl: string;
  metricsJson: string;
  metricsCsv: string;
  allCsv: string;
}

export function makePaths(batchId: string): SavePaths {
  const dir = path.join("data", "results", batchId);

  return {
    dir,
    jsonl: path.join(dir, `${batchId}.jsonl`),
    metricsJson: path.join(dir, `${batchId}_metrics.json`),
    metricsCsv: path.join(dir, `${batchId}_metrics.csv`),
    allCsv: path.join("data", "results", "all_metrics.csv"),
  };
}

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

/** Append one object as JSONL (one line per record). */
export function appendJsonl(file: string, obj: unknown) {
  ensureDir(file);
  fs.appendFileSync(file, JSON.stringify(obj) + "\n");
}

/** Write pretty JSON atomically (tmp + rename). */
export function writeJsonAtomic(file: string, obj: unknown) {
  ensureDir(file);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

/** RFC4180-safe CSV escaping. */
function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  // quote if contains comma, quote, newline/CR, or leading/trailing spaces
  const needsQuote = /[",\n\r]/.test(s) || /^\s|\s$/.test(s);
  const q = s.replace(/"/g, '""');
  return needsQuote ? `"${q}"` : q;
}

/** Write an array of homogeneous objects to CSV (overwrite). */
export function writeCsv(file: string, rows: Array<Record<string, unknown>>) {
  ensureDir(file);
  if (!rows.length) {
    fs.writeFileSync(file, "");
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines: string[] = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  fs.writeFileSync(file, lines.join("\n"));
}

/** Append a single CSV row; create file with header if missing. */
export function appendCsvRow(
  file: string,
  headers: string[],
  row: Record<string, unknown>
) {
  ensureDir(file);
  const exists = fs.existsSync(file);
  const line = headers.map((h) => csvEscape(row[h])).join(",") + "\n";
  if (!exists) {
    fs.writeFileSync(file, headers.join(",") + "\n" + line);
  } else {
    fs.appendFileSync(file, line);
  }
}

/** Stable, explicit schema for one-row batch CSV. */
export function summaryToCsvRow(
  s: MetricsSummary,
  cfg: RunConfig
): Record<string, string | number> {
  return {
    timestampIso: s.timestampIso,
    tag: s.tag,
    direction: s.direction,
    amountXrp: s.xrpAmount,
    runsPlanned: s.runsPlanned,

    totalRuns: s.totalRuns,
    successCount: s.successCount,
    failureCount: s.failureCount,
    successRate_pct: Number((s.successRate * 100).toFixed(2)),

    latency_min_ms: s.latency.minMs ?? "",
    latency_p50_ms: s.latency.p50Ms ?? "",
    latency_p90_ms: s.latency.p90Ms ?? "",
    latency_p95_ms: s.latency.p95Ms ?? "",
    latency_p99_ms: s.latency.p99Ms ?? "",
    latency_max_ms: s.latency.maxMs ?? "",
    latency_mean_ms: s.latency.meanMs ?? "",
    latency_std_ms: s.latency.stdDevMs ?? "",

    cost_n: s.costs?.n ?? "",
    cost_mean_total_xrp: s.costs?.meanTotalXrp ?? "",
    cost_min_total_xrp: s.costs?.minTotalXrp ?? "",
    cost_max_total_xrp: s.costs?.maxTotalXrp ?? "",
    cost_std_total_xrp: s.costs?.stdDevTotalXrp ?? "",
    cost_mean_bridge_xrp: s.costs?.meanBridgeXrp ?? "",
    cost_mean_source_fee_xrp: s.costs?.meanSourceFeeXrp ?? "",
    cost_mean_target_fee_xrp: s.costs?.meanTargetFeeXrp ?? "",

    batchDurationMs: s.batchDurationMs ?? "",

    xrplUrl: cfg.networks.xrpl.wsUrl,
    evmUrl: cfg.networks.evm.rpcUrl,
  };
}


export const SUMMARY_CSV_HEADERS: string[] = [
  "timestampIso",
  "tag",
  "direction",
  "amountXrp",
  "runsPlanned",

  "totalRuns",
  "successCount",
  "failureCount",
  "successRate_pct",

  "latency_min_ms",
  "latency_p50_ms",
  "latency_p90_ms",
  "latency_p95_ms",
  "latency_p99_ms",
  "latency_max_ms",
  "latency_mean_ms",
  "latency_std_ms",

  "cost_n",
  "cost_mean_total_xrp",
  "cost_min_total_xrp",
  "cost_max_total_xrp",
  "cost_std_total_xrp",
  "cost_mean_bridge_xrp",
  "cost_mean_source_fee_xrp",
  "cost_mean_target_fee_xrp",

  "batchDurationMs",

  "xrplUrl",
  "evmUrl",
];

/**
 * Persist everything for a batch in one call.
 * - Raw records → JSONL
 * - Metrics report → JSON
 * - Metrics summary → CSV (single row)
 * - Append to rolling all_metrics.csv
 */
export function saveBatchArtifacts(
  batchId: string,
  cfg: RunConfig,
  records: RunRecord[],
  report: MetricsReport
): SavePaths {
  const paths = makePaths(batchId);

  for (const r of records) appendJsonl(paths.jsonl, r);

  writeJsonAtomic(paths.metricsJson, report);

  const row = summaryToCsvRow(report.summary, cfg);
  writeCsv(paths.metricsCsv, [row]);
  appendCsvRow(paths.allCsv, SUMMARY_CSV_HEADERS, row);

  return paths;
}
