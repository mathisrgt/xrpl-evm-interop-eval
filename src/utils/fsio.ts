import fs from "node:fs";
import path from "node:path";
import type { RunConfig, RunRecord, NetworkDirection, RunContext } from "../types";
import type { MetricsReport, MetricsSummary } from "./metrics";

export interface SavePaths {
  dir: string;
  jsonl: string;
  metricsJson: string;
  metricsCsv: string;
  directionSummaryCsv: string;
  allCsv: string;
}

export function makePaths(batchId: string, direction: NetworkDirection, bridgeName: string): SavePaths {
  // Create folder structure: data/results/{bridgeName}_{direction}/{batchId}
  const modeFolder = path.join("data", "results");
  const directionFolder = path.join(modeFolder, `${bridgeName}_${direction}`);
  const dir = path.join(directionFolder, batchId);

  return {
    dir,
    jsonl: path.join(dir, `${batchId}.jsonl`),
    metricsJson: path.join(dir, `${batchId}_metrics.json`),
    metricsCsv: path.join(dir, `${batchId}_metrics.csv`),
    directionSummaryCsv: path.join(directionFolder, `${bridgeName}_${direction}_summary.csv`),
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

/**
 * JSON replacer function that prevents scientific notation
 * Converts numbers to fixed decimal notation (e.g., 1e-7 -> 0.0000001)
 */
function jsonReplacer(_key: string, value: any): any {
  if (typeof value === 'number') {
    // Check if the number would be serialized in scientific notation
    const str = value.toString();
    if (str.includes('e') || str.includes('E')) {
      // Use toFixed with enough decimal places to represent the number
      // Find the exponent to determine decimal places needed
      const match = str.match(/e([+-]?\d+)/i);
      if (match) {
        const exponent = parseInt(match[1], 10);
        const decimalPlaces = exponent < 0 ? Math.abs(exponent) + 10 : 10;
        return parseFloat(value.toFixed(decimalPlaces));
      }
    }
  }
  return value;
}

/** Append one object as JSONL (one line per record). */
export function appendJsonl(file: string, obj: unknown) {
  ensureDir(file);
  fs.appendFileSync(file, JSON.stringify(obj, jsonReplacer) + "\n");
}

/** Write pretty JSON atomically (tmp + rename). */
export function writeJsonAtomic(file: string, obj: unknown) {
  ensureDir(file);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, jsonReplacer, 2));
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
    tag: s.tag,
    bridgeName: s.bridgeName,
    direction: s.direction,
    transferAmount: s.transferAmount,
    transferAmountUsd: s.transferAmountUsd,
    runsPlanned: s.runsPlanned,

    totalRuns: s.totalRuns,
    successCount: s.successCount,
    failureCount: s.failureCount,
    successRate_pct: Number((s.successRate * 100).toFixed(2)),

    latency_min_ms: s.latency.minMs ?? "",
    latency_p50_ms: s.latency.p50Ms ?? "",
    latency_p90_ms: s.latency.p90Ms ?? "",
    latency_p95_ms: s.latency.p95Ms ?? "",
    latency_max_ms: s.latency.maxMs ?? "",
    latency_mean_ms: s.latency.meanMs ?? "",
    latency_std_ms: s.latency.stdDevMs ?? "",

    cost_n: s.costs?.n ?? "",
    cost_mean_bridge_usd: s.costs?.meanBridgeUsd ?? "",
    cost_mean_source_fee_usd: s.costs?.meanSourceFeeUsd ?? "",
    cost_mean_target_fee_usd: s.costs?.meanTargetFeeUsd ?? "",

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
  "direction",
  "transferAmount",  // Amount in native currency
  "transferAmountUsd",  // Amount in USD
  "runsPlanned",

  "totalRuns",
  "successCount",
  "failureCount",
  "successRate_pct",

  "latency_min_ms",
  "latency_p50_ms",
  "latency_p90_ms",
  "latency_p95_ms",
  "latency_max_ms",
  "latency_mean_ms",
  "latency_std_ms",

  "cost_n",
  "cost_mean_bridge_usd",
  "cost_mean_source_fee_usd",
  "cost_mean_target_fee_usd",

  "batchDurationMs",

  "xrplUrl",
  "xrplAddress",
  "evmUrl",
  "evmAddress",
];

/**
 * Read all batch metrics from a direction+mode folder and compute aggregate statistics
 */
