import chalk from "chalk";
import { RunConfig, SourceOutput, TargetOutput, NetworkDirection, RunContext, RunRecord } from "../types";
import { formatElapsedMs } from "./time";
import readline from "readline";
import { loadConfig } from "../runners/config";
import { MetricsSummary } from "./metrics";
import { getDirectionFolders, recomputeDirectionMetrics, recomputeAllMetricsCsv } from "./fsio";
import { getXrplWallet, getEvmAccount } from "./environment";
import { Client } from "xrpl";
import { createPublicClient, formatEther, http } from "viem";
import { mainnet } from "viem/chains";

/**
 * Get explorer URL for a transaction hash or address
 */
function getExplorerUrl(value: string, type: 'tx' | 'address', chain: 'xrpl' | 'evm' | 'near-intents' | 'axelar', direction?: NetworkDirection, depositAddress?: string): string {
    // Determine which chain/bridge is being used
    if (chain === 'near-intents') {
        // Near Intents uses deposit addresses instead of transaction hashes
        if (type === 'tx' && depositAddress) {
            return `https://explorer.near-intents.org/transactions/${depositAddress}`;
        } else if (type === 'address') {
            return `https://explorer.near-intents.org/transactions/${value}`;
        }
        // Fallback to value if no deposit address provided
        return `https://explorer.near-intents.org/transactions/${value}`;
    } else if (chain === 'axelar') {
        // Axelar uses axelarscan for GMP transactions
        if (type === 'tx') {
            return `https://axelarscan.io/gmp/${value}`;
        }
        return `https://axelarscan.io/gmp/${value}`;
    } else if (chain === 'xrpl' || (direction && (direction.includes('xrpl') && !direction.includes('flare')))) {
        // XRPL mainnet explorer
        if (type === 'tx') {
            return `https://livenet.xrpl.org/transactions/${value}`;
        } else {
            return `https://livenet.xrpl.org/accounts/${value}`;
        }
    } else if (direction && direction.includes('flare')) {
        // Flare explorer
        if (type === 'tx') {
            return `https://flare-explorer.flare.network/tx/${value}`;
        } else {
            return `https://flare-explorer.flare.network/address/${value}`;
        }
    } else {
        // Default EVM explorer (for XRPL EVM sidechain)
        if (type === 'tx') {
            return `https://explorer.xrplevm.org/tx/${value}`;
        } else {
            return `https://explorer.xrplevm.org/address/${value}`;
        }
    }
}

/**
 * Format a clickable explorer link
 */
function formatExplorerLink(value: string, type: 'tx' | 'address', chain: 'xrpl' | 'evm' | 'near-intents' | 'axelar', direction?: NetworkDirection, depositAddress?: string): string {
    const url = getExplorerUrl(value, type, chain, direction, depositAddress);
    return `${chalk.cyan(value)}\n   ${chalk.dim('Explorer:')} ${chalk.blue.underline(url)}`;
}

function formatAddress(address: string, chain: 'xrpl' | 'evm', showPrefix: boolean = false): string {
    if (chain === 'xrpl') {
        return chalk.cyan(address);
    }

    const truncated = `${address.slice(0, 6)}...${address.slice(-4)}`;

    const formatted = showPrefix ? `0x${truncated}` : truncated;
    return chalk.cyan(formatted);
}

function formatAmount(amount: number | string, unit: string = 'XRP'): string {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    const formatted = numAmount.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6
    });
    return `${chalk.yellow(formatted)} ${chalk.dim(unit)}`;
}

function getSourceChain(direction: NetworkDirection): 'xrpl' | 'evm' {
    if (direction === 'xrpl_to_xrpl_evm' || direction === 'xrpl_to_base' || direction === 'xrpl_to_flare') {
        return 'xrpl';
    } else {
        // xrpl_evm_to_xrpl, base_to_xrpl, or flare_to_xrpl
        return 'evm';
    }
}

function getTargetChain(direction: NetworkDirection): 'xrpl' | 'evm' {
    if (direction === 'xrpl_to_xrpl_evm' || direction === 'xrpl_to_base' || direction === 'xrpl_to_flare') {
        return 'evm';
    } else {
        // xrpl_evm_to_xrpl, base_to_xrpl, or flare_to_xrpl
        return 'xrpl';
    }
}

export function logStep(step: string): void {
    const separator = chalk.gray('─'.repeat(60));
    console.log(`\n${separator}`);
    console.log(chalk.bold(`📋 ${step.toUpperCase()}`));
    console.log(separator);
}

export function logConfig(cfg: RunConfig): void {
    const rows = [
        ['Tag', cfg.tag],
        ['Direction', chalk.cyan(cfg.direction)],
        ['Amount', formatAmount(cfg.xrpAmount, 'XRP')],
        ['Runs', chalk.white(cfg.runs.toString())],
        ['XRPL Gateway', formatAddress(cfg.networks.xrpl.gateway, 'xrpl')],
        ['EVM Gateway', formatAddress(cfg.networks.evm.gateway, 'evm', true)],
    ];

    const maxKeyLength = Math.max(...rows.map(([key]) => key.length));

    rows.forEach(([key, value]) => {
        const paddedKey = chalk.dim(key.padEnd(maxKeyLength));
        console.log(`  ${paddedKey} : ${value}`);
    });
}

