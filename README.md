Intro:
Performance metrics on Axelar bridge from the xrp ledger <> xrpl evm.
This code take place in a more general study on heterogeneous blockchain bridge performance, with an application envrionment of the XRP Ledger and EVM blockchains.

Goal:
This repo allow you to reproduce the test on both testnet and mainnet.
Give all the code structure and prompt to perform the test, get the result and calculate the metrics.
Programmed using Typescript and the library xrpl.js and viem.

Structure:
- data/results: artifact of performed bridges used in the article
- adapters with all the bridge steps flow for each network
- runners for to handle the data logic of the test (config, context) 
- utils for displays, files, environment data, time handeling
- index: entry file with top logic actions
- types

Steps:
- Prepare: wallet and client
- Submit on the source blockchain
- Observe on the target blockchain
- Finalize receiving the transaction when receiving on the target blockchain
- Observe the gas return
- Finalize the gas return on the source blockchain

How to run:
- clone
- create an xrpl wallet
- rename the file .env.example in .env
- copy and paste the seed (and not the private key!)
can be easly done on https://xrpl.org/resources/dev-tools/xrp-faucets
XRPL_WALLET_SEED=
- create an evm wallet
- copy and paste the private key in the .env
EVM_WALLET_PRIVATE_KEY=
- if not installed, install npm
- install dependencies npm install
- to start: npm start
- answer the questions for the configuration
- run

Demo video:
[youtube link]()

Link to the paper:

Authors:
Mathis SERGENT
Vera RADEVA
Parisa GHODOUS
Jean-Patrick
Nicolas