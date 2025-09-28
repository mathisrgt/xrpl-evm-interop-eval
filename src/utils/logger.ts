import chalk from "chalk";
import { RunConfig, SourceOutput, TargetOutput, NetworkDirection, RunContext, RunRecord, NetworkMode } from "../types";
import { formatElapsedMs } from "./time";
import readline from "readline";
import { loadConfig } from "../runners/config";

// Utility functions
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
    const parts = direction.split('_to_');

    if (parts.length !== 2) {
        throw new Error(`Invalid direction format: ${direction}. Expected 'source_to_target'`);
    }

    const source = parts[0];
    if (source !== 'xrpl' && source !== 'evm') {
        throw new Error(`Invalid source chain: ${source}. Must be 'xrpl' or 'evm'`);
    }

    return source as 'xrpl' | 'evm';
}

function getTargetChain(direction: NetworkDirection): 'xrpl' | 'evm' {
    const parts = direction.split('_to_');

    if (parts.length !== 2) {
        throw new Error(`Invalid direction format: ${direction}. Expected 'source_to_target'`);
    }

    const target = parts[1];
    if (target !== 'xrpl' && target !== 'evm') {
        throw new Error(`Invalid target chain: ${target}. Must be 'xrpl' or 'evm'`);
    }

    return target as 'xrpl' | 'evm';
}

// Main logging functions
export function logStep(step: string, details?: string): void {
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
        ['EVM Contract', formatAddress(cfg.networks.evm.contract, 'evm', true)],
    ];

    const maxKeyLength = Math.max(...rows.map(([key]) => key.length));

    rows.forEach(([key, value]) => {
        const paddedKey = chalk.dim(key.padEnd(maxKeyLength));
        console.log(`  ${paddedKey} : ${value}`);
    });
}

export function logPrepare(ctx: RunContext): void {
    // console.log(chalk.bgBlue('════════════ PREPARE ════════════'));

    // XRPL Status
    const xrplReady = !!(ctx.cache.xrpl?.client && ctx.cache.xrpl?.wallet);
    const xrplStatus = xrplReady ? chalk.green('✓') : chalk.red('✗');
    const xrplAddress = ctx.cache.xrpl?.wallet?.address || 'N/A';
    const xrplEndpoint = ctx.cfg.networks.xrpl.wsUrl;

    console.log(`${xrplStatus} ${chalk.bold('XRPL')}`);
    console.log(`Address: ${formatAddress(xrplAddress, 'xrpl')}`);
    console.log(`Endpoint: ${chalk.dim(xrplEndpoint)}\n`);

    // EVM Status  
    const evmReady = !!(ctx.cache.evm?.publicClient && ctx.cache.evm?.walletClient && ctx.cache.evm?.account);
    const evmStatus = evmReady ? chalk.green('✓') : chalk.red('✗');
    const evmAddress = ctx.cache.evm?.account?.address || 'N/A';
    const evmEndpoint = ctx.cfg.networks.evm.rpcUrl;

    console.log(`${evmStatus} ${chalk.bold('EVM')}`);
    console.log(`Address: ${formatAddress(evmAddress, 'evm')}`);
    console.log(`Endpoint: ${chalk.dim(evmEndpoint)}\n`);

    // Gateway addresses
    console.log(`${chalk.dim('XRPL Gateway')}: ${formatAddress(ctx.cfg.networks.xrpl.gateway, 'xrpl')}`);
    console.log(`${chalk.dim('EVM Gateway')}: ${formatAddress(ctx.cfg.networks.evm.gateway, 'evm', true)}`);
    console.log(`${chalk.dim('EVM Contract')}: ${formatAddress(ctx.cfg.networks.evm.contract, 'evm', true)}`);

    // Overall status
    const allReady = xrplReady && evmReady;
    const overallStatus = allReady ? chalk.green('✅ All systems ready') : chalk.red('Some systems not ready\n');
    console.log(`${overallStatus}`);
}

export function logSubmit(ctx: RunContext, srcOutput: SourceOutput) {
    const sourceChain = getSourceChain(ctx.cfg.direction);
    const chainName = chalk.bold(sourceChain.toUpperCase());
    const amount = formatAmount(srcOutput.xrpAmount, 'XRP');
    // const hash = formatTxHash(srcOutput.txHash);

    console.log(`📤 ${chainName} transaction submitted`);
    console.log(`Amount: ${amount}`);
    console.log(`Hash: ${srcOutput.txHash}`);
}

