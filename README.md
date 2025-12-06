# Asset Bridge Performance Tool

## 📖 Introduction
This repository provides a framework for evaluating **asset bridge performance** across **heterogeneous blockchains** using the **Axelar Protocol**. The framework was developed in the context of a broader academic study on blockchain interoperability (see []()). The tool provides reproducible experiments on cross-chain asset transfers. Contributions to further this work are welcome.

## 🔗 Supported Blockchains
- **XRP Ledger (XRPL)**
- **XRPL EVM Sidechain**

## 🛠️ Features

- **Reproducible experiments**
  Run standardized bridge experiments through abstracted function calls:
  `prepare → submit → observe`.

- **Modular blockchain support**  
  Extend the framework to new blockchains by simply:
  - Adding a `[blockchain].adapter.ts` file under `/adapters`  
  - Defining network parameters in `/runners/network`  
  - Supplying credentials (e.g., private key, seed) in `.env`

- **Multi-network ready**  
  Experiments can be reproduced on both **testnet** and **mainnet** environments.

- **Performance metrics**  
  Automatically compute and export latency and cost statistics, including:  
  - Percentiles (p50, p90, p95, p99)  
  - Median, mean, minimum, maximum  
  - Standard deviation

- **Direction-based organization**  
  Results are organized by bridge direction (`xrpl_to_evm`, `evm_to_xrpl`), enabling easy comparison and trend analysis.

- **Aggregated statistics**  
  Automatic aggregation of metrics across multiple batches per direction, providing:
  - Combined latency distributions across all runs
  - Cumulative success/failure rates
  - Average costs over time
  - Chronological tracking via direction-specific summary files

Read more about metrics and data structure in [ARTIFACT.md](./ARTIFACT.md).

- **Result artifacts**  
  All runs are saved as JSONL and CSV files in `/data/results/`, organized by direction and batch, enabling direct reuse in analysis or integration with academic papers.

- **TypeScript codebase**  
  Implemented in **TypeScript**, with strongly typed adapters and utilities for consistency and maintainability.

- **Extensible utilities**  
  Includes shared modules for logging, metrics, file persistence, environment management, and time handling.

- **Research-oriented design**  
  Structured for reproducibility and comparability, supporting both case studies and large-scale experimental campaigns.

## 📂 Repository Structure
- **`data/results/`** – Organized by direction, contains artifacts of performed bridge runs (JSON/CSV)
  - **`xrpl_to_evm/`** – All batches and aggregated metrics for XRPL → EVM direction
  - **`evm_to_xrpl/`** – All batches and aggregated metrics for EVM → XRPL direction
  - **`all_metrics.csv`** – Global summary across all directions
- **`adapters/`** – Chain-specific implementations of bridge steps (XRPL, EVM)  
- **`runners/`** – Batch execution logic (config, context, orchestration)  
- **`utils/`** – Shared utilities for logging, metrics, environment handling, file I/O  
- **`index.ts`** – Entry point that coordinates the top-level logic  
- **`types.ts`** – Shared TypeScript types and interfaces

## 📊 Data Organization

### Per-batch files
Each batch creates its own folder with three files:
```
data/results/{direction}/{batchId}/
├── {batchId}.jsonl          # Raw run records
├── {batchId}_metrics.json   # Detailed metrics report
└── {batchId}_metrics.csv    # Single-row summary
```

### Direction-level files
Each direction maintains aggregated files:
```
data/results/{direction}/
├── {direction}_summary.csv              # All batches chronologically
└── {direction}_aggregated_metrics.json  # Combined statistics
```

### Global file
```
data/results/all_metrics.csv  # All batches, all directions
```

For detailed information about metrics and file formats, see [ARTIFACT.md](./ARTIFACT.md).

## 📄 Experiment Steps
Each run follows the same bridging flow:

1. **Prepare** – Initialize wallet and client
2. **Submit** – Broadcast the transaction on the source blockchain
3. **Observe** – Detect and confirm the transaction on the target blockchain until finalization 

