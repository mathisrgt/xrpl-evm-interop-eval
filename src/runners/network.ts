import { EVM_WALLET_PRIVATE_KEY, XRPL_WALLET_SEED } from "../utils/environment";
import { NetworkConfig, NetworkMode } from "../types";
import { Address } from "viem";

export const NETWORK_CONFIG: Record<NetworkMode, NetworkConfig> = {
  mainnet: {
    mode: "mainnet",
    xrpl: {
      wsUrl: "wss://xrplcluster.com/",
      walletSeed: XRPL_WALLET_SEED,
      gateway: "rfmS3zqrQrka8wVyhXifEeyTwe8AMz2Yhw",
      gas_fee: "200000",
      gas_refunder: ""
    },
    evm: {
      rpcUrl: "https://rpc.xrplevm.org",
      walletPrivateKey: EVM_WALLET_PRIVATE_KEY,
      gateway: "B5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C", // Gatway multisig account
      contract: "ce16F69375520ab01377ce7B88f5BA8C48F8D666", // Token contract address
    },
  },

  testnet: {
    mode: "testnet",
    xrpl: {
      wsUrl: "wss://s.altnet.rippletest.net:51233",
      walletSeed: XRPL_WALLET_SEED,
      gateway: "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2",
      gas_fee: "1700000",
      gas_refunder: "raTjWP1DGTRzKCEv2R9ftx71wr1xs8jaau"
    },
    evm: {
      rpcUrl: "https://rpc.testnet.xrplevm.org",
      walletPrivateKey: EVM_WALLET_PRIVATE_KEY,
      gateway: "B5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C", // Gateway contract
      contract: "9bEb991eDdF92528E6342Ec5f7B0846C24cbaB58", // Token contract address
    },
  },
};