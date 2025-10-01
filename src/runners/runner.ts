import { ChainAdapter, NetworkDirection, RunContext, SourceOutput, TargetOutput, GasRefundOutput } from "../types";
import { xrplAdapter } from "../adapters/xrpl.adapter";
import { evmAdapter } from "../adapters/evm.adapter";

/**
 * Runner that abstracts the direction-specific logic
 * and provides a unified interface for bridge operations
 */
export class Runner {
    private sourceAdapter: ChainAdapter;
    private targetAdapter: ChainAdapter;
    private direction: NetworkDirection;

    constructor(direction: NetworkDirection) {
        this.direction = direction;

        if (direction === "xrpl_to_evm") {
            this.sourceAdapter = xrplAdapter;
            this.targetAdapter = evmAdapter;
        } else {
            this.sourceAdapter = evmAdapter;
            this.targetAdapter = xrplAdapter;
        }
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
        if (this.direction === "xrpl_to_evm") {
            return { source: "XRPL", target: "EVM" };
        } else {
            return { source: "EVM", target: "XRPL" };
        }
    }
}