export function logPrepare(ctx: RunContext): void {
    const xrplReady = !!(ctx.cache.xrpl?.client && ctx.cache.xrpl?.wallet);
    const xrplStatus = xrplReady ? chalk.green('✓') : chalk.red('✗');
    const xrplAddress = ctx.cache.xrpl?.wallet?.address || 'N/A';
    const xrplEndpoint = ctx.cfg.networks.xrpl.wsUrl;

    console.log(`${xrplStatus} ${chalk.bold('XRPL')}`);
    console.log(`Address: ${formatExplorerLink(xrplAddress, 'address', 'xrpl', ctx.cfg.direction)}`);
    console.log(`Endpoint: ${chalk.dim(xrplEndpoint)}\n`);

    const evmReady = !!(ctx.cache.evm?.publicClient && ctx.cache.evm?.walletClient && ctx.cache.evm?.account);
    const evmStatus = evmReady ? chalk.green('✓') : chalk.red('✗');
    const evmAddress = ctx.cache.evm?.account?.address || 'N/A';
    const evmEndpoint = ctx.cfg.networks.evm.rpcUrl;

    console.log(`${evmStatus} ${chalk.bold('EVM')}`);
    console.log(`Address: ${formatExplorerLink(evmAddress, 'address', 'evm', ctx.cfg.direction)}`);
    console.log(`Endpoint: ${chalk.dim(evmEndpoint)}\n`);

    console.log(`${chalk.dim('XRPL Gateway')}: ${formatExplorerLink(ctx.cfg.networks.xrpl.gateway, 'address', 'xrpl', ctx.cfg.direction)}`);
    console.log(`${chalk.dim('EVM Gateway')}: ${formatExplorerLink(ctx.cfg.networks.evm.gateway, 'address', 'evm', ctx.cfg.direction)}`);

    const allReady = xrplReady && evmReady;
    const overallStatus = allReady ? chalk.green('✅ All systems ready') : chalk.red('Some systems not ready\n');
    console.log(`${overallStatus}`);
}

export function logSubmit(ctx: RunContext, srcOutput: SourceOutput) {
    const sourceChain = getSourceChain(ctx.cfg.direction);
    const chainName = chalk.bold(sourceChain.toUpperCase());
    const amount = formatAmount(srcOutput.xrpAmount, srcOutput.currency || 'XRP');

    // Determine the bridge type from the config
    const bridgeType = ctx.cfg.bridgeName;
    let explorerChain: 'xrpl' | 'evm' | 'near-intents' | 'axelar' = sourceChain;
    if (bridgeType === 'near-intents') {
        explorerChain = 'near-intents';
    } else if (bridgeType === 'axelar') {
        explorerChain = 'axelar';
    }

    // Get deposit address for near-intents explorer
    const depositAddress = sourceChain === 'xrpl'
        ? ctx.cache.xrpl?.depositAddress
        : ctx.cache.evm?.depositAddress;

    // Display approval/reserveCollateral transaction if present (for ERC20 token bridges)
    if (srcOutput.approvalTxHash) {
        // For FAsset bridges: approval for Flare→XRPL, reserveCollateral for XRPL→Flare
        const isFasset = bridgeType === 'fasset';
        const isFlareToXrpl = ctx.cfg.direction === 'flare_to_xrpl';
        const txType = isFasset
            ? (isFlareToXrpl ? 'approval transaction' : 'reserveCollateral transaction')
            : 'approval transaction';
        const txChain = isFasset ? 'Flare' : chainName;

        console.log(`🔓 ${txChain} ${txType}`);
        // For FAsset, always use 'evm' chain to get Flare explorer link
        const approvalChain: 'xrpl' | 'evm' | 'near-intents' | 'axelar' = isFasset ? 'evm' : sourceChain;
        console.log(`Hash: ${formatExplorerLink(srcOutput.approvalTxHash, 'tx', approvalChain, ctx.cfg.direction)}`);
        if (srcOutput.approvalFee) {
            console.log(`Fee: ${chalk.yellow(srcOutput.approvalFee.toFixed(6))} FLR`);
        }
        console.log('');
    }

    console.log(`📤 ${chainName} transaction submitted`);
    console.log(`Amount: ${amount}`);
    console.log(`Hash: ${formatExplorerLink(srcOutput.txHash, 'tx', explorerChain, ctx.cfg.direction, depositAddress)}`);
}

