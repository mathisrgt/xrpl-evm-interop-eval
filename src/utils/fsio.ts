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
    
    // Calculated metrics
    preparation_time_ms: record.timestamps.t1_submit && record.timestamps.t0_prepare ? 
      record.timestamps.t1_submit - record.timestamps.t0_prepare : null,
    total_latency_ms: record.timestamps.t2_observe && record.timestamps.t1_submit ? 
      record.timestamps.t2_observe - record.timestamps.t1_submit : null,
    
    // Transaction hashes
    source_tx_hash: record.txs.sourceTxHash || '',
    target_tx_hash: record.txs.targetTxHash || '',
    bridge_message_id: record.txs.bridgeMessageId || '',
    
    // Costs
    source_fee: record.costs.sourceFee,
    target_fee: record.costs.targetFee,
    bridge_fee: record.costs.bridgeFee,
    total_cost: record.costs.totalCost,
  };
}

/**
 * Save a single record to both JSONL and CSV files (with sensitive data removed)
 */
export function saveRecord(record: RunRecord, basePath: string = 'data/results'): void {
  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const mode = record.cfg.networks.mode;
  const direction = record.cfg.direction; // Already in correct format
  
  const jsonlFile = path.join(basePath, `${mode}_${direction}_${timestamp}.jsonl`);
  const csvFile = path.join(basePath, `${mode}_${direction}_${timestamp}.csv`);
  
  // Sanitize record before saving
  const sanitizedRecord = sanitizeRecord(record);
  
  // Save sanitized record to JSONL
  appendJsonl(jsonlFile, sanitizedRecord);
  
  // Convert to CSV format and append (using original record for data extraction)
  const csvRow = recordToCsvRow(record);
  appendCsvRow(csvFile, csvRow);
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