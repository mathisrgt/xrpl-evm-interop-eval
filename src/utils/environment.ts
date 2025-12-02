import dotenv from 'dotenv';
import { Wallet } from 'xrpl';
import { mnemonicToAccount } from 'viem/accounts';
import type { Account } from 'viem';

dotenv.config();

// Mnemonic-based wallet generation (preferred method)
export const MNEMONIC = process.env.MNEMONIC;

// Legacy environment variables (optional, for backward compatibility)
export const XRPL_WALLET_SEED = process.env.XRPL_WALLET_SEED;
export const EVM_WALLET_PRIVATE_KEY = process.env.EVM_WALLET_PRIVATE_KEY;

// Validate that either MNEMONIC or legacy credentials are provided
if (!MNEMONIC && !XRPL_WALLET_SEED) {
    throw new Error('Either MNEMONIC or XRPL_WALLET_SEED must be provided');
}
if (!MNEMONIC && !EVM_WALLET_PRIVATE_KEY) {
    throw new Error('Either MNEMONIC or EVM_WALLET_PRIVATE_KEY must be provided');
}

if (process.env.ONE_CLICK_JWT === undefined)
    throw new Error('ONE_CLICK_JWT is undefined');
export const ONE_CLICK_JWT = process.env.ONE_CLICK_JWT;

if (process.env.SQUID_INTEGRATOR_ID === undefined)
    throw new Error('SQUID_INTEGRATOR_ID is undefined');
export const SQUID_INTEGRATOR_ID = process.env.SQUID_INTEGRATOR_ID;

/**
 * Generate XRPL wallet from mnemonic or seed
 */
export function getXrplWallet(): Wallet {
    if (MNEMONIC) {
        return Wallet.fromMnemonic(MNEMONIC);
    }
    if (XRPL_WALLET_SEED) {
        return Wallet.fromSeed(XRPL_WALLET_SEED);
    }
    throw new Error('No XRPL wallet credentials available');
}

/**
 * Generate EVM account from mnemonic or private key
 * Returns a viem Account (can be HD wallet from mnemonic or private key account)
 */
export function getEvmAccount(): Account {
    if (MNEMONIC) {
        return mnemonicToAccount(MNEMONIC);
    }
    if (EVM_WALLET_PRIVATE_KEY) {
        const { privateKeyToAccount } = require('viem/accounts');
        return privateKeyToAccount(`0x${EVM_WALLET_PRIVATE_KEY}`);
    }
    throw new Error('No EVM wallet credentials available');
}