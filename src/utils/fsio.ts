import fs from "node:fs";
import path from "node:path";
import type { RunConfig, RunRecord, NetworkDirection, RunContext, NetworkMode } from "../types";
import type { MetricsReport, MetricsSummary } from "./metrics";

export interface SavePaths {
  dir: string;
  jsonl: string;
  metricsJson: string;
  metricsCsv: string;
  directionSummaryCsv: string;
  allCsv: string;
}

export function makePaths(batchId: string, direction: NetworkDirection, mode: NetworkMode): SavePaths {
  // Create folder structure: data/results/{mode}/{direction}/{batchId}
  const modeFolder = path.join("data", "results", mode);
  const directionFolder = path.join(modeFolder, direction);
  const dir = path.join(directionFolder, batchId);

  return {
    dir,
    jsonl: path.join(dir, `${batchId}.jsonl`),
    metricsJson: path.join(dir, `${batchId}_metrics.json`),
    metricsCsv: path.join(dir, `${batchId}_metrics.csv`),
    directionSummaryCsv: path.join(directionFolder, `${direction}_summary.csv`),
    allCsv: path.join("data", "results", "all_metrics.csv"),
  };
}

/**
 * Sanitize sensitive credentials from config before saving
 * Replaces seed/private key with public addresses
 */
function sanitizeConfig(cfg: RunConfig, xrplAddress: string, evmAddress: string): RunConfig {
  return {
    ...cfg,
    networks: {
      ...cfg.networks,
      xrpl: {
        ...cfg.networks.xrpl,
        walletSeed: `[REDACTED - Address: ${xrplAddress}]`,
      },
      evm: {
        ...cfg.networks.evm,
        walletPrivateKey: `[REDACTED - Address: ${evmAddress}]`,
      },
    },
  };
}

/**
 * Sanitize a RunRecord by replacing credentials with addresses
 */
function sanitizeRecord(record: RunRecord, xrplAddress: string, evmAddress: string): RunRecord {
  return {
    ...record,
    cfg: sanitizeConfig(record.cfg, xrplAddress, evmAddress),
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
  cfg: RunConfig,
  xrplAddress: string,
  evmAddress: string
): Record<string, string | number> {
  return {
    timestampIso: s.timestampIso,
    mode: cfg.networks.mode,
    tag: s.tag,
    bridgeName: s.bridgeName,
    currency: s.currency,
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
    cost_mean_total: s.costs?.meanTotal ?? "",
    cost_min_total: s.costs?.minTotal ?? "",
    cost_max_total: s.costs?.maxTotal ?? "",
    cost_std_total: s.costs?.stdDevTotal ?? "",
    cost_mean_bridge: s.costs?.meanBridge ?? "",
    cost_mean_source_fee: s.costs?.meanSourceFee ?? "",
    cost_mean_target_fee: s.costs?.meanTargetFee ?? "",

    batchDurationMs: s.batchDurationMs ?? "",

    xrplUrl: cfg.networks.xrpl.wsUrl,
    xrplAddress: xrplAddress,
    evmUrl: cfg.networks.evm.rpcUrl,
    evmAddress: evmAddress,
  };
}

export const SUMMARY_CSV_HEADERS: string[] = [
  "timestampIso",
  "mode",
  "tag",
  "bridgeName",
  "currency",
  "direction",
  "amountXrp",  // Note: represents amount in currency specified by 'currency' field
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
  "cost_mean_total",
  "cost_min_total",
  "cost_max_total",
  "cost_std_total",
  "cost_mean_bridge",
  "cost_mean_source_fee",
  "cost_mean_target_fee",

  "batchDurationMs",

  "xrplUrl",
  "xrplAddress",
  "evmUrl",
  "evmAddress",
];

/**
 * Read all batch metrics from a direction+mode folder and compute aggregate statistics
 */
export function computeDirectionSummary(direction: NetworkDirection, mode: NetworkMode): MetricsSummary | null {
  const directionFolder = path.join("data", "results", mode, direction);
  
  if (!fs.existsSync(directionFolder)) {
    return null;
  }

  const batchFolders = fs.readdirSync(directionFolder, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  if (batchFolders.length === 0) {
    return null;
  }

  const allSummaries: MetricsSummary[] = [];

  for (const batchFolder of batchFolders) {
    const metricsFile = path.join(directionFolder, batchFolder, `${batchFolder}_metrics.json`);
    
    if (fs.existsSync(metricsFile)) {
      try {
        const content = fs.readFileSync(metricsFile, 'utf-8');
        const report: MetricsReport = JSON.parse(content);
        allSummaries.push(report.summary);
      } catch (err) {
        console.warn(`Failed to read metrics from ${metricsFile}:`, err);
      }
    }
  }

  if (allSummaries.length === 0) {
    return null;
  }

  const totalRuns = allSummaries.reduce((sum, s) => sum + s.totalRuns, 0);
  const successCount = allSummaries.reduce((sum, s) => sum + s.successCount, 0);
  const failureCount = allSummaries.reduce((sum, s) => sum + s.failureCount, 0);
  const successRate = totalRuns > 0 ? successCount / totalRuns : 0;

  const allLatencies: number[] = [];
  const allCosts: number[] = [];
  const allBridgeCosts: number[] = [];
  const allSourceFees: number[] = [];
  const allTargetFees: number[] = [];

  // Read JSONL files directly from batch folders instead of trying to match by tag
  for (const batchFolder of batchFolders) {
    const jsonlFile = path.join(directionFolder, batchFolder, `${batchFolder}.jsonl`);
    if (fs.existsSync(jsonlFile)) {
      const lines = fs.readFileSync(jsonlFile, 'utf-8').split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const record: RunRecord = JSON.parse(line);
          if (record.success && record.timestamps.t1_submit && record.timestamps.t3_finalized) {
            allLatencies.push(record.timestamps.t3_finalized - record.timestamps.t1_submit);

            if (record.costs.totalCost) allCosts.push(record.costs.totalCost);
            if (record.costs.bridgeFee) allBridgeCosts.push(record.costs.bridgeFee);
            if (record.costs.sourceFee) allSourceFees.push(record.costs.sourceFee);
            if (record.costs.targetFee) allTargetFees.push(record.costs.targetFee);
          }
        } catch (err) {
          // Skip malformed lines
          console.warn(`Skipping malformed JSONL line in ${jsonlFile}`);
        }
      }
    }
  }

  allLatencies.sort((a, b) => a - b);
  
  const mean = (arr: number[]) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null;
  const stddev = (arr: number[]) => {
    if (!arr.length) return null;
    const m = mean(arr)!;
    const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
    return Math.sqrt(v);
  };
  const percentile = (sorted: number[], p: number) => {
    if (!sorted.length) return null;
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const w = idx - lo;
    return (1 - w) * sorted[lo] + w * sorted[hi];
  };

  const aggregatedSummary: MetricsSummary = {
    timestampIso: new Date().toISOString(),
    tag: `${mode}_${direction}_aggregated`,
    bridgeName: allSummaries[0]?.bridgeName || 'unknown',
    direction,
    xrpAmount: allSummaries[0]?.xrpAmount || 0,
    currency: allSummaries[0]?.currency || 'XRP',
    runsPlanned: allSummaries.reduce((sum, s) => sum + s.runsPlanned, 0),

    totalRuns,
    successCount,
    failureCount,
    successRate,

    latency: {
      n: allLatencies.length,
      minMs: allLatencies.length ? allLatencies[0] : null,
      p50Ms: percentile(allLatencies, 0.50),
      p90Ms: percentile(allLatencies, 0.90),
      p95Ms: percentile(allLatencies, 0.95),
      p99Ms: percentile(allLatencies, 0.99),
      maxMs: allLatencies.length ? allLatencies[allLatencies.length - 1] : null,
      meanMs: mean(allLatencies),
      stdDevMs: stddev(allLatencies),
    },

    costs: {
      n: allCosts.length,
      meanTotal: mean(allCosts),
      minTotal: allCosts.length ? Math.min(...allCosts) : null,
      maxTotal: allCosts.length ? Math.max(...allCosts) : null,
      stdDevTotal: stddev(allCosts),
      meanBridge: mean(allBridgeCosts),
      meanSourceFee: mean(allSourceFees),
      meanTargetFee: mean(allTargetFees),
    },

    batchDurationMs: allSummaries.reduce((sum, s) => sum + (s.batchDurationMs || 0), 0),
  };

  return aggregatedSummary;
}

