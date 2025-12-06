import { CleanupManager } from "./utils/cleanup";

/** Direction of a transfer in the bridge tests. */
export type NetworkDirection = "xrpl_to_base" | "base_to_xrpl" | "xrpl_to_xrpl_evm" | "xrpl_evm_to_xrpl" | "xrpl_to_flare" | "flare_to_xrpl";

/** Output from the source chain after submitting a transfer. */
export interface SourceOutput {
    xrpAmount: number; // Amount in the native currency (XRP for axelar, USD for near-intents)
    txHash: string;
    submittedAt: number;
    txFee: number;
    currency?: 'XRP' | 'USD' | 'ETH' | 'FLR' | 'USDC' | 'FXRP'; // Currency type for proper display
    // USD values (computed at transaction time)
    amountUsd?: number; // USD value of xrpAmount
    txFeeUsd?: number;  // USD value of txFee
}

/** Output from the target chain after a transfer is finalized. */
export interface TargetOutput {
    xrpAmount: number; // Amount in the native currency (XRP for axelar, USD for near-intents)
    txHash: string;
    finalizedAt: number;
    txFee: number;
    currency?: 'XRP' | 'USD' | 'ETH' | 'FLR' | 'USDC' | 'FXRP'; // Currency type for proper display
    // USD values (computed at transaction time)
    amountUsd?: number; // USD value of xrpAmount
    txFeeUsd?: number;  // USD value of txFee
}

/** Output when a gas refund is received. */
export interface GasRefundOutput {
    xrpAmount: number;
    txHash: string;
    currency?: 'XRP' | 'USD' | 'ETH' | 'FLR' | 'USDC' | 'FXRP';
    amountUsd?: number; // USD value of xrpAmount
}

/** Result of balance check before submitting transaction */
export interface BalanceCheckResult {
    sufficient: boolean;
    currentBalance: number;
    requiredBalance: number;
    currency: string;
    message?: string;
}

/** Adapter interface to abstract over XRPL and EVM chains in runs. */
export interface ChainAdapter {
    /**
     * Prepare client/wallet for this chain.
     * Should store initialized handles into ctx.cache.
     */
    prepare(ctx: RunContext): Promise<void>;

    /**
     * Check if the wallet has sufficient balance for the transaction
     * Including a small margin for gas fees (typically 10-20% extra)
     * Returns BalanceCheckResult with details about the balance check
     */
    checkBalance(ctx: RunContext): Promise<BalanceCheckResult>;

    /** Submit the *source* transfer; args are chain-specific */
    submit(ctx: RunContext): Promise<SourceOutput>;

    /** Listen for the reception of a payment on the **destination** blockchain */
    observe(ctx: RunContext): Promise<TargetOutput>;

    /** Listen for the reception of a payment on the **destination** blockchain */
    observeGasRefund(ctx: RunContext): Promise<GasRefundOutput>;
}

/** Per-network endpoints & gateways (no run-specific fields here). */
export type NetworkConfig = {
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

/** Fees normalized (null if not computed). All values stored in both native currency and USD. */
export interface RunCosts {
    // Native currency values
    sourceFee: number | null;
    targetFee: number | null;
    bridgeFee: number | null;
    totalBridgeCost: number | null;
    totalCost: number | null;

    // USD values (computed at transaction time for accuracy)
    sourceFeeUsd: number | null;
    targetFeeUsd: number | null;
    bridgeFeeUsd: number | null;
    totalBridgeCostUsd: number | null;
    totalCostUsd: number | null;
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
    error_type?: string; // TIMEOUT, NOT_FUNDED_ADDRESS, etc. Empty if not detected
}