export function logObserve(ctx: RunContext, output: TargetOutput): void {
    const targetChain = getTargetChain(ctx.cfg.direction);
    const chainName = chalk.bold(targetChain.toUpperCase());
    const amount = formatAmount(output.xrpAmount, output.currency || 'XRP');

    // Determine the bridge type from the config
    const bridgeType = ctx.cfg.bridgeName;
    let explorerChain: 'xrpl' | 'evm' | 'near-intents' | 'axelar' = targetChain;
    if (bridgeType === 'near-intents') {
        explorerChain = 'near-intents';
    } else if (bridgeType === 'axelar') {
        explorerChain = 'axelar';
    }

    // Get deposit address for near-intents explorer
    const depositAddress = targetChain === 'xrpl'
        ? ctx.cache.xrpl?.depositAddress
        : ctx.cache.evm?.depositAddress;

    // Display approval/reserveCollateral transaction if present (for ERC20 token bridges)
    if (output.approvalTxHash) {
        // For FAsset bridges: approval for Flare→XRPL, reserveCollateral for XRPL→Flare
        const isFasset = bridgeType === 'fasset';
        const isXrplToFlare = ctx.cfg.direction === 'xrpl_to_flare';
        const txType = isFasset
            ? (isXrplToFlare ? 'reserveCollateral transaction' : 'approval transaction')
            : 'approval transaction';
        const txChain = isFasset ? 'Flare' : chainName;

        console.log(`\n🔓 ${txChain} ${txType}`);
        // For FAsset, always use 'evm' chain to get Flare explorer link
        const approvalChain: 'xrpl' | 'evm' | 'near-intents' | 'axelar' = isFasset ? 'evm' : targetChain;
        console.log(`Hash: ${formatExplorerLink(output.approvalTxHash, 'tx', approvalChain, ctx.cfg.direction)}`);
        if (output.approvalFee) {
            console.log(`Fee: ${chalk.yellow(output.approvalFee.toFixed(6))} FLR`);
        }
        console.log('');
    }

    console.log(`\n✅ ${chainName} transfer received`);
    console.log(`Amount: ${amount}`);
    console.log(`Hash: ${formatExplorerLink(output.txHash, 'tx', explorerChain, ctx.cfg.direction, depositAddress)}`);

    if (ctx.ts.t3_finalized && ctx.ts.t1_submit) {
        const elapsed = formatElapsedMs(ctx.ts.t3_finalized - ctx.ts.t1_submit, { pad: true });
        console.log(`Time: ${chalk.green(elapsed)}`);
    }
}

export function logRecord(record: RunRecord): void {
    console.log(`${chalk.bold('Run ID')}: ${chalk.cyan(record.runId)}`);
    console.log(`${chalk.bold('Success')}: ${record.success ? chalk.green('✓ YES') : chalk.red('✗ NO')}`);

    if (record.abort_reason) {
        console.log(`${chalk.bold('Abort Reason')}: ${chalk.red(record.abort_reason)}`);
    }

    console.log('');

    function formatTimeOnly(timestamp: number): string {
        return new Date(timestamp).toTimeString().split(' ')[0];
    }

    // Timing information
    const timestamps = record.timestamps;
    if (timestamps.t0_prepare) {
        console.log(`${chalk.bold('Prepared')}: ${formatTimeOnly(timestamps.t0_prepare)}`);
    }
    if (timestamps.t1_submit) {
        console.log(`${chalk.bold('Submitted')}: ${formatTimeOnly(timestamps.t1_submit)}`);
    }
    if (timestamps.t2_observe) {
        console.log(`${chalk.bold('Observed')}: ${formatTimeOnly(timestamps.t2_observe)}`);
    }
    if (timestamps.t3_finalized) {
        console.log(`${chalk.bold('Finalized')}: ${formatTimeOnly(timestamps.t3_finalized)}`);
    }

    // Calculate and display total latency if possible
    if (timestamps.t1_submit && timestamps.t3_finalized) {
        const totalLatency = timestamps.t3_finalized - timestamps.t1_submit;
        const formattedLatency = formatElapsedMs(totalLatency, { pad: true });
        console.log(`${chalk.bold('Total latency')}: ${chalk.green(formattedLatency)}`);
    }

    console.log('');

    // Transaction hashes
    const txs = record.txs;
    const sourceChain = getSourceChain(record.cfg.direction);
    const targetChain = getTargetChain(record.cfg.direction);
    const bridgeType = record.cfg.bridgeName;

    let explorerChain: 'xrpl' | 'evm' | 'near-intents' | 'axelar' = sourceChain;
    if (bridgeType === 'near-intents') {
        explorerChain = 'near-intents';
    } else if (bridgeType === 'axelar') {
        explorerChain = 'axelar';
    }

    if (txs.sourceTxHash && txs.sourceTxHash !== 'N/A') {
        console.log(`${chalk.bold('Source Tx')}:`);
        console.log(`   ${formatExplorerLink(txs.sourceTxHash, 'tx', explorerChain, record.cfg.direction, txs.depositAddress)}`);
    }
    if (txs.targetTxHash && txs.targetTxHash !== 'N/A') {
        console.log(`${chalk.bold('Target Tx')}:`);
        console.log(`   ${formatExplorerLink(txs.targetTxHash, 'tx', targetChain, record.cfg.direction, txs.depositAddress)}`);
    }
    if (txs.bridgeMessageId) {
        console.log(`${chalk.bold('Bridge Message ID')}: ${chalk.cyan(txs.bridgeMessageId)}`);
    }

    console.log('');

    // Cost information
    const costs = record.costs;
    if (costs.sourceFee) {
        console.log(`${chalk.bold('Source fee')}: ${chalk.yellow(costs.sourceFee.toFixed(7))} XRP`);
    }
    if (costs.targetFee) {
        console.log(`${chalk.bold('Target fee')}: ${chalk.yellow(costs.targetFee.toFixed(7))} XRP`);
    }
    if (costs.bridgeFee) {
        console.log(`${chalk.bold('Bridge fee')}: ${chalk.yellow(costs.bridgeFee.toFixed(7))} XRP`);
    }
    if (costs.totalBridgeCost) {
        console.log(`${chalk.bold('Bridge cost')}: ${chalk.yellow(costs.totalBridgeCost.toFixed(7))} XRP`);
    }
    if (costs.totalCost) {
        console.log(`${chalk.bold('Total cost')}: ${chalk.yellow(costs.totalCost.toFixed(4))} XRP`);
    }
}

