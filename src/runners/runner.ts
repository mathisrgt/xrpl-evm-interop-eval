import { ChainAdapter, NetworkDirection, RunContext, SourceOutput, TargetOutput, GasRefundOutput } from "../types";

/**
 * Runner that abstracts the direction-specific logic
 * and provides a unified interface for bridge operations
 */
export class Runner {
    private sourceAdapter: ChainAdapter;
    private targetAdapter: ChainAdapter;
    private direction: NetworkDirection;

    constructor(direction: NetworkDirection, sourceAdapter: ChainAdapter, targetAdapter: ChainAdapter) {
        this.direction = direction;
        this.sourceAdapter = sourceAdapter;
        this.targetAdapter = targetAdapter;
    }

    /**
     * Prepare both source and target adapters
     */
    async prepare(ctx: RunContext): Promise<void> {
        await Promise.all([
            this.sourceAdapter.prepare(ctx),
            this.targetAdapter.prepare(ctx)
        ]);
    }

    /**
     * Submit transaction on the source chain
     */
    async submit(ctx: RunContext): Promise<SourceOutput> {
        return await this.sourceAdapter.submit(ctx);
    }

    /**
     * Observe the target chain for the bridged transaction
     */
    async observe(ctx: RunContext): Promise<TargetOutput> {
        return await this.targetAdapter.observe(ctx);
    }

    /**
     * Observe gas refund transaction if supported by the target adapter
     * Returns undefined if gas refund is not supported for this direction
     */
    async observeGasRefund(ctx: RunContext): Promise<GasRefundOutput> {
        return await this.sourceAdapter.observeGasRefund(ctx);
    }

    /**
     * Get human-readable names for source and target chains
     */
    getChainNames(): { source: string; target: string } {
        if (this.direction === "xrpl_to_xrpl_evm") {
            return { source: "XRPL", target: "XRPL-EVM" };
        } else if (this.direction === "xrpl_evm_to_xrpl") {
            return { source: "XRPL-EVM", target: "XRPL" };
        } else if (this.direction === "xrpl_to_base") {
            return { source: "XRPL", target: "Base" };
        } else if (this.direction === "base_to_xrpl") {
            return { source: "Base", target: "XRPL" };
        } else {
            // Fallback for any other direction
            return { source: "Unknown", target: "Unknown" };
        }
    }
}