# Asset Bridge Performance Tool

## 📖 Introduction
This repository provides a framework for evaluating **asset bridge performance** across **heterogeneous blockchains** using the **Axelar Protocol**. The framework was developed in the context of a broader academic study on blockchain interoperability (see []()). The tool provides reproducible experiments on cross-chain asset transfers. Contributions to further this work are welcome.

## 🔗 Supported Blockchains
- **XRP Ledger (XRPL)**
- **XRPL EVM Sidechain**

## 🛠️ Features

- **Reproducible experiments**  
  Run standardized bridge experiments through abstracted function calls:  
  `prepare → submit → observe → observeGasRefund`.

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

Read more of the metrics here: [ARTIFACT.md](./ARTIFACT.md)

- **Result artifacts**  
  All runs are saved as JSONL and CSV files in `/data/results/`, enabling direct reuse in analysis or integration with academic papers.

- **TypeScript codebase**  
  Implemented in **TypeScript**, with strongly typed adapters and utilities for consistency and maintainability.

- **Extensible utilities**  
  Includes shared modules for logging, metrics, file persistence, environment management, and time handling.

- **Research-oriented design**  
  Structured for reproducibility and comparability, supporting both case studies and large-scale experimental campaigns.

## 📂 Repository Structure
- **`data/results/`** – Artifacts of performed bridge runs (JSON/CSV) used in the paper  
- **`adapters/`** – Chain-specific implementations of bridge steps (XRPL, EVM)  
- **`runners/`** – Batch execution logic (config, context, orchestration)  
- **`utils/`** – Shared utilities for logging, metrics, environment handling, file I/O  
- **`index.ts`** – Entry point that coordinates the top-level logic  
- **`types.ts`** – Shared TypeScript types and interfaces

## 🔄 Experiment Steps
Each run follows the same bridging flow:

1. **Prepare** – Initialize wallet and client  
2. **Submit** – Broadcast the transaction on the source blockchain  
3. **Observe** – Detect and confirm the transaction on the target blockchain  
4. **Finalize (Target)** – Record the received transaction on the target chain  
5. **Observe Gas Refund** – Track the Axelar gas refund process  
6. **Finalize (Source)** – Confirm refund settlement on the source blockchain 

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
   - Answer the interactive prompts (network mode, direction, amount, runs).

8. **Execute experiments**
   - The program will run the selected tests.
   - Results (JSON and CSV) are saved under `data/results/`.


## 🎥 Demo Video
A short demonstration of the tool in action is available here:  
[]()

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

- 
- 