export function logError(message: string, context?: string, error?: Error): void {
    const contextStr = context ? chalk.red(`[${context}]`) : '';
    console.error(`${chalk.red('❌')} ${contextStr} ${message}`);

    if (error?.stack) {
        console.error(chalk.dim(error.stack));
    }
}

/**
 * Prompt user for input with validation
 */
function askQuestion(rl: readline.Interface, question: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

/**
 * Display welcome banner
 */
function displayBanner(): void {
    const banner = `
╔══════════════════════════════════════════════════════════════════════════════╗
║                       ${chalk.bold.cyan('XRPL ↔ EVM Bridge Performance Tool')}                     ║
║                                                                              ║
║               ${chalk.yellow('Configure your cross-chain bridge test parameters')}              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`;
    console.log(chalk.white(banner));
}


/**
 * Display bridge type selection menu
 */
async function selectBridgeType(rl: readline.Interface): Promise<string> {
    console.log(chalk.bold('\n🌉 Select Bridge Type:'));
    console.log(` 1) ${chalk.bold('Axelar')} ${chalk.dim('(Cross-chain communication protocol)')}`);
    console.log(` 2) ${chalk.bold('Near Intents')} ${chalk.dim('(Intent-based bridge)')}`);
    console.log(` 3) ${chalk.bold('FAsset')} ${chalk.dim('(Flare Asset bridge)')}`);

    while (true) {
        const answer = await askQuestion(rl, '\nEnter your choice: ');

        switch (answer) {
            case '1':
                console.log(chalk.green('✓ Selected: Axelar'));
                return 'axelar';
            case '2':
                console.log(chalk.green('✓ Selected: Near Intents'));
                return 'near-intents';
            case '3':
                console.log(chalk.green('✓ Selected: FAsset'));
                return 'fasset';
            default:
                console.log(chalk.red('❌ Invalid choice. Please enter 1, 2, or 3.'));
        }
    }
}

/**
 * Display bridge direction selection menu
 */
async function selectBridgeDirection(rl: readline.Interface, bridgeType: string): Promise<NetworkDirection> {
    console.log(chalk.bold('\n🔄 Select Bridge Direction:'));

    if (bridgeType === 'axelar') {
        console.log(` 1) ${chalk.bold('XRPL → XRPL-EVM')} ${chalk.dim('(XRPL to XRPL EVM Sidechain)')}`);
        console.log(` 2) ${chalk.bold('XRPL-EVM → XRPL')} ${chalk.dim('(XRPL EVM Sidechain to XRPL)')}`);
    } else if (bridgeType === 'near-intents') {
        console.log(` 1) ${chalk.bold('XRPL → Base')} ${chalk.dim('(XRPL to Base L2)')}`);
        console.log(` 2) ${chalk.bold('Base → XRPL')} ${chalk.dim('(Base L2 to XRPL)')}`);
    } else if (bridgeType === 'fasset') {
        console.log(` 1) ${chalk.bold('XRPL → Flare')} ${chalk.dim('(XRPL to Flare - Manual bridge)')}`);
        console.log(` 2) ${chalk.bold('Flare → XRPL')} ${chalk.dim('(Flare to XRPL - Manual bridge)')}`);
    } else {
        console.log(` 1) ${chalk.bold('XRPL → EVM')} ${chalk.dim('(XRPL to EVM chain)')}`);
        console.log(` 2) ${chalk.bold('EVM → XRPL')} ${chalk.dim('(EVM chain to XRPL)')}`);
    }

    while (true) {
        const answer = await askQuestion(rl, '\nEnter your choice: ');

        switch (answer) {
            case '1':
                if (bridgeType === 'axelar') {
                    console.log(chalk.cyan('✓ Selected: XRPL → XRPL-EVM'));
                    return 'xrpl_to_xrpl_evm';
                } else if (bridgeType === 'near-intents') {
                    console.log(chalk.cyan('✓ Selected: XRPL → Base'));
                    return 'xrpl_to_base';
                } else if (bridgeType === 'fasset') {
                    console.log(chalk.cyan('✓ Selected: XRPL → Flare'));
                    return 'xrpl_to_flare';
                } else {
                    console.log(chalk.cyan('✓ Selected: XRPL → EVM'));
                    return 'xrpl_to_evm' as NetworkDirection;
                }
            case '2':
                if (bridgeType === 'axelar') {
                    console.log(chalk.cyan('✓ Selected: XRPL-EVM → XRPL'));
                    return 'xrpl_evm_to_xrpl';
                } else if (bridgeType === 'near-intents') {
                    console.log(chalk.cyan('✓ Selected: Base → XRPL'));
                    return 'base_to_xrpl';
                } else if (bridgeType === 'fasset') {
                    console.log(chalk.cyan('✓ Selected: Flare → XRPL'));
                    return 'flare_to_xrpl';
                } else {
                    console.log(chalk.cyan('✓ Selected: EVM → XRPL'));
                    return 'evm_to_xrpl' as NetworkDirection;
                }
            default:
                console.log(chalk.red('❌ Invalid choice. Please enter 1 or 2.'));
        }
    }
}

/**
 * Get XRP amount with validation
 */
async function selectXrpAmount(rl: readline.Interface): Promise<number> {
    console.log(chalk.bold(`🚨 Up to 2 XRP (AVG. 0.2 XRP) could be used for gas fees.`));
    console.log(chalk.bold('\n💰 Enter an XRP amount (min 2 XRP) for each transaction:'));

    while (true) {
        const answer = await askQuestion(rl, '\nEnter an amount of XRP: ');

        const customAmount = parseFloat(answer);
        if (!isNaN(customAmount) && customAmount >= 2) {
            if (customAmount >= 10) {
                const confirm = await askQuestion(rl,
                    chalk.yellow(`⚠️  You entered ${customAmount} XRP for each transaction. This uses real mainnet funds. Continue? (y/N): `)
                );
                if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
                    continue;
                }
            }
            console.log(chalk.green(`✓ Selected: ${customAmount} XRP per transaction`));
            return customAmount;
        }

        console.log(chalk.red('❌ Invalid amount. Please enter a number greater 2 XRP.'));
    }
}

