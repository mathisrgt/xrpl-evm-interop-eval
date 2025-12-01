import chalk from "chalk";
import { RunConfig, SourceOutput, TargetOutput, NetworkDirection, RunContext, RunRecord, NetworkMode } from "../types";
import { formatElapsedMs } from "./time";
import readline from "readline";
import { loadConfig } from "../runners/config";
import { MetricsSummary } from "./metrics";

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

function formatTxHash(hash: string): string {
    const truncated = `${hash.slice(0, 8)}...${hash.slice(-8)}`;
    return chalk.magenta(truncated);
}

function getSourceChain(direction: NetworkDirection): 'xrpl' | 'evm' {
    if (direction === 'xrpl_to_xrpl_evm' || direction === 'xrpl_to_base') {
        return 'xrpl';
    } else {
        // xrpl_evm_to_xrpl or base_to_xrpl
        return 'evm';
    }
}

function getTargetChain(direction: NetworkDirection): 'xrpl' | 'evm' {
    if (direction === 'xrpl_to_xrpl_evm' || direction === 'xrpl_to_base') {
        return 'evm';
    } else {
        // xrpl_evm_to_xrpl or base_to_xrpl
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
    // console.log(chalk.bgWhite('════════════ CONFIG ════════════'));

    const rows = [
        ['Tag', cfg.tag],
        ['Mode', chalk[cfg.networks.mode === 'mainnet' ? 'green' : 'yellow'](cfg.networks.mode.toUpperCase())],
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
    console.log(`Address: ${formatAddress(xrplAddress, 'xrpl')}`);
    console.log(`Endpoint: ${chalk.dim(xrplEndpoint)}\n`);

    const evmReady = !!(ctx.cache.evm?.publicClient && ctx.cache.evm?.walletClient && ctx.cache.evm?.account);
    const evmStatus = evmReady ? chalk.green('✓') : chalk.red('✗');
    const evmAddress = ctx.cache.evm?.account?.address || 'N/A';
    const evmEndpoint = ctx.cfg.networks.evm.rpcUrl;

    console.log(`${evmStatus} ${chalk.bold('EVM')}`);
    console.log(`Address: ${formatAddress(evmAddress, 'evm')}`);
    console.log(`Endpoint: ${chalk.dim(evmEndpoint)}\n`);

    console.log(`${chalk.dim('XRPL Gateway')}: ${formatAddress(ctx.cfg.networks.xrpl.gateway, 'xrpl')}`);
    console.log(`${chalk.dim('EVM Gateway')}: ${formatAddress(ctx.cfg.networks.evm.gateway, 'evm', true)}`);

    const allReady = xrplReady && evmReady;
    const overallStatus = allReady ? chalk.green('✅ All systems ready') : chalk.red('Some systems not ready\n');
    console.log(`${overallStatus}`);
}

export function logSubmit(ctx: RunContext, srcOutput: SourceOutput) {
    const sourceChain = getSourceChain(ctx.cfg.direction);
    const chainName = chalk.bold(sourceChain.toUpperCase());
    const amount = formatAmount(srcOutput.xrpAmount, 'XRP');

    console.log(`📤 ${chainName} transaction submitted`);
    console.log(`Amount: ${amount}`);
    console.log(`Hash: ${srcOutput.txHash}`);
}

export function logObserve(ctx: RunContext, output: TargetOutput): void {
    const targetChain = getTargetChain(ctx.cfg.direction);
    const chainName = chalk.bold(targetChain.toUpperCase());
    const amount = formatAmount(output.xrpAmount, 'XRP');
    const hash = output.txHash;

    console.log(`\n✅ ${chainName} transfer received`);
    console.log(`Amount: ${amount}`);
    console.log(`Hash: ${hash}`);

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
 * Display network mode selection menu
 */
async function selectNetworkMode(rl: readline.Interface): Promise<NetworkMode> {
    console.log(chalk.bold('\n🌐 Select Network Mode:'));
    console.log(` 1) ${chalk.bold('Testnet')}`);
    console.log(` 2) ${chalk.bold('Mainnet')}`);

    while (true) {
        const answer = await askQuestion(rl, '\nEnter your choice: ');

        switch (answer) {
            case '1':
                console.log(chalk.green('✓ Selected: Testnet'));
                return 'testnet';
            case '2':
                console.log(chalk.yellow('⚠️  Selected: Mainnet (real funds will be used)'));
                return 'mainnet';
            default:
                console.log(chalk.red('❌ Invalid choice. Please enter 1 or 2.'));
        }
    }
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
async function selectXrpAmount(rl: readline.Interface, networkMode: NetworkMode): Promise<number> {
    console.log(chalk.bold(`🚨 Up to 2 XRP (AVG. 0.2 XRP) could be used for gas fees.`));
    console.log(chalk.bold('\n💰 Enter an XRP amount (min 2 XRP) for each transaction:'));

    while (true) {
        const answer = await askQuestion(rl, '\nEnter an amount of XRP: ');

        const customAmount = parseFloat(answer);
        if (!isNaN(customAmount) && customAmount >= 2) {
            if (networkMode === 'mainnet' && customAmount >= 10) {
                const confirm = await askQuestion(rl,
                    chalk.yellow(`⚠️  You entered ${customAmount} XRP for mainnet for each transaction. This uses real funds. Continue? (y/N): `)
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
    const { networks, direction, xrpAmount, runs } = config;

    console.log(chalk.bold('\n📋 Configuration Summary:'));
    console.log('┌─────────────────────────────────────────────┐');
    console.log(`│ ${chalk.bold('Network Mode:')} ${chalk[networks.mode === 'mainnet' ? 'yellow' : 'green'](networks.mode.toUpperCase().padEnd(30))}│`);
    console.log(`│ ${chalk.bold('Direction:')} ${chalk.cyan(direction.replace(/_/g, ' ').replace(/to/gi, '→').toUpperCase().padEnd(33))}│`);
    console.log(`│ ${chalk.bold('XRP Amount:')} ${chalk.yellow(xrpAmount.toString().padEnd(32))}│`);
    console.log(`│ ${chalk.bold('Test Runs:')} ${chalk.white(runs.toString().padEnd(33))}│`);
    console.log('└─────────────────────────────────────────────┘');

    if (networks.mode === 'mainnet') {
        console.log(chalk.red('\n⚠️  WARNING: This will use real XRP on mainnet!'));
        console.log(chalk.red('💸 Estimated cost: ~' + (xrpAmount * runs).toFixed(2) + ' XRP'));
        console.log(chalk.red('💸 Estimated bridge fees: ~' + (0.2 * runs).toFixed(2) + ' XRP'));
    }

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
        const networkMode = await selectNetworkMode(rl);
        const bridgeType = await selectBridgeType(rl);
        const networkDirection = await selectBridgeDirection(rl, bridgeType);
        const xrpAmount = await selectXrpAmount(rl, networkMode);
        const nbRuns = await selectNumberOfRuns(rl);

        const config = loadConfig(networkMode, networkDirection, xrpAmount, nbRuns);

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
    console.log(`  Direction:        ${chalk.white(metrics.direction)}`);
    console.log(`  Amount (XRP):     ${chalk.white(String(metrics.xrpAmount))}`);
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
        console.log(`  P99:              ${chalk.cyan.bold(fxMs(metrics.latency.p99Ms))}`);
        console.log(`  Max:              ${chalk.cyan(fxMs(metrics.latency.maxMs))}`);
        console.log(`  Mean:             ${chalk.white(fxMs(metrics.latency.meanMs))}`);
        console.log(`  Std Dev:          ${chalk.dim(fxMs(metrics.latency.stdDevMs))}`);
    } else {
        console.log(chalk.red("\n⚠️  No successful runs to analyze."));
    }
    if (metrics.costs.meanTotalXrp && metrics.costs.meanBridgeXrp) {
        console.log(`\n${chalk.bold('Costs average:')}`);
        console.log(`  Total Cost:    ${chalk.yellow(metrics.costs.meanTotalXrp.toFixed(6) + ' XRP')}`);
        console.log(`  Bridge Cost:   ${chalk.yellow(metrics.costs.meanBridgeXrp.toFixed(6) + ' XRP')}`);
    }
}
