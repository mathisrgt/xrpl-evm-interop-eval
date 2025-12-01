import { defineChain } from "viem";

// export const xrplevm = defineChain({
//     id: 1440000,
//     name: "XRPL EVM",
//     network: "xrpl-evm",
//     nativeCurrency: { name: "XRP", symbol: "XRP", decimals: 18 },
//     rpcUrls: { default: { http: [rpcUrl] } },
//     blockExplorers: { default: { name: "XRPL EVM Explorer", url: "https://explorer.xrplevm.org" } },
// });

export const xrplevm = defineChain({
  id: 1440000,
  name: 'XRPL EVM',
  nativeCurrency: {
    name: 'XRP',
    symbol: 'XRP',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ['https://rpc.xrplevm.org'] },
  },
  blockExplorers: {
    default: {
      name: 'blockscout',
      url: 'https://explorer.xrplevm.org',
      apiUrl: 'https://explorer.xrplevm.org/api/v2',
    },
  },
})

export const xrplevmTestnet = defineChain({
  id: 1449000,
  name: 'XRPL EVM Testnet',
  nativeCurrency: {
    name: 'XRP',
    symbol: 'XRP',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.xrplevm.org'] },
  },
  blockExplorers: {
    default: {
      name: 'blockscout',
      url: 'https://explorer.testnet.xrplevm.org',
      apiUrl: 'https://explorer.testnet.xrplevm.org/api/v2',
    },
  },
  testnet: true,
})

export const base = defineChain({
  id: 8453,
  name: 'Base',
  nativeCurrency: {
    name: 'Ethereum',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ['https://mainnet.base.org'] },
  },
  blockExplorers: {
    default: {
      name: 'Basescan',
      url: 'https://basescan.org',
      apiUrl: 'https://api.basescan.org/api',
    },
  },
})