/**
 * Get number of test runs with validation
 */
async function selectNumberOfRuns(rl: readline.Interface): Promise<number> {
    console.log(chalk.bold('\n🔢 Enter a number of runs:'));

    while (true) {
        const answer = await askQuestion(rl, '\nEnter number of runs: ');
        const runs = parseInt(answer);

        if (!isNaN(runs) && runs >= 1) {
            if (runs > 20) {
                const confirm = await askQuestion(rl,
                    chalk.yellow(`⚠️  ${runs} runs may take a long time. Continue? (y/N): `)
                );
                if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
                    continue;
                }
            }
            console.log(chalk.green(`✓ Selected: ${runs} run${runs > 1 ? 's' : ''}`));
            return runs;
        }

        console.log(chalk.red('❌ Invalid number. Please enter a number higher than 1.'));
    }
}

/**
 * Display configuration summary for confirmation
 */
async function confirmConfiguration(rl: readline.Interface, config: RunConfig): Promise<boolean> {
    const { direction, xrpAmount, runs } = config;

    console.log(chalk.bold('\n📋 Configuration Summary:'));
    console.log('┌─────────────────────────────────────────────┐');
    console.log(`│ ${chalk.bold('Direction:')} ${chalk.cyan(direction.replace(/_/g, ' ').replace(/to/gi, '→').toUpperCase().padEnd(33))}│`);
    console.log(`│ ${chalk.bold('XRP Amount:')} ${chalk.yellow(xrpAmount.toString().padEnd(32))}│`);
    console.log(`│ ${chalk.bold('Test Runs:')} ${chalk.white(runs.toString().padEnd(33))}│`);
    console.log('└─────────────────────────────────────────────┘');

    const answer = await askQuestion(rl, '\nProceed with this configuration? (Y/n): ');
    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes' || answer === '';
}


export async function showMenu(): Promise<{ config: RunConfig; bridgeType: string }> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        displayBanner();

        // Collect all configuration parameters
        const bridgeType = await selectBridgeType(rl);
        const networkDirection = await selectBridgeDirection(rl, bridgeType);

        // FAsset bridge has fixed amount and runs
        let xrpAmount: number;
        let nbRuns: number;

        if (bridgeType === 'fasset') {
            xrpAmount = 10;
            nbRuns = 1;
            console.log(chalk.cyan('\n💰 FAsset bridge uses fixed configuration:'));
            console.log(chalk.dim('   Amount: 10 XRP/FXRP per transaction'));
            console.log(chalk.dim('   Runs: 1 (manual bridge operation)'));
        } else {
            xrpAmount = await selectXrpAmount(rl);
            nbRuns = await selectNumberOfRuns(rl);
        }

        const config = loadConfig(networkDirection, xrpAmount, nbRuns, bridgeType);

        // Show summary and get confirmation
        const confirmed = await confirmConfiguration(rl, config);

        if (!confirmed) {
            console.log(chalk.yellow('\n👋 Configuration cancelled. Goodbye!'));
            process.exit(0);
        }

        console.log(chalk.green('\n✅ Starting bridge test with your configuration...\n'));

        return { config, bridgeType };

    } finally {
        rl.close();
    }
}

/**
 * Display wallet addresses and balances
 */
