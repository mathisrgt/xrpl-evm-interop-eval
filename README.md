# Axelar Bridge Performance Metrics (XRPL ↔ XRPL-EVM)

## 📖 Introduction
This repository contains the experimental framework for measuring the performance of the **Axelar bridge** between the **XRP Ledger (XRPL)** and the **XRPL-EVM sidechain**.  
It is part of a broader study on the **performance of heterogeneous blockchain bridges**, with a concrete application to the XRPL ↔ EVM interoperability environment.

## 🎯 Goal
The code allows you to:
- Reproduce the bridge performance tests on both **testnet** and **mainnet**.  
- Execute controlled runs, collect transaction data, and compute key performance metrics.  
- Use the provided structure and prompts to obtain reproducible artifacts suitable for academic research.  

The implementation is written in **TypeScript**, using [`xrpl.js`](https://github.com/XRPLF/xrpl.js) and [`viem`](https://viem.sh/).

## 📂 Repository Structure
```
data/results     # Experimental artifacts (JSONL, CSV, JSON) used in the paper
adapters/        # Bridge step flows for each supported chain (XRPL, EVM)
runners/         # Run orchestration (config, context, records)
utils/           # Display, file I/O, environment, time helpers
index.ts         # Main entrypoint (high-level batch execution)
types.ts         # Shared types and interfaces
```

## 🔄 Bridge Workflow
Each run follows the same reproducible phases:

1. **Prepare** – setup wallet(s) and clients  
2. **Submit** – send transaction on the source blockchain  
3. **Observe** – detect transaction finality on the target blockchain  
4. **Finalize** – confirm successful receipt  
5. **Observe gas refund** – detect return transfer (if applicable)  
6. **Finalize gas refund** – confirm completion on source blockchain  

## 🚀 How to Run
1. Clone the repository:
   ```bash
   git clone https://github.com/<your-repo>.git
   cd <your-repo>
   ```
2. Create an XRPL wallet (faucets available at https://xrpl.org/resources/dev-tools/xrp-faucets).  
   Add your seed to `.env`:
   ```env
   XRPL_WALLET_SEED=snXXXXXXXXXXXXXXXXXXXX
   ```
3. Create an EVM wallet and add the private key to `.env`:
   ```env
   EVM_WALLET_PRIVATE_KEY=xxxxxxxxxxxxxxxxxxxxxxxx
   ```
4. Install dependencies:
   ```bash
   npm install
   ```
5. Start the experiment:
   ```bash
   npm start
   ```
6. Answer the configuration prompts, run the tests, and collect results.

## 🎥 Demo
A short video walkthrough is available here:  
👉 [YouTube demo link]()

## 📑 Paper
[Link to the corresponding research article]()

## 👥 Authors
- **Mathis SERGENT** – XRPL Commons, Claude Bernard University Lyon 1  
- **Vera RADEVA HADJIEV** – XRPL Commons  
- **Parisa GHODOUS** – Claude Bernard University Lyon 1  
- **Jean-Patrick …** – (to complete)  
- **Nicolas FIGAY** – Airbus, Claude Bernard University Lyon 1  
