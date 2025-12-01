import dotenv from 'dotenv';

dotenv.config();

if (process.env.XRPL_WALLET_SEED === undefined)
    throw new Error('XRPL_WALLET_SEED is undefined');
export const XRPL_WALLET_SEED = process.env.XRPL_WALLET_SEED;

if (process.env.EVM_WALLET_PRIVATE_KEY === undefined)
    throw new Error('EVM_WALLET_PRIVATE_KEY is undefined');
export const EVM_WALLET_PRIVATE_KEY = process.env.EVM_WALLET_PRIVATE_KEY;

if (process.env.ONE_CLICK_JWT === undefined)
    throw new Error('ONE_CLICK_JWT is undefined');
export const ONE_CLICK_JWT = process.env.ONE_CLICK_JWT;

if (process.env.SQUID_INTEGRATOR_ID === undefined)
    throw new Error('SQUID_INTEGRATOR_ID is undefined');
export const SQUID_INTEGRATOR_ID = process.env.SQUID_INTEGRATOR_ID;