async function displayWalletInfo(): Promise<void> {
    console.log(chalk.bold('💼 Wallet Information'));
    console.log(chalk.dim('─'.repeat(78)));

    try {
        // Get wallet instances
        const xrplWallet = getXrplWallet();
        const evmAccount = getEvmAccount();

        // Fetch XRPL balance
        let xrplBalance = 'Loading...';
        try {
            const client = new Client('wss://xrplcluster.com/');
            await client.connect();
            const balance = await client.getXrpBalance(xrplWallet.address);
            xrplBalance = `${Number(balance).toFixed(4)} XRP`;
            await client.disconnect();
        } catch (err) {
            xrplBalance = chalk.red('Error');
        }

        // Fetch XRPL EVM sidechain balance
        let xrplevmBalance = 'Loading...';
        try {
            const { xrplevm } = await import('../utils/chains');
            const publicClient = createPublicClient({
                chain: xrplevm,
                transport: http('https://rpc.xrplevm.org')
            });
            const balance = await publicClient.getBalance({ address: evmAccount.address as `0x${string}` });
            xrplevmBalance = `${parseFloat(formatEther(balance)).toFixed(4)} XRP`;
        } catch (err) {
            xrplevmBalance = chalk.red('Error');
        }

        // Fetch Flare FLR and FXRP balances
        let flrBalance = 'Loading...';
        let fxrpBalance = 'Loading...';
        try {
            const { flare } = await import('viem/chains');
            const publicClient = createPublicClient({
                chain: flare,
                transport: http('https://flare-api.flare.network/ext/C/rpc')
            });

            // Get FLR balance
            const flrBal = await publicClient.getBalance({ address: evmAccount.address as `0x${string}` });
            flrBalance = `${parseFloat(formatEther(flrBal)).toFixed(4)} FLR`;

            // Get FXRP token balance
            const FXRP_TOKEN_ADDRESS = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE' as const;
            const erc20Abi = [
                { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: 'balance', type: 'uint256' }] },
                { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] }
            ] as const;

            // Get FXRP decimals
            let fxrpDecimals = 18;
            try {
                const decimalsResult = await publicClient.readContract({
                    address: FXRP_TOKEN_ADDRESS,
                    abi: erc20Abi,
                    functionName: 'decimals',
                });
                fxrpDecimals = Number(decimalsResult);
            } catch (err) {
                // If decimals fails, assume 18 (standard)
                fxrpDecimals = 18;
            }

            // Get FXRP balance
            const fxrpBal = await publicClient.readContract({
                address: FXRP_TOKEN_ADDRESS,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [evmAccount.address as `0x${string}`]
            });

            // Convert using correct decimals
            const fxrpBalanceNumber = Number(fxrpBal as bigint) / Math.pow(10, fxrpDecimals);
            fxrpBalance = `${fxrpBalanceNumber.toFixed(4)} FXRP`;
        } catch (err) {
            flrBalance = chalk.red('Error');
            fxrpBalance = chalk.red('Error');
        }

        // Fetch Base ETH and USDC balances
        let baseEthBalance = 'Loading...';
        let baseUsdcBalance = 'Loading...';
        try {
            const { base } = await import('../utils/chains');
            const publicClient = createPublicClient({
                chain: base,
                transport: http('https://mainnet.base.org')
            });

            // Get ETH balance
            const ethBal = await publicClient.getBalance({ address: evmAccount.address as `0x${string}` });
            baseEthBalance = `${parseFloat(formatEther(ethBal)).toFixed(4)} ETH`;

            // Get USDC token balance
            const USDC_BASE_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
            const usdcBal = await publicClient.readContract({
                address: USDC_BASE_ADDRESS,
                abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: 'balance', type: 'uint256' }] }],
                functionName: 'balanceOf',
                args: [evmAccount.address as `0x${string}`]
            });
            // USDC has 6 decimals
            baseUsdcBalance = `${(Number(usdcBal) / 1e6).toFixed(2)} USDC`;
        } catch (err) {
            baseEthBalance = chalk.red('Error');
            baseUsdcBalance = chalk.red('Error');
        }

        // Display addresses
        console.log(`  ${chalk.bold('XRPL Address:')} ${chalk.cyan(xrplWallet.address)}`);
        console.log(`  ${chalk.bold('EVM Address:')}  ${chalk.cyan(evmAccount.address)}`);
        console.log('');

        // Display balances in the requested format
        console.log(chalk.bold('  Balances:'));
        console.log(`    ${chalk.bold('XRPL:')}     ${chalk.yellow(xrplBalance)}`);
        console.log(`    ${chalk.bold('XRPL EVM:')} ${chalk.yellow(xrplevmBalance)}`);
        console.log(`    ${chalk.bold('Flare:')}    ${chalk.yellow(flrBalance)} ${chalk.dim('|')} ${chalk.yellow(fxrpBalance)}`);
        console.log(`    ${chalk.bold('Base:')}     ${chalk.yellow(baseEthBalance)} ${chalk.dim('|')} ${chalk.yellow(baseUsdcBalance)}`);

    } catch (err) {
        console.log(chalk.red('  Error loading wallet information'));
        console.log(chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }

    console.log(chalk.dim('─'.repeat(78)));
}

/**
 * Display wallet addresses and balances
 * Returns true (always proceeds)
 */
export async function displayWalletInfoAndConfirm(): Promise<boolean> {
    await displayWalletInfo();
    return true;
}

/**
 * Show main menu: Select action (run tests or manage metrics)
 */
