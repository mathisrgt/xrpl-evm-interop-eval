import fs from "node:fs";
import path from "node:path";
import { RunRecord } from "../types";

/**
 * Append a single JSON object to a JSON Lines (JSONL) file.
 */
export function appendJsonl(file: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + "\n", "utf8");
}

/**
 * Write pretty-printed JSON to a file using an atomic replace.
 */
export function writeJson(file: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

/**
 * Read and parse a JSON file with a typed return.
 */
export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Write an array of homogeneous objects to a CSV file (header included).
 */
export function writeCsv(file: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape((r as any)[h])).join(",")),
  ];

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
}

/**
 * Sanitize RunRecord by removing sensitive data (wallet seeds, private keys)
 */
function sanitizeRecord(record: RunRecord): RunRecord {
  return {
    ...record,
    cfg: {
      ...record.cfg,
      networks: {
        ...record.cfg.networks,
        xrpl: {
          ...record.cfg.networks.xrpl,
          walletSeed: "[REDACTED]" // Remove sensitive wallet seed
        },
        evm: {
          ...record.cfg.networks.evm,
          walletPrivateKey: "[REDACTED]" // Remove sensitive private key
        }
      }
    }
  };
}

/**
 * Convert RunRecord to a flat CSV row for scientific analysis
 */
export function recordToCsvRow(record: RunRecord): Record<string, unknown> {
  return {
    // Identification
    runId: record.runId,
    success: record.success,
    abort_reason: record.abort_reason || '',
    
    // Configuration (excluding sensitive data)
    network_mode: record.cfg.networks.mode,
    direction: record.cfg.direction,
    amount_xrp: record.cfg.xrpAmount,
    total_runs: record.cfg.runs,
    
    // Network endpoints (safe to include)
    xrpl_endpoint: record.cfg.networks.xrpl.wsUrl,
    evm_endpoint: record.cfg.networks.evm.rpcUrl,
    xrpl_gateway: record.cfg.networks.xrpl.gateway,
    evm_gateway: record.cfg.networks.evm.gateway,
    evm_relayer: record.cfg.networks.evm.relayer,
    
    // Timestamps (milliseconds since epoch)
    t0_prepare: record.timestamps.t0_prepare || null,
    t1_submit: record.timestamps.t1_submit || null,
    t2_observe: record.timestamps.t2_observe || null,
    t3_finalize: record.timestamps.t3_finalize || null,
    
    // Calculated metrics
    preparation_time_ms: record.timestamps.t1_submit && record.timestamps.t0_prepare ? 
      record.timestamps.t1_submit - record.timestamps.t0_prepare : null,
    total_latency_ms: record.timestamps.t3_finalize && record.timestamps.t1_submit ? 
      record.timestamps.t3_finalize - record.timestamps.t1_submit : null,
    
    // Transaction hashes
    source_tx_hash: record.txs.sourceTxHash || '',
    target_tx_hash: record.txs.targetTxHash || '',
    bridge_message_id: record.txs.bridgeMessageId || '',
    
    // Costs
    source_fee: record.costs.sourceFee,
    target_fee: record.costs.targetFee,
    bridge_fee: record.costs.bridgeFee,
    total_bridge_cost: record.costs.totalBridgeCost,
    total_cost: record.costs.totalCost,
  };
}

/**
 * Generate file paths for batch records
 */
function getBatchFilePaths(record: RunRecord, basePath: string = 'data/results'): { jsonlFile: string; csvFile: string; batchId: string } {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T');
  const date = timestamp[0]; // YYYY-MM-DD
  const time = timestamp[1].substring(0, 8); // HH-MM-SS
  const mode = record.cfg.networks.mode;
  const direction = record.cfg.direction;
  
  const batchId = `${mode}_${direction}_${date}_${time}`;
  const jsonlFile = path.join(basePath, `${batchId}.jsonl`);
  const csvFile = path.join(basePath, `${batchId}.csv`);
  
  return { jsonlFile, csvFile, batchId };
}

/**
 * Save a single record (backward compatibility - appends to daily file)
 */
