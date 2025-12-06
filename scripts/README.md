# Bridge Test Scripts

This directory contains utility scripts for running bridge performance tests.

## Available Scripts

### `run-all-bridges.sh`

Runs all 6 bridge directions sequentially with configurable parameters.

**Usage:**
```bash
./scripts/run-all-bridges.sh [AMOUNT] [RUNS]
```

**Parameters:**
- `AMOUNT` - Amount of XRP to bridge for non-Flare bridges (default: 5)
- `RUNS` - Number of test runs per direction (default: 1)

**Bridge Directions:**
1. XRPL → Flare (FAsset, 1 run)
2. Flare → XRPL (FAsset, 1 run)
3. XRPL → XRPL-EVM (Axelar - uses AMOUNT and RUNS)
4. XRPL-EVM → XRPL (Axelar - uses AMOUNT and RUNS)
5. XRPL → Base (Near Intents - uses AMOUNT and RUNS)
6. Base → XRPL (Near Intents - uses AMOUNT and RUNS)

**Examples:**
```bash
# Run all bridges with 3 XRP and 2 runs each
./scripts/run-all-bridges.sh 3 2

# Run all bridges with default values (5 XRP, 1 run)
./scripts/run-all-bridges.sh

# Show help message
./scripts/run-all-bridges.sh --help
```

**Using npm:**
```bash
# Run with defaults (5 XRP, 1 run)
npm run test:all

# Run with custom amount (3 XRP, 1 run)
npm run test:all 3

# Run with custom amount and runs (3 XRP, 2 runs)
npm run test:all 3 2
```

**Notes:**
- All operations use mainnet (real funds)
- FAsset bridges always use 10 XRP/FXRP and 1 run (fixed configuration)
- Make sure you have sufficient balance on all chains before running
- Results are saved to `data/results/` organized by bridge and direction
- The script will ask for confirmation before starting
- If a test fails, you'll be asked whether to continue with remaining tests

**Output:**
- Progress indicators for each bridge test
- Summary with completion statistics
- Total duration
- List of failed tests (if any)
- Results location information