export async function showMainMenu(): Promise<{ action: 'bridge' | 'metrics' }> {
    console.log(chalk.bold.cyan('\n╔══════════════════════════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.cyan('║             XRPL ↔ EVM Bridge Performance & Metrics Tool                     ║'));
    console.log(chalk.bold.cyan('╚══════════════════════════════════════════════════════════════════════════════╝\n'));

    // Display wallet addresses and balances, get user confirmation
    const confirmed = await displayWalletInfoAndConfirm();
    if (!confirmed) {
        process.exit(0);
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        console.log(chalk.bold('📋 Menu'));
        console.log(` 1) ${chalk.bold('Run tests')} ${chalk.dim('(Execute cross-chain bridge transactions)')}`);
        console.log(` 2) ${chalk.bold('Compute metrics')} ${chalk.dim('(Regenerate aggregated metrics)')}`);

        while (true) {
            const answer = await askQuestion(rl, '\nEnter your choice: ');

            switch (answer) {
                case '1':
                    return { action: 'bridge' };
                case '2':
                    await showMetricsMenu(rl);
                    return { action: 'metrics' };
                default:
                    console.log(chalk.red('❌ Invalid choice. Please enter 1 or 2.'));
            }
        }
    } finally {
        rl.close();
    }
}


/**
 * Show metrics computation submenu
 */
async function showMetricsMenu(rl: readline.Interface): Promise<void> {
    console.log(chalk.bold.cyan('\n╔══════════════════════════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.cyan('║                          Metrics Computation                                 ║'));
    console.log(chalk.bold.cyan('╚══════════════════════════════════════════════════════════════════════════════╝\n'));

    console.log(chalk.bold('📊 Metrics Options:'));
    console.log(` 1) ${chalk.bold('Recompute folder metrics')} ${chalk.dim('(Regenerate metrics for one folder)')}`);
    console.log(` 2) ${chalk.bold('Recompute all metrics')} ${chalk.dim('(Rebuild all_metrics.csv)')}`);

    while (true) {
        const answer = await askQuestion(rl, '\nEnter your choice: ');

        switch (answer) {
            case '1':
                await recomputeSpecificFolderMetrics(rl);
                return;
            case '2':
                await recomputeAllMetrics();
                return;
            default:
                console.log(chalk.red('❌ Invalid choice. Please enter 1 or 2.'));
        }
    }
}

/**
 * Recompute metrics for a specific folder
 */
async function recomputeSpecificFolderMetrics(rl: readline.Interface): Promise<void> {
    const folders = getDirectionFolders();

    if (folders.length === 0) {
        console.log(chalk.yellow(`\n⚠️  No direction folders found.`));
        return;
    }

    console.log(chalk.bold(`\n📁 Available folders:`));
    folders.forEach((folder, index) => {
        console.log(` ${index + 1}) ${chalk.bold(folder.folder)} ${chalk.dim(`(${folder.bridgeName})`)}`);
    });

    while (true) {
        const answer = await askQuestion(rl, '\nSelect a folder (enter number): ');
        const choice = parseInt(answer, 10);

        if (choice >= 1 && choice <= folders.length) {
            const selected = folders[choice - 1];
            console.log(chalk.cyan(`\n🔄 Recomputing metrics for: ${selected.folder}`));

            const summary = recomputeDirectionMetrics(selected.bridgeName, selected.direction);

            if (summary) {
                console.log(chalk.green(`\n✅ Successfully recomputed metrics for ${selected.folder}`));
                console.log(chalk.dim(`   JSON: data/results/${selected.folder}/${selected.bridgeName}_${selected.direction}_aggregated_metrics.json`));
                console.log(chalk.dim(`   CSV:  data/results/${selected.folder}/${selected.bridgeName}_${selected.direction}_summary.csv`));

                // Display computed metrics
                console.log(chalk.bold('\n📊 Computed Metrics Summary:'));
                console.log(chalk.dim('─'.repeat(60)));
                console.log(`   Bridge:           ${chalk.cyan(summary.bridgeName)}`);
                console.log(`   Direction:        ${chalk.cyan(summary.direction)}`);
                console.log(`   Total Runs:       ${chalk.yellow(summary.totalRuns)}`);
                console.log(`   Success:          ${chalk.green(summary.successCount)} (${chalk.green((summary.successRate * 100).toFixed(1) + '%')})`);
                console.log(`   Failures:         ${chalk.red(summary.failureCount)}`);

                if (summary.latency.meanMs !== null) {
                    console.log(`\n   ${chalk.bold('Latency:')}`);
                    console.log(`   Mean:             ${chalk.yellow(summary.latency.meanMs.toFixed(2))} ms`);
                    console.log(`   P50:              ${chalk.yellow((summary.latency.p50Ms ?? 0).toFixed(2))} ms`);
                    console.log(`   P90:              ${chalk.yellow((summary.latency.p90Ms ?? 0).toFixed(2))} ms`);
                    console.log(`   P95:              ${chalk.yellow((summary.latency.p95Ms ?? 0).toFixed(2))} ms`);
                    console.log(`   Min/Max:          ${chalk.dim((summary.latency.minMs ?? 0).toFixed(2))} / ${chalk.dim((summary.latency.maxMs ?? 0).toFixed(2))} ms`);
                }

                if (summary.costs?.meanBridgeUsd !== null) {
                    console.log(`\n   ${chalk.bold('Costs (USD):')}`);
                    console.log(`   Mean Bridge Fee:  ${chalk.yellow('$' + (summary.costs.meanBridgeUsd).toFixed(4))}`);
                    console.log(`   Mean Source Fee:  ${chalk.dim('$' + (summary.costs.meanSourceFeeUsd ?? 0).toFixed(4))}`);
                    console.log(`   Mean Target Fee:  ${chalk.dim('$' + (summary.costs.meanTargetFeeUsd ?? 0).toFixed(4))}`);
                }

                console.log(chalk.dim('─'.repeat(60)));
            } else {
                console.log(chalk.red(`\n❌ Failed to recompute metrics for ${selected.folder}`));
            }
            return;
        } else {
            console.log(chalk.red(`❌ Invalid choice. Please enter a number between 1 and ${folders.length}.`));
        }
    }
}

/**
 * Recompute all_metrics.csv from all batch folders
 */
async function recomputeAllMetrics(): Promise<void> {
    console.log(chalk.cyan('\n🔄 Recomputing all_metrics.csv from all batch folders...'));
    console.log(chalk.dim('   Scanning all directions (excluding deprecated folders)...\n'));

    const result = recomputeAllMetricsCsv();

    if (result.count > 0) {
        console.log(chalk.green(`\n✅ Successfully rebuilt all_metrics.csv`));
        console.log(chalk.dim(`   File: data/results/all_metrics.csv`));

        console.log(chalk.bold('\n📊 Scan Results:'));
        console.log(chalk.dim('─'.repeat(60)));
        console.log(`   Direction folders:    ${chalk.yellow(result.stats.directions)}`);
        console.log(`   Batch folders:        ${chalk.yellow(result.stats.batches)}`);
        console.log(`   Metrics processed:    ${chalk.green(result.count)}`);
        console.log(chalk.dim('─'.repeat(60)));
    } else {
        console.log(chalk.yellow('\n⚠️  No batch metrics found to process.'));
    }
}

/** Render ms; if > 1000ms, add "(Xs)" hint */
function fxMs(ms?: number | null): string {
    if (ms == null || Number.isNaN(ms)) return "N/A";
    const base = ms.toFixed(2);
    return ms >= 1000 ? `${base}  (${(ms / 1000).toFixed(2)}s)` : base;
}

/**
 * Display comprehensive, friendly metrics using your current MetricsSummary type.
 * Neutral wording; chain-agnostic; no currency.
 */
export function displayMetrics(metrics: MetricsSummary): void {
    console.log(chalk.bold("\nConfiguration:"));
    console.log(`  Tag:              ${chalk.white(metrics.tag)}`);
    console.log(`  Bridge:           ${chalk.cyan(metrics.bridgeName)}`);
    console.log(`  Direction:        ${chalk.white(metrics.direction)}`);
    console.log(`  Transfer Amount:  ${chalk.white(String(metrics.transferAmount))}`);
    if (metrics.transferAmountUsd > 0) {
        console.log(`  Transfer USD:     ${chalk.white('$' + metrics.transferAmountUsd.toFixed(4))}`);
    }
    console.log(`  Runs requested:   ${chalk.white(String(metrics.runsPlanned))}`);

    console.log(`\n${chalk.bold('Execution:')}`);
    console.log(`  Total Runs:    ${chalk.white(metrics.totalRuns)}`);
    console.log(`  Successful:    ${chalk.green(metrics.successCount)}`);
    console.log(`  Failed:        ${chalk.red(metrics.failureCount)}`);
    console.log(`  Success Rate:  ${chalk[metrics.successCount === metrics.totalRuns ? 'green' : 'yellow']((metrics.successRate * 100) + '%')}`);
    console.log(`  Total Time:    ${chalk.cyan(formatElapsedMs(metrics.batchDurationMs))}`);


    if (metrics.successCount > 0) {
        console.log(chalk.bold.cyan("\n⏱️ Latency distribution (ms):"));
        console.log(`  Min:              ${chalk.cyan(fxMs(metrics.latency.minMs))}`);
        console.log(`  P50 (Median):     ${chalk.cyan(fxMs(metrics.latency.p50Ms))}`);
        console.log(`  P90:              ${chalk.cyan(fxMs(metrics.latency.p90Ms))}`);
        console.log(`  P95:              ${chalk.cyan.bold(fxMs(metrics.latency.p95Ms))}`);
        console.log(`  Max:              ${chalk.cyan(fxMs(metrics.latency.maxMs))}`);
        console.log(`  Mean:             ${chalk.white(fxMs(metrics.latency.meanMs))}`);
        console.log(`  Std Dev:          ${chalk.dim(fxMs(metrics.latency.stdDevMs))}`);
    } else {
        console.log(chalk.red("\n⚠️  No successful runs to analyze."));
    }
    if (metrics.costs.meanBridgeUsd !== null) {
        console.log(`\n${chalk.bold('Costs average (USD):')}`);
        console.log(`  Bridge Fee:    ${chalk.yellow('$' + metrics.costs.meanBridgeUsd.toFixed(4))}`);
        if (metrics.costs.meanSourceFeeUsd !== null) {
            console.log(`  Source Fee:    ${chalk.yellow('$' + metrics.costs.meanSourceFeeUsd.toFixed(4))}`);
        }
        if (metrics.costs.meanTargetFeeUsd !== null) {
            console.log(`  Target Fee:    ${chalk.yellow('$' + metrics.costs.meanTargetFeeUsd.toFixed(4))}`);
        }
    }
}
