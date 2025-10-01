// utils/fsio.ts
//
// Unified persistence for research artifacts.
// Writes under data/results/:
//   - {batchId}.jsonl              : raw RunRecord lines (one per run)
//   - {batchId}_metrics.json       : MetricsReport (summary + raw arrays)
//   - {batchId}_metrics.csv        : single-row MetricsSummary for spreadsheets
//   - all_metrics.csv              : rolling append of all batch summaries
//
// Call saveBatchArtifacts(batchId, cfg, records, report) once per batch.

import fs from "node:fs";
import path from "node:path";
import type { RunConfig, RunRecord } from "../types";
import type { MetricsReport, MetricsSummary } from "./metrics";

/* -------------------------------------------------------------------------- */
/*                                Path helpers                                */
/* -------------------------------------------------------------------------- */

export interface SavePaths {
  dir: string;
  jsonl: string;
  metricsJson: string;
  metricsCsv: string;
  allCsv: string;
}

export function makePaths(batchId: string): SavePaths {
  const dir = path.join("data", "results");
  return {
    dir,
    jsonl: path.join(dir, `${batchId}.jsonl`),
    metricsJson: path.join(dir, `${batchId}_metrics.json`),
    metricsCsv: path.join(dir, `${batchId}_metrics.csv`),
    allCsv: path.join(dir, "all_metrics.csv"),
  };
}

/* -------------------------------------------------------------------------- */
/*                              Low-level writers                             */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/*                           Summary → CSV row mapping                        */
/* -------------------------------------------------------------------------- */

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

    batchDurationMs: s.batchDurationMs ?? "",
    tps: s.tps ?? "",

    xrplUrl: cfg.networks.xrpl.wsUrl,
    evmUrl: cfg.networks.evm.rpcUrl,
  };
}

/* Keep a fixed header order for reproducibility. */
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
  "batchDurationMs",
  "tps",
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

  // 1) Raw runs as JSONL (one per line)
  for (const r of records) appendJsonl(paths.jsonl, r);

  // 2) Summary JSON (metrics report)
  writeJsonAtomic(paths.metricsJson, report);

  // 3) Single-row CSV for the batch + 4) Append to global CSV
  const row = summaryToCsvRow(report.summary, cfg);
  writeCsv(paths.metricsCsv, [row]);
  appendCsvRow(paths.allCsv, SUMMARY_CSV_HEADERS, row);

  return paths;
}
