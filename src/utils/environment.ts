import dotenv from 'dotenv';
import { Address } from 'viem';

dotenv.config();

if (process.env.XRPL_WALLET_SEED === undefined)
    throw new Error('XRPL_WALLET_SEED is undefined');
export const XRPL_WALLET_SEED = process.env.XRPL_WALLET_SEED;

if (process.env.EVM_WALLET_PRIVATE_KEY === undefined)
    throw new Error('EVM_WALLET_PRIVATE_KEY is undefined');
export const EVM_WALLET_PRIVATE_KEY = process.env.EVM_WALLET_PRIVATE_KEY;

if (process.env.XRPL_TX_PAYLOAD === undefined)
    throw new Error('XRPL_TX_PAYLOAD is undefined');
export const XRPL_TX_PAYLOAD = process.env.XRPL_TX_PAYLOAD;