## 🚀 How to Run

1. **Clone the repository**
   ```bash
   git clone https://github.com/mathisrgt/xrpl-evm-interop-eval.git
   cd xrpl-evm-interop-eval
   ```

2. **Create an XRPL wallet**
   - You can easily generate one on the [XRPL Faucet](https://xrpl.org/resources/dev-tools/xrp-faucets).
   - Copy the **seed** (⚠️ *not the private key*).
   - Add it to your `.env` file:
     ```env
     XRPL_WALLET_SEED=snXXXXXXXXXXXXXXXXXXXX
     ```

3. **Create an EVM wallet**
   - Generate a wallet (e.g., with MetaMask or `viem`/`ethers`).
   - Copy the **private key**.
   - Add it to your `.env` file:
     ```env
     EVM_WALLET_PRIVATE_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
     ```

4. **Prepare environment variables**
   - Rename `.env.example` → `.env`
   - Fill in the values as shown above.

5. **Install dependencies**
   - If npm is not installed, install [Node.js](https://nodejs.org/)
   - Then run:
     ```bash
     npm install
     ```

6. **Start the tool**
   ```bash
   npm start
   ```

7. **Configure the run**
   - Answer the interactive prompts (direction, amount, runs).

8. **Execute experiments**
   - The program will run the selected tests.
   - Results are automatically saved under `data/results/{direction}/{batchId}/`.

9. **View aggregated results**
   - Check `data/results/{direction}/{direction}_aggregated_metrics.json` for combined statistics across all batches in that direction.
   - Open `data/results/{direction}/{direction}_summary.csv` to see chronological batch metrics.

## 🔄 Batch Testing All Bridges

For comprehensive testing, you can run all bridge directions sequentially using the batch test script:

```bash
# Run all bridges with default settings (5 XRP, 1 run per direction)
npm run test:all

# Run all bridges with custom amount (3 XRP, 1 run)
npm run test:all 3

# Run all bridges with custom amount and runs (3 XRP, 2 runs)
npm run test:all 3 2

# Or run the script directly
./scripts/run-all-bridges.sh 3 2
```

**What gets tested:**
1. XRPL → Flare (FAsset - fixed: 10 XRP, 1 run)
2. Flare → XRPL (FAsset - fixed: 10 FXRP, 1 run)
3. XRPL → XRPL-EVM (Axelar - custom amount & runs)
4. XRPL-EVM → XRPL (Axelar - custom amount & runs)
5. XRPL → Base (Near Intents - custom amount & runs)
6. Base → XRPL (Near Intents - custom amount & runs)

**Note:** FAsset bridges use fixed configuration (10 XRP/FXRP, 1 run). See `scripts/README.md` for more details.

## 📈 Analyzing Results

### Single batch analysis
```bash
cat data/results/xrpl_to_evm/{batchId}/{batchId}_metrics.json
```

### Direction comparison
Compare aggregated metrics between directions:
```bash
cat data/results/xrpl_to_evm/xrpl_to_evm_aggregated_metrics.json
cat data/results/evm_to_xrpl/evm_to_xrpl_aggregated_metrics.json
```

### Trend analysis
Import direction summary CSV into your analysis tool:
```bash
data/results/xrpl_to_evm/xrpl_to_evm_summary.csv
```

### Global overview
```bash
cat data/results/all_metrics.csv
```

## 🎥 Demo Video
A short demonstration of the tool in action is available [here](https://youtu.be/8jwsN8dDhSY).

## 📄 Related Paper
This repository is part of a broader academic study on blockchain interoperability and bridge performance.  
The paper is available at: []()

## 👩‍💻 Authors
- Mathis **SERGENT**
- Vera **RADEVA**  
- Parisa **GHODOUS**  
- Jean-Patrick **GELAS**  
- Nicolas **FIGAY**

## 🕵️ Reviewers

- Odelia **TORTEMAN**
- Thomas **HUSSENET**
- ...