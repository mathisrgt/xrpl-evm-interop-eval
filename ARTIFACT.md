# Metrics

## Overview
This system measures **bridge performance metrics** for research and reproducible experiments.  
It produces both **per-batch artifacts** and an aggregated CSV for cross-batch analysis.

## Data collection

### Files generated per batch
Each batch has its own folder:

```
data/results/{batchId}/
  ├─ {batchId}.jsonl          # Raw run records (one JSON per line)
  ├─ {batchId}_metrics.json   # Summary + raw arrays
  ├─ {batchId}_metrics.csv    # Single-row CSV with metrics
```

Additionally:
```
data/results/all_metrics.csv  # Aggregated metrics across batches
```

### Batch ID format
```
{mode}_{direction}_{date}_{time}
```
Example: `testnet_xrpl->evm_2025-10-01_14-30-25`

## Metrics collected

### Success
- `totalRuns`: attempted runs
- `successCount`, `failureCount`
- `successRate`: ratio (0–1)

### Latency (milliseconds, successful runs only)
- `minMs`, `maxMs`
- `p50Ms`, `p90Ms`, `p95Ms`, `p99Ms`
- `meanMs`, `stdDevMs`
- Computed as: `t3_finalized - t1_submit`

### Costs (in XRP)
- `costs.n`: number of successful runs with cost data
- `meanTotalXrp`, `minTotalXrp`, `maxTotalXrp`, `stdDevTotalXrp`
- `meanBridgeXrp`, `meanSourceFeeXrp`, `meanTargetFeeXrp`

### Batch
- `batchDurationMs`: total wall-clock time of the batch

## Statistical methodology

- **Percentiles**: linear interpolation on sorted latencies
- **Std Dev**: population formula `σ = √(Σ(x-μ)² / n)`

## Reproducibility

- Every run stored in JSONL (`{batchId}.jsonl`)
- Metrics summarized in JSON + CSV
- `all_metrics.csv` accumulates one row per batch
- Sensitive inputs (seeds/private keys) are **not saved**