export function computeDirectionSummary(direction: NetworkDirection, bridgeName: string): MetricsSummary | null {
  const directionFolder = path.join("data", "results", `${bridgeName}_${direction}`);
  
  if (!fs.existsSync(directionFolder)) {
    return null;
  }

  const batchFolders = fs.readdirSync(directionFolder, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && !dirent.name.includes('deprecated'))
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

            if (record.costs.bridgeFeeUsd) allBridgeCosts.push(record.costs.bridgeFeeUsd);
            if (record.costs.sourceFeeUsd) allSourceFees.push(record.costs.sourceFeeUsd);
            if (record.costs.targetFeeUsd) allTargetFees.push(record.costs.targetFeeUsd);
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
    tag: `${bridgeName}_${direction}_aggregated`,
    bridgeName,
    direction,
    transferAmount: allSummaries[0]?.transferAmount || 0,
    transferAmountUsd: allSummaries[0]?.transferAmountUsd || 0,
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
      maxMs: allLatencies.length ? allLatencies[allLatencies.length - 1] : null,
      meanMs: mean(allLatencies),
      stdDevMs: stddev(allLatencies),
    },

    costs: {
      n: allBridgeCosts.length,
      meanBridgeUsd: mean(allBridgeCosts),
      meanSourceFeeUsd: mean(allSourceFees),
      meanTargetFeeUsd: mean(allTargetFees),
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
  const paths = makePaths(batchId, cfg.direction, cfg.bridgeName);
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

  const directionSummary = computeDirectionSummary(cfg.direction, cfg.bridgeName);
  if (directionSummary) {
    const directionFolder = path.join("data", "results", `${cfg.bridgeName}_${cfg.direction}`);
    const directionSummaryFile = path.join(directionFolder, `${cfg.bridgeName}_${cfg.direction}_aggregated_metrics.json`);
    writeJsonAtomic(directionSummaryFile, {
      summary: directionSummary,
      batchCount: fs.readdirSync(directionFolder, { withFileTypes: true })
        .filter(d => d.isDirectory()).length,
      lastUpdated: new Date().toISOString(),
    });
  }

  return paths;
}

/**
 * Get all non-deprecated direction folders in a mode folder
 */
export function getDirectionFolders(): Array<{ folder: string; bridgeName: string; direction: NetworkDirection }> {
  const modeFolder = path.join("data", "results");

  if (!fs.existsSync(modeFolder)) {
    return [];
  }

  const folders = fs.readdirSync(modeFolder, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && !dirent.name.includes('deprecated'))
    .map(dirent => dirent.name);

  const result: Array<{ folder: string; bridgeName: string; direction: NetworkDirection }> = [];

  for (const folder of folders) {
    // Parse folder name format: {bridgeName}_{direction}
    const parts = folder.split('_');
    if (parts.length >= 2) {
      const bridgeName = parts[0];
      const direction = parts.slice(1).join('_') as NetworkDirection;
      result.push({ folder, bridgeName, direction });
    }
  }

  return result;
}

/**
 * Recompute aggregated metrics for a specific direction folder
 */
export function recomputeDirectionMetrics(bridgeName: string, direction: NetworkDirection): MetricsSummary | null {
  const directionSummary = computeDirectionSummary(direction, bridgeName);

  if (!directionSummary) {
    return null;
  }

  const directionFolder = path.join("data", "results", `${bridgeName}_${direction}`);
  const directionSummaryFile = path.join(directionFolder, `${bridgeName}_${direction}_aggregated_metrics.json`);
  const directionSummaryCsv = path.join(directionFolder, `${bridgeName}_${direction}_summary.csv`);

  // Write JSON aggregated metrics
  writeJsonAtomic(directionSummaryFile, {
    summary: directionSummary,
    batchCount: fs.readdirSync(directionFolder, { withFileTypes: true })
      .filter(d => d.isDirectory()).length,
    lastUpdated: new Date().toISOString(),
  });

  // Rebuild the direction summary CSV from all batch metrics
  const batchFolders = fs.readdirSync(directionFolder, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && !dirent.name.includes('deprecated'))
    .map(dirent => dirent.name);

  const csvRows: Array<Record<string, string | number>> = [];

  for (const batchFolder of batchFolders) {
    const metricsFile = path.join(directionFolder, batchFolder, `${batchFolder}_metrics.json`);

    if (fs.existsSync(metricsFile)) {
      try {
        const content = fs.readFileSync(metricsFile, 'utf-8');
        const report: MetricsReport = JSON.parse(content);

        // Extract addresses from cfgEcho
        const xrplAddress = report.cfgEcho?.xrplAddress || '';
        const evmAddress = report.cfgEcho?.evmAddress || '';

        // Create a temporary RunConfig
        const cfg: RunConfig = {
          tag: report.summary.tag,
          networks: {
            xrpl: {
              wsUrl: report.cfgEcho?.xrplUrl || '',
              gateway: report.cfgEcho?.xrplUrl || '',
              walletSeed: '',
              gas_fee: '',
            },
            evm: {
              rpcUrl: report.cfgEcho?.evmUrl || '',
              gateway: report.cfgEcho?.evmUrl || '',
              walletPrivateKey: '',
              relayer: '',
            }
          },
          direction: report.summary.direction as NetworkDirection,
          xrpAmount: report.summary.transferAmount,
          runs: report.summary.runsPlanned,
          bridgeName: report.summary.bridgeName,
        };

        const row = summaryToCsvRow(report.summary, cfg, xrplAddress, evmAddress);
        csvRows.push(row);
      } catch (err) {
        console.warn(`Failed to read metrics from ${metricsFile}:`, err);
      }
    }
  }

  // Sort by timestamp (newest first) and write CSV
  csvRows.sort((a, b) => {
    const timeA = new Date(a.timestampIso as string).getTime();
    const timeB = new Date(b.timestampIso as string).getTime();
    return timeB - timeA;
  });

  writeCsv(directionSummaryCsv, csvRows);

  return directionSummary;
}

