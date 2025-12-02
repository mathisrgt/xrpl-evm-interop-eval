import { CleanupManager } from "./utils/cleanup";

/** Supported network environments. */
export type NetworkMode = "testnet" | "mainnet";

/** Direction of a transfer in the bridge tests. */
export type NetworkDirection = "xrpl_to_base" | "base_to_xrpl" | "xrpl_to_xrpl_evm" | "xrpl_evm_to_xrpl";

/** Output from the source chain after submitting a transfer. */
export interface SourceOutput {
    xrpAmount: number; // Amount in the native currency (XRP for axelar, USD for near-intents)
    txHash: string;
    submittedAt: number;
    txFee: number;
    currency?: 'XRP' | 'USD'; // Currency type for proper display
}

/** Output from the target chain after a transfer is finalized. */
export interface TargetOutput {
    xrpAmount: number; // Amount in the native currency (XRP for axelar, USD for near-intents)
    txHash: string;
    finalizedAt: number;
    txFee: number;
    currency?: 'XRP' | 'USD'; // Currency type for proper display
}

/** Output when a gas refund is received. */
export interface GasRefundOutput {
    xrpAmount: number;
    txHash: string;
}

/** Adapter interface to abstract over XRPL and EVM chains in runs. */
export interface ChainAdapter {
    /**
     * Prepare client/wallet for this chain.
     * Should store initialized handles into ctx.cache.
     */
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
        walletSeed: string;
        gateway: string;
        gas_fee: string;
    };
    evm: {
        rpcUrl: string;
        walletPrivateKey: string;
        gateway: string;
        relayer: string;      
    };
};

/** Static inputs for a batch/run (reproducible recipe). */
export interface RunConfig {
    tag: string;
    runs: number;
    xrpAmount: number;
    direction: NetworkDirection;
    networks: NetworkConfig;
    bridgeName: string;
}

/** Fees normalized (null if not computed). */
export interface RunCosts {
    sourceFee: number | null;
    targetFee: number | null;
    bridgeFee: number | null;
    totalBridgeCost: number | null;
    totalCost: number | null;
}

/** Phase timestamps (ms since epoch). Optional during execution. */
export interface RunTimestamps {
    t0_prepare?: number;
    t1_submit?: number;
    t2_observe?: number;
    t3_finalized?: number;
    t4_finalized_gas_refund?: number;
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
    runId: string,
    ts: RunTimestamps;
    txs: RunTxs;
    cache: {
        xrpl?: {
            client: import("xrpl").Client;
            wallet: import("xrpl").Wallet;
            depositAddress?: string;
        };
        evm?: {
            publicClient: import("viem").PublicClient;
            walletClient: import("viem").WalletClient;
            account: import("viem").Account;
            chain: import("viem").Chain;
            depositAddress?: string;
        };
        squid?: {
            route: any;
            requestId: string;
        };
    };
    cleaner: CleanupManager;
}

/** Immutable outcome used for analysis & sharing (append to JSONL/CSV). */
export interface RunRecord {
    runId: string;
    cfg: RunConfig;
    timestamps: RunTimestamps;
    txs: RunTxs;
    costs: RunCosts;
    success: boolean;
    abort_reason?: string;
}
