# Metrics

## Overview
This system measures **bridge performance metrics** for research and reproducible experiments.  
It produces **per-batch artifacts**, **direction-level summaries**, and an **aggregated CSV** for cross-batch analysis.

## Data collection

### File structure
Results are organized by direction, then by batch:

```
data/results/
├── xrpl_to_evm/
│   ├── {batchId_1}/
│   │   ├── {batchId_1}.jsonl          # Raw run records (one JSON per line)
│   │   ├── {batchId_1}_metrics.json   # Batch summary + raw arrays
│   │   └── {batchId_1}_metrics.csv    # Single-row CSV with batch metrics
│   ├── {batchId_2}/
│   │   └── ...
│   ├── xrpl_to_evm_summary.csv              # All batches for this direction
│   └── xrpl_to_evm_aggregated_metrics.json  # Aggregated statistics
├── evm_to_xrpl/
│   ├── {batchId_1}/
│   │   └── ...
│   ├── evm_to_xrpl_summary.csv
│   └── evm_to_xrpl_aggregated_metrics.json
└── all_metrics.csv                          # Global summary (all directions)
```

### Files generated per batch
Each batch creates three files in its own folder:
- **`{batchId}.jsonl`** – Raw run records (one JSON object per line)
- **`{batchId}_metrics.json`** – Complete metrics report with summary and raw data arrays
- **`{batchId}_metrics.csv`** – Single-row CSV containing the batch summary

### Direction-level files
Each direction folder contains:
- **`{direction}_summary.csv`** – Append-only file with one row per batch, tracking metrics evolution over time
- **`{direction}_aggregated_metrics.json`** – Combined statistics across all batches for this direction, including:
  - Total runs, successes, and failures across all batches
  - Aggregated latency distribution (P50, P90, P95, P99, etc.)
  - Mean costs across all runs
  - Batch count and last update timestamp

### Global file
- **`all_metrics.csv`** – Append-only file with all batch summaries across all directions

### Batch ID format
```
{date}_{time}_{direction}_{tag}
```
Example: `2025-01-15T10-30-45-123Z_xrpl_to_evm_mainnet`

## Metrics collected

### Success metrics
- `totalRuns`: attempted runs in the batch
- `successCount`, `failureCount`: outcome counts
- `successRate`: ratio of successful runs (0–1)

### Latency (milliseconds, successful runs only)
Distribution statistics for end-to-end bridge latency:
- `minMs`, `maxMs`: minimum and maximum latencies
- `p50Ms`, `p90Ms`, `p95Ms`, `p99Ms`: percentile values
- `meanMs`: arithmetic mean
- `stdDevMs`: standard deviation
- **Computed as**: `t3_finalized - t1_submit` (submit timestamp to finalization timestamp)

### Costs (in XRP)
Cost statistics across successful runs:
- `n`: number of successful runs with cost data
- `meanTotalXrp`, `minTotalXrp`, `maxTotalXrp`, `stdDevTotalXrp`: total cost statistics
- `meanBridgeXrp`: average bridge fee
- `meanSourceFeeXrp`: average source chain transaction fee
- `meanTargetFeeXrp`: average target chain transaction fee

### Batch metadata
- `batchDurationMs`: total wall-clock time of the batch
- `timestampIso`: ISO 8601 timestamp of batch completion
- `tag`: user-defined batch identifier
- `direction`: bridge direction (xrpl_to_evm or evm_to_xrpl)
- `xrpAmount`: amount transferred per run
- `runsPlanned`: intended number of runs

## Direction-level aggregation

The aggregated metrics file (`{direction}_aggregated_metrics.json`) combines all batches for a specific direction:

```json
{
  "summary": {
    "timestampIso": "2025-01-15T10:45:30.123Z",
    "tag": "xrpl_to_evm_aggregated",
    "direction": "xrpl_to_evm",
    "totalRuns": 100,
    "successCount": 98,
    "failureCount": 2,
    "successRate": 0.98,
    "latency": { ... },
    "costs": { ... }
  },
  "batchCount": 10,
  "lastUpdated": "2025-01-15T10:45:30.123Z"
}
```

**How it works**:
1. After each batch completes, all JSONL files for that direction are parsed
2. Individual run records are extracted and aggregated
3. Statistics are recomputed across the entire dataset
4. The aggregated metrics file is updated

This allows you to:
- Track cumulative performance across multiple test sessions
- Compare directions (e.g., XRPL→EVM vs EVM→XRPL)
- Identify trends as you add more batches

## Statistical methodology

- **Percentiles**: Linear interpolation on sorted latencies  
  `P(p) = (1-w) * arr[lo] + w * arr[hi]` where `idx = (n-1) * p`
  
- **Standard deviation**: Population formula  
  `σ = √(Σ(x-μ)² / n)`
  
- **Mean**: Arithmetic mean  
  `μ = Σx / n`

## Reproducibility

- **Raw data**: Every run stored in JSONL format (`{batchId}.jsonl`)
- **Batch metrics**: Summarized in both JSON and CSV formats
- **Direction tracking**: `{direction}_summary.csv` provides chronological view of all batches
- **Aggregation**: Direction-level statistics computed from raw run data
- **Global index**: `all_metrics.csv` accumulates one row per batch across all directions
- **Privacy**: Sensitive inputs (seeds/private keys) are **never saved** in output files

## Use cases

### Single batch analysis
Open `{batchId}_metrics.json` for detailed statistics on a specific test run.

### Direction comparison
Compare `xrpl_to_evm_aggregated_metrics.json` with `evm_to_xrpl_aggregated_metrics.json` to identify asymmetries in bridge performance.

### Trend analysis
Load `{direction}_summary.csv` into a spreadsheet or analysis tool to visualize how metrics evolve over time.

### Cross-direction analysis
Use `all_metrics.csv` for global analysis across all test configurations.