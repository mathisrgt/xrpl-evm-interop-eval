import { Address } from "viem";

export type NetworkMode = "testnet" | "mainnet";

export type NetworkDirection = "xrpl_to_evm" | "evm_to_xrpl";

export interface SourceOutput {
    xrpAmount: number; // Block or Ledger
    txHash: string; // Source chain submission transaction hash
    submittedAt: number; // Block or Ledger
    txFee: number;
}

export interface TargetOutput {
    xrpAmount: number; // Block or Ledger
    txHash: string; // Destination chain reception transaction hash
    finalizedAt: number; // Block or Ledger
    txFee: number;
}

export interface GasRefundOutput {
    xrpAmount: number;
    txHash: string;
}

export interface ChainAdapter {
    /** One-time client/wallet setup; store handles into ctx.cache */
    prepare(ctx: RunContext): Promise<void>;

    /** Submit the *source* transfer; args are chain-specific */
    submit(ctx: RunContext): Promise<SourceOutput>;

    /** Listen for the reception of a payment on the **destination** blockchain */
    observe(ctx: RunContext): Promise<TargetOutput>;

    /** Listen for the reception of a payment on the **destination** blockchain */
    observeGasRefund(ctx: RunContext): Promise<GasRefundOutput>;
}

/** Per-network endpoints & gateways (no run-specific fields here). */
export type NetworkConfig = {
    mode: NetworkMode;
    xrpl: {
        wsUrl: string;
        walletSeed: string;             // fill from env for real use
        gateway: string;                // XRPL classic address
        gas_fee: string;
        gas_refunder: string;   
    };
    evm: {
        rpcUrl: string;
        walletPrivateKey: string;       // hex string WITHOUT 0x or WITH? (be consistent in your code)
        gateway: string;                // EVM contract/router address
        contract: string;       
        gas_refunder: string;        
    };
};

/** Static inputs for a batch/run (reproducible recipe). */
export interface RunConfig {
    tag: string;                  // e.g., "baseline-10"
    runs: number;                 // e.g., 10
    xrpAmount: number;            // transfer amount in XRP (human units)
    direction: NetworkDirection;  // source -> target
    networks: NetworkConfig;
}

/** Fees normalized (null if not computed). */
export interface RunCosts {
    sourceFee: number | null;
    targetFee: number | null;
    bridgeFee: number | null;
    totalCost: number | null;
    amountDifference: number | null;
}

/** Phase timestamps (ms since epoch). Optional during execution. */
export interface RunTimestamps {
    t0_prepare?: number;
    t1_submit?: number;
    t2_observe?: number;
    t3_finalize?: number;
}

/** Transaction identifiers discovered during the run. */
export interface RunTxs {
    sourceTxHash?: string;
    targetTxHash?: string;
    bridgeMessageId?: string;
}

/** Mutable runtime state shared across phases (NOT for publishing). */
export interface RunContext {
    readonly cfg: RunConfig;
    ts: RunTimestamps;
    txs: RunTxs;
    cache: {
        xrpl?: {
            client: import("xrpl").Client;
            wallet: import("xrpl").Wallet;
        };
        evm?: {
            publicClient: import("viem").PublicClient;
            walletClient: import("viem").WalletClient;
            account: import("viem").Account;
            chain: import("viem").Chain;
        };
    };
}

/** Immutable outcome used for analysis & sharing (append to JSONL/CSV). */
export interface RunRecord {
    runId: string;              // deterministic ID per run
    cfg: RunConfig;             // copy of inputs used
    timestamps: RunTimestamps;  // finalized stamps (some may still be undefined on abort)
    txs: RunTxs;                // hashes/ids for traceability
    costs: RunCosts;            // normalized fees (USD) or nulls
    success: boolean;           // explicit success flag
    abort_reason?: string;
}
