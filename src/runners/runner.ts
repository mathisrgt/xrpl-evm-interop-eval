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
     * Note: Must be sequential for Squid integration since each adapter
     * needs the other's wallet address for the route
     */
    async prepare(ctx: RunContext): Promise<void> {
        // For XRPL -> EVM: prepare EVM first to get account, then XRPL with Squid route
        // For EVM -> XRPL: prepare XRPL first to get wallet, then EVM with Squid route
        if (this.direction === "xrpl_to_xrpl_evm") {
            // Prepare EVM first (no Squid call yet, just wallet setup)
            await this.prepareEvmOnly(ctx);
            // Then prepare XRPL with Squid route (needs EVM account)
            await this.sourceAdapter.prepare(ctx);
        } else if (this.direction === "xrpl_evm_to_xrpl") {
            // Prepare XRPL first (no Squid call yet, just wallet setup)
            await this.prepareXrplOnly(ctx);
            // Then prepare EVM with Squid route (needs XRPL wallet)
            await this.sourceAdapter.prepare(ctx);
        } else {
            // For other directions, prepare in parallel
            await Promise.all([
                this.sourceAdapter.prepare(ctx),
                this.targetAdapter.prepare(ctx)
            ]);
        }
    }

    /**
     * Prepare EVM adapter without Squid route (just wallet setup)
     */
    private async prepareEvmOnly(ctx: RunContext): Promise<void> {
        const { createPublicClient, createWalletClient, http } = await import("viem");
        const { xrplevm } = await import("../utils/chains");
        const { getEvmAccount } = await import("../utils/environment");

        const rpcUrl = ctx.cfg.networks.evm.rpcUrl;
        const chain = xrplevm; // Only mainnet is supported

        const publicClient = createPublicClient({
            chain: chain,
            transport: http(rpcUrl)
        });

        const walletClient = createWalletClient({
            chain: chain,
            transport: http(rpcUrl)
        });

        const account = getEvmAccount();

        ctx.cache.evm = { publicClient, walletClient, account, chain };
    }

    /**
     * Prepare XRPL adapter without Squid route (just wallet setup)
     */
    private async prepareXrplOnly(ctx: RunContext): Promise<void> {
        const { Client } = await import("xrpl");
        const { getXrplWallet } = await import("../utils/environment");

        const client = new Client(ctx.cfg.networks.xrpl.wsUrl);
        await client.connect();

        const wallet = getXrplWallet();
        ctx.cache.xrpl = { client, wallet };
        ctx.cleaner.trackXrpl(client, wallet.address);
    }

    /**
     * Check if source wallet has sufficient balance for the transaction
     */
    async checkBalance(ctx: RunContext) {
        return await this.sourceAdapter.checkBalance(ctx);
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
        } else if (this.direction === "xrpl_to_flare") {
            return { source: "XRPL", target: "Flare" };
        } else if (this.direction === "flare_to_xrpl") {
            return { source: "Flare", target: "XRPL" };
        } else {
            // Fallback for any other direction
            return { source: "Unknown", target: "Unknown" };
        }
    }
}