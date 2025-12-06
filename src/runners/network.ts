import { NetworkConfig } from "../types";

// Only mainnet is supported
export const NETWORK_CONFIG: NetworkConfig = {
  mode: "mainnet",
  xrpl: {
    wsUrl: "wss://xrplcluster.com/",
    walletSeed: "", // Deprecated - wallets now generated from MNEMONIC in environment.ts
    gateway: "rfmS3zqrQrka8wVyhXifEeyTwe8AMz2Yhw", // Gatway multisig account
    gas_fee: "200000"
    // Gas refunder address - No longer used, too many addresses
  },
  evm: {
    rpcUrl: "https://rpc.xrplevm.org",
    walletPrivateKey: "", // Deprecated - wallets now generated from MNEMONIC in environment.ts
    gateway: "B5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C", // Gateway contract
    relayer: "ce16F69375520ab01377ce7B88f5BA8C48F8D666", // Relayer Proxy (e.g. SquidRouter) // "DC74A55C7F58a02FC3c25888790E6Ec6BCcB43D6" Relayer Implementation (Squid Router)
    // gas_refunder: "0x2d5d7d31F671F86C782533cc367F14109a082712" // Axelar Gas Service - No longer used
  },
};