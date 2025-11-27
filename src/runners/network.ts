import { NetworkConfig, NetworkMode } from "../types";
import { EVM_WALLET_PRIVATE_KEY, XRPL_WALLET_SEED } from "../utils/environment";

export const NETWORK_CONFIG: Record<NetworkMode, NetworkConfig> = {
  mainnet: {
    mode: "mainnet",
    xrpl: {
      wsUrl: "wss://xrplcluster.com/",
      walletSeed: XRPL_WALLET_SEED,
      gateway: "rfmS3zqrQrka8wVyhXifEeyTwe8AMz2Yhw", // Gatway multisig account
      gas_fee: "200000"
      // Gas refunder address - No longer used, too many addresses
    },
    evm: {
      rpcUrl: "https://rpc.xrplevm.org",
      walletPrivateKey: EVM_WALLET_PRIVATE_KEY,
      gateway: "B5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C", // Gateway contract
      relayer: "ce16F69375520ab01377ce7B88f5BA8C48F8D666", // Relayer (e.g. SquidRouter)
      // gas_refunder: "0x2d5d7d31F671F86C782533cc367F14109a082712" // Axelar Gas Service - No longer used
    },
  },

  testnet: {
    mode: "testnet",
    xrpl: {
      wsUrl: "wss://s.altnet.rippletest.net:51233",
      walletSeed: XRPL_WALLET_SEED,
      gateway: "rNrjh1KGZk2jBR3wPfAQnoidtFFYQKbQn2",
      gas_fee: "1700000",
    },
    evm: {
      rpcUrl: "https://rpc.testnet.xrplevm.org",
      walletPrivateKey: EVM_WALLET_PRIVATE_KEY,
      gateway: "B5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C", 
      relayer: "9bEb991eDdF92528E6342Ec5f7B0846C24cbaB58",
      // gas_refunder: "8F23e84c49624A22E8c252684129910509ADe4e2"
    },
  },
};