/**
 * Persist everything for a batch in one call.
 * - Raw records → JSONL (sanitized)
 * - Metrics report → JSON (sanitized)
 * - Metrics summary → CSV (single row with addresses)
 * - Append to direction-specific summary CSV
 * - Append to rolling all_metrics.csv
 */
export function saveBatchArtifacts(
  batchId: string,
  cfg: RunConfig,
  ctx: RunContext,
  records: RunRecord[],
  report: MetricsReport
): SavePaths {
  const paths = makePaths(batchId, cfg.direction, cfg.networks.mode);
  const xrplAddress = ctx.cache.xrpl?.wallet.address!;
  const evmAddress = ctx.cache.evm?.account.address!;

  for (const r of records) {
    const sanitized = sanitizeRecord(r, xrplAddress, evmAddress);
    appendJsonl(paths.jsonl, sanitized);
  }

  const sanitizedReport = {
    ...report,
    cfgEcho: {
      ...report.cfgEcho,
      xrplAddress,
      evmAddress,
    }
  };
  writeJsonAtomic(paths.metricsJson, sanitizedReport);

  const row = summaryToCsvRow(report.summary, cfg, xrplAddress, evmAddress);
  writeCsv(paths.metricsCsv, [row]);
  
  appendCsvRow(paths.directionSummaryCsv, SUMMARY_CSV_HEADERS, row);
  
  appendCsvRow(paths.allCsv, SUMMARY_CSV_HEADERS, row);

  const directionSummary = computeDirectionSummary(cfg.direction, cfg.networks.mode);
  if (directionSummary) {
    const directionSummaryFile = path.join("data", "results", cfg.networks.mode, cfg.direction, `${cfg.direction}_aggregated_metrics.json`);
    writeJsonAtomic(directionSummaryFile, {
      summary: directionSummary,
      batchCount: fs.readdirSync(path.join("data", "results", cfg.networks.mode, cfg.direction), { withFileTypes: true })
        .filter(d => d.isDirectory()).length,
      lastUpdated: new Date().toISOString(),
    });
  }

  return paths;
}