export function logObserve(ctx: RunContext, output: TargetOutput): void {
    const targetChain = getTargetChain(ctx.cfg.direction);
    const chainName = chalk.bold(targetChain.toUpperCase());
    const amount = formatAmount(output.xrpAmount, 'XRP');
    const hash = formatTxHash(output.txHash);

    console.log(`\n✅ ${chainName} transfer received`);
    console.log(`Amount: ${amount}`);
    console.log(`Hash: ${hash}`);

    if (ctx.ts.t3_finalize && ctx.ts.t1_submit) {
        const elapsed = formatElapsedMs(ctx.ts.t3_finalize - ctx.ts.t1_submit, { pad: true });
        console.log(`Time: ${chalk.green(elapsed)}`);
    }
}

export function logRecord(record: RunRecord): void {
    // Run identification
    console.log(`${chalk.bold('Run ID')}: ${chalk.cyan(record.runId)}`);
    console.log(`${chalk.bold('Success')}: ${record.success ? chalk.green('✓ YES') : chalk.red('✗ NO')}`);

    if (record.abort_reason) {
        console.log(`${chalk.bold('Abort Reason')}: ${chalk.red(record.abort_reason)}`);
    }

    console.log(''); // spacing

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
    if (timestamps.t3_finalize) {
        console.log(`${chalk.bold('Finalized')}: ${formatTimeOnly(timestamps.t3_finalize)}`);
    }

    // Calculate and display total latency if possible
    if (timestamps.t1_submit && timestamps.t3_finalize) {
        const totalLatency = timestamps.t3_finalize - timestamps.t1_submit;
        const formattedLatency = formatElapsedMs(totalLatency, { pad: true });
        console.log(`${chalk.bold('Total latency')}: ${chalk.green(formattedLatency)}`);
    }

    console.log(''); // spacing

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

// export function logBatchComplete(
//     totalRuns: number,
//     successCount: number,
//     totalDuration: number,
//     avgLatency?: number
// ): void {
//     const separator = chalk.bold('═'.repeat(60));
//     const successRate = (successCount / totalRuns * 100).toFixed(1);
//     const duration = formatElapsedMs(totalDuration, { includeHours: true, pad: true });

//     console.log(`\n${separator}`);
//     console.log(chalk.bold('🏁 BATCH COMPLETE'));
//     console.log(separator);

//     const summary = [
//         ['Total Runs', chalk.white(totalRuns.toString())],
//         ['Successful', chalk[successCount === totalRuns ? 'green' : 'yellow'](successCount.toString())],
//         ['Success Rate', chalk[successCount === totalRuns ? 'green' : 'yellow'](`${successRate}%`)],
//         ['Total Duration', chalk.cyan(duration)],
//     ];

//     if (avgLatency && successCount > 0) {
//         summary.push(['Avg Latency', chalk.cyan(formatElapsedMs(avgLatency, { pad: true }))]);
//     }

//     const maxKeyLength = Math.max(...summary.map(([key]) => key.length));

//     summary.forEach(([key, value]) => {
//         const paddedKey = chalk.dim(key.padEnd(maxKeyLength));
//         console.log(`  ${paddedKey} : ${value}`);
//     });

//     console.log(separator);
// }

export function logError(message: string, context?: string, error?: Error): void {
    const contextStr = context ? chalk.red(`[${context}]`) : '';
    console.error(`${chalk.red('❌')} ${contextStr} ${message}`);

    if (error?.stack) {
        console.error(chalk.dim(error.stack));
    }
}

/**
 * Create readline interface for user input
 */
function createReadlineInterface() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
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
 * Display bridge direction selection menu
 */
async function selectBridgeDirection(rl: readline.Interface): Promise<NetworkDirection> {
    console.log(chalk.bold('\n🔄 Select Bridge Direction:'));
    console.log(` 1) ${chalk.bold('XRPL → EVM')} ${chalk.dim('(XRPL to XRPL EVM)')}`);
    console.log(` 2) ${chalk.bold('EVM → XRPL')} ${chalk.dim('(XRPL EVM to XRPL)')}`);

    while (true) {
        const answer = await askQuestion(rl, '\nEnter your choice: ');

        switch (answer) {
            case '1':
                console.log(chalk.cyan('✓ Selected: XRPL → EVM'));
                return 'xrpl_to_evm';
            case '2':
                console.log(chalk.cyan('✓ Selected: EVM → XRPL'));
                return 'evm_to_xrpl';
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
        console.log(chalk.red('💸 Estimated bridge fees: ~' + (0.5 * runs).toFixed(2) + ' USD'));
    }

    const answer = await askQuestion(rl, '\nProceed with this configuration? (Y/n): ');
    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes' || answer === '';
}


export async function showMenu(): Promise<RunConfig> {
    const rl = createReadlineInterface();

    try {
        displayBanner();

        // Collect all configuration parameters
        const networkMode = await selectNetworkMode(rl);
        const networkDirection = await selectBridgeDirection(rl);
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

        return config;

    } finally {
        rl.close();
    }
}