/**
 * Recompute all_metrics.csv from all batch metrics across all modes and directions
 */
export function recomputeAllMetricsCsv(): { count: number; stats: { modes: number; directions: number; batches: number } } {
  const allCsvPath = path.join("data", "results", "all_metrics.csv");
  const allRows: Array<Record<string, string | number>> = [];

  const resultsFolder = path.join("data", "results");
  if (!fs.existsSync(resultsFolder)) {
    return { count: 0, stats: { modes: 0, directions: 0, batches: 0 } };
  }

  let totalModes = 0;
  let totalDirections = 0;
  let totalBatches = 0;

  // Iterate through all modes (mainnet, testnet, etc.) - exclude deprecated folder
  const modes = fs.readdirSync(resultsFolder, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && !dirent.name.includes('deprecated'))
    .map(dirent => dirent.name);

  totalModes = modes.length;

  for (const mode of modes) {
    const modeFolder = path.join(resultsFolder, mode);

    // Get all direction folders (excluding deprecated)
    const directionFolders = fs.readdirSync(modeFolder, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory() && !dirent.name.includes('deprecated'))
      .map(dirent => dirent.name);

    totalDirections += directionFolders.length;

    for (const directionFolder of directionFolders) {
      const directionPath = path.join(modeFolder, directionFolder);

      // Get all batch folders
      const batchFolders = fs.readdirSync(directionPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      totalBatches += batchFolders.length;

      for (const batchFolder of batchFolders) {
        const metricsFile = path.join(directionPath, batchFolder, `${batchFolder}_metrics.json`);

        if (fs.existsSync(metricsFile)) {
          try {
            const content = fs.readFileSync(metricsFile, 'utf-8');
            const report: MetricsReport = JSON.parse(content);

            // Extract addresses from cfgEcho
            const xrplAddress = report.cfgEcho?.xrplAddress || '';
            const evmAddress = report.cfgEcho?.evmAddress || '';

            // Create a temporary RunConfig from cfgEcho for summaryToCsvRow
            const cfg: RunConfig = {
              tag: report.summary.tag,
              networks: {
                xrpl: {
                  wsUrl: report.cfgEcho?.xrplUrl || '',
                  gateway: report.cfgEcho?.xrplUrl || '',
                  walletSeed: '',
                  gas_fee: '',
                },
                evm: {
                  rpcUrl: report.cfgEcho?.evmUrl || '',
                  gateway: report.cfgEcho?.evmUrl || '',
                  walletPrivateKey: '',
                  relayer: '',
                }
              },
              direction: report.summary.direction as NetworkDirection,
              xrpAmount: report.summary.transferAmount,
              runs: report.summary.runsPlanned,
              bridgeName: report.summary.bridgeName,
            };

            const row = summaryToCsvRow(report.summary, cfg, xrplAddress, evmAddress);
            allRows.push(row);
          } catch (err) {
            console.warn(`Failed to read metrics from ${metricsFile}:`, err);
          }
        }
      }
    }
  }

  // Sort rows by timestamp (newest first)
  allRows.sort((a, b) => {
    const timeA = new Date(a.timestampIso as string).getTime();
    const timeB = new Date(b.timestampIso as string).getTime();
    return timeB - timeA;
  });

  // Write the CSV
  writeCsv(allCsvPath, allRows);

  return {
    count: allRows.length,
    stats: {
      modes: totalModes,
      directions: totalDirections,
      batches: totalBatches
    }
  };
}