export function saveRecord(record: RunRecord, basePath: string = 'data/results'): void {
  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const mode = record.cfg.networks.mode;
  const direction = record.cfg.direction;
  
  const jsonlFile = path.join(basePath, `${mode}_${direction}_${timestamp}.jsonl`);
  const csvFile = path.join(basePath, `${mode}_${direction}_${timestamp}.csv`);
  
  // Sanitize record before saving
  const sanitizedRecord = sanitizeRecord(record);
  
  // Save sanitized record to JSONL
  appendJsonl(jsonlFile, sanitizedRecord);
  
  // Convert to CSV format and append
  const csvRow = recordToCsvRow(record);
  appendCsvRow(csvFile, csvRow);
}

/**
 * Save a batch of records to a single timestamped file
 * Returns the batch ID for reference
 */
export function saveBatchRecords(records: RunRecord[], basePath: string = 'data/results'): string {
  if (records.length === 0) {
    throw new Error("Cannot save empty batch");
  }
  
  // Use first record to determine file paths (all records in batch share same config)
  const { jsonlFile, csvFile, batchId } = getBatchFilePaths(records[0], basePath);
  
  // Ensure directory exists
  fs.mkdirSync(path.dirname(jsonlFile), { recursive: true });
  
  // Save all records to JSONL (one per line)
  const jsonlContent = records
    .map(record => JSON.stringify(sanitizeRecord(record)))
    .join('\n') + '\n';
  fs.writeFileSync(jsonlFile, jsonlContent, 'utf8');
  
  // Save all records to CSV (with header)
  const csvRows = records.map(record => recordToCsvRow(record));
  writeCsv(csvFile, csvRows);
  
  return batchId;
}

/**
 * Append a single row to CSV file, creating headers if file doesn't exist
 */
function appendCsvRow(csvFile: string, row: Record<string, unknown>): void {
  const fileExists = fs.existsSync(csvFile);
  
  if (!fileExists) {
    // Create file with headers
    writeCsv(csvFile, [row]);
  } else {
    // Append row without headers
    const headers = Object.keys(row);
    const escape = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    
    const line = headers.map((h) => escape((row as any)[h])).join(",") + "\n";
    fs.appendFileSync(csvFile, line, "utf8");
  }
}

/**
 * Create a batch summary object with statistics
 */
export interface BatchSummary {
  batchId: string;
  totalRuns: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  totalDurationMs: number;
  averageLatencyMs: number | null;
  averageTotalCost: number | null;
  averageBridgeCost: number | null;
  config: {
    mode: string;
    direction: string;
    amount: number;
    runs: number;
  };
  timestamp: string;
}

/**
 * Generate and save batch summary
 */
export function saveBatchSummary(
  batchId: string,
  records: RunRecord[],
  startTime: number,
  basePath: string = 'data/results'
): void {
  const successfulRecords = records.filter(r => r.success);
  const totalDuration = Date.now() - startTime;
  
  // Calculate averages
  let avgLatency: number | null = null;
  let avgTotalCost: number | null = null;
  let avgBridgeCost: number | null = null;
  
  if (successfulRecords.length > 0) {
    avgLatency = successfulRecords.reduce((sum, r) => {
      const latency = r.timestamps.t3_finalize && r.timestamps.t1_submit
        ? r.timestamps.t3_finalize - r.timestamps.t1_submit
        : 0;
      return sum + latency;
    }, 0) / successfulRecords.length;
    
    avgTotalCost = successfulRecords.reduce((sum, r) => 
      sum + (r.costs.totalCost || 0), 0
    ) / successfulRecords.length;
    
    avgBridgeCost = successfulRecords.reduce((sum, r) => 
      sum + (r.costs.totalBridgeCost || 0), 0
    ) / successfulRecords.length;
  }
  
  const summary: BatchSummary = {
    batchId,
    totalRuns: records.length,
    successCount: successfulRecords.length,
    failureCount: records.length - successfulRecords.length,
    successRate: (successfulRecords.length / records.length) * 100,
    totalDurationMs: totalDuration,
    averageLatencyMs: avgLatency,
    averageTotalCost: avgTotalCost,
    averageBridgeCost: avgBridgeCost,
    config: {
      mode: records[0].cfg.networks.mode,
      direction: records[0].cfg.direction,
      amount: records[0].cfg.xrpAmount,
      runs: records[0].cfg.runs
    },
    timestamp: new Date().toISOString()
  };
  
  const summaryFile = path.join(basePath, `${batchId}_summary.json`);
  writeJson(summaryFile, summary);
}