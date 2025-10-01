# Bridge Performance Metrics

## Overview

This metrics system provides comprehensive statistical analysis for bridge performance testing, suitable for computer science research and scientific publications.

## Data Collection

### Files Generated Per Batch

For each batch run, the following files are created in `data/results/`:

1. **`{batchId}.jsonl`** - Complete run records (one JSON object per line)
2. **`{batchId}.csv`** - Flat CSV format for all runs with detailed timing and cost data
3. **`{batchId}_summary.json`** - High-level summary statistics
4. **`{batchId}_metrics.json`** - Comprehensive statistical metrics with raw data
5. **`{batchId}_metrics.csv`** - Single-row CSV with all computed metrics
6. **`all_metrics.csv`** - Aggregated metrics from all batches (appended continuously)

### Batch ID Format

```
{mode}_{direction}_{date}_{time}
```

Example: `testnet_xrpl-to-evm_2025-10-01_14-30-25`

## Metrics Collected

### Success Metrics

- **Total Runs** (`n`): Number of bridge transactions attempted
- **Success Count**: Number of successfully completed transactions
- **Failure Count**: Number of failed transactions
- **Success Rate**: Percentage of successful transactions (0-100%)

### Latency Distribution (milliseconds)

All latency metrics are calculated from successful runs only:

- **Min Latency**: Fastest transaction observed
- **P50 (Median)**: 50th percentile - half of transactions complete faster
- **P90**: 90th percentile - 90% of transactions complete faster
- **P95**: 95th percentile - typical SLA metric
- **P99**: 99th percentile - captures tail latency
- **Max Latency**: Slowest transaction observed
- **Mean Latency**: Average latency across all successful runs
- **Standard Deviation**: Measure of latency variance

#### Interpretation

- **P50** gives you typical performance
- **P90/P95** are commonly used for SLA definitions
- **P99** captures worst-case scenarios for most users
- **High Std Dev** indicates inconsistent performance

### Cost Analysis (USD)

- **Average Total Cost**: Mean cost per transaction
- **Min/Max Cost**: Cost range observed
- **Standard Deviation**: Cost variance
- **Average Bridge Cost**: Protocol fees only (excluding gas)
- **Average Source Fee**: Transaction fee on source chain
- **Average Target Fee**: Transaction fee on target chain

### Timing Breakdown (milliseconds)

- **Preparation Time**: Time from t0 (prepare) to t1 (submit)
- **Observation Time**: Time from t2 (observe) to t3 (finalized)
- **Total Latency**: End-to-end time (t1 to t3)

### Throughput Metrics

- **Transactions Per Second (TPS)**: Successful transactions / batch duration
- **Batch Duration**: Total time for entire batch execution

## Statistical Methodology

### Percentile Calculation

The system uses **linear interpolation** for percentile calculation:

```typescript
function percentile(sortedAsc: number[], p: number): number {
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const w = idx - lo;
  return (1 - w) * sortedAsc[lo] + w * sortedAsc[hi];
}
```

This provides more accurate percentiles than simple rank-based methods, especially for small sample sizes.

### Standard Deviation

Population standard deviation is calculated as:

```
σ = √(Σ(x - μ)² / n)
```

Where μ is the mean and n is the sample size.

## Usage for Research

### Analyzing Single Batch

```typescript
import { readJson } from './utils/fsio';
import { MetricsReport } from './utils/fsio';

const metrics = readJson<MetricsReport>('data/results/{batchId}_metrics.json');

console.log(`Success Rate: ${metrics.summary.successRate * 100}%`);
console.log(`P50 Latency: ${metrics.summary.p50LatencyMs}ms`);
console.log(`P99 Latency: ${metrics.summary.p99LatencyMs}ms`);
```

### Cross-Batch Analysis

The `all_metrics.csv` file aggregates metrics from all batches, making it easy to:

1. Compare different network modes (testnet vs mainnet)
2. Analyze directional differences (XRPL→EVM vs EVM→XRPL)
3. Study performance over time
4. Identify trends and anomalies

## Reproducibility

### Essential Metadata

Each metrics file includes:

- **Timestamp**: ISO 8601 format
- **Configuration**: Network mode, direction, amount
- **Raw Data**: All successful latencies, failure indices, cost breakdown

### Recommended Practice for Publications

1. **Save all JSONL files** - Complete audit trail
2. **Report sample size** - Include `n`, `success_count`, `failure_count`
3. **Include error bars** - Use `stddev_latency_ms` for variance
4. **Report percentiles** - P50, P90, P95, P99 provide complete picture
5. **Document environment** - Network mode, date, configuration

### Example Citation Format

> Bridge performance was evaluated across 100 transactions on the XRP Ledger testnet. The median latency (P50) was 45.2 ± 3.8 seconds, with P90 at 62.1 seconds and P99 at 78.4 seconds. The success rate was 98%, with an average cost of $0.0023 per transaction.

## Data Privacy

All saved data automatically **redacts sensitive information**:

- Wallet seeds → `[REDACTED]`
- Private keys → `[REDACTED]`

Transaction hashes and public addresses are preserved for verification.

## Advanced Analysis

### Custom Metrics

You can extend the metrics system by modifying `metrics.ts`:

```typescript
// Add new percentiles
const p75LatencyMs = latencies.length ? percentile(latencies, 0.75) : null;

// Add coefficient of variation
const cvLatency = meanLatencyMs ? (stdDevLatencyMs / meanLatencyMs) : null;

// Add failure analysis
const errorTypes = rows
  .filter(r => !r.success)
  .map(r => r.abort_reason)
  .reduce((acc, reason) => {
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
```

### Time Series Analysis

For studying performance trends:

```typescript
import { readJson } from './utils/fsio';
import fs from 'fs';

const files = fs.readdirSync('data/results')
  .filter(f => f.endsWith('_metrics.json'));

const timeSeries = files.map(f => {
  const metrics = readJson(`data/results/${f}`);
  return {
    timestamp: metrics.timestamp,
    p50: metrics.summary.p50LatencyMs,
    p99: metrics.summary.p99LatencyMs,
  };
}).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
```

## FAQ

**Q: Why are latencies only computed on successful runs?**  
A: Failed transactions have incomplete timing data and would skew the distribution. Failure rate is tracked separately.

**Q: What's the difference between `totalCost` and `bridgeCost`?**  
A: `totalCost` includes source fee + bridge fee + target fee. `bridgeCost` is just the protocol fee.

**Q: How many runs should I do for statistical significance?**  
A: For P50/P90: minimum 30 runs. For P99: recommend 100+ runs. For production benchmarks: 1000+ runs.

**Q: Can I use this for real-time monitoring?**  
A: Yes! The `all_metrics.csv` file is appended in real-time and can be tailed or streamed to monitoring dashboards.
