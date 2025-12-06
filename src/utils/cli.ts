import chalk from "chalk";
import { NetworkDirection } from "../types";

export interface CliArgs {
    help: boolean;
    src?: string;
    dst?: string;
    amount?: number;
    runs?: number;
}

export interface CliValidation {
    valid: boolean;
    errors: string[];
    direction?: NetworkDirection;
    bridgeType?: string;
    amount?: number;
    runs?: number;
}

/**
 * Parse CLI arguments from process.argv
 */
export function parseCliArgs(): CliArgs {
    const args: CliArgs = {
        help: false
    };

    for (let i = 2; i < process.argv.length; i++) {
        const arg = process.argv[i];
        const nextArg = process.argv[i + 1];

        switch (arg) {
            case '-h':
            case '--help':
                args.help = true;
                break;
            case '--src':
                args.src = nextArg?.toLowerCase();
                i++;
                break;
            case '--dst':
                args.dst = nextArg?.toLowerCase();
                i++;
                break;
            case '--amount':
                args.amount = parseFloat(nextArg);
                i++;
                break;
            case '--runs':
                args.runs = parseInt(nextArg, 10);
                i++;
                break;
        }
    }

    return args;
}

/**
 * Display help message
 */
export function displayHelp(): void {
    console.log(chalk.bold.cyan('\n╔══════════════════════════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.cyan('║          XRPL ↔ EVM Bridge Performance & Metrics Tool - Help                 ║'));
    console.log(chalk.bold.cyan('╚══════════════════════════════════════════════════════════════════════════════╝\n'));

    console.log(chalk.bold('USAGE:'));
    console.log('  npm start [options]\n');

    console.log(chalk.bold('OPTIONS:'));
    console.log(`  ${chalk.cyan('-h, --help')}              Show this help message`);
    console.log(`  ${chalk.cyan('--src <chain>')}           Source chain (xrpl, base, xrpl-evm, flare)`);
    console.log(`  ${chalk.cyan('--dst <chain>')}           Destination chain (xrpl, base, xrpl-evm, flare)`);
    console.log(`  ${chalk.cyan('--amount <number>')}       Amount of XRP/FXRP to transfer (default: varies by bridge)`);
    console.log(`  ${chalk.cyan('--runs <number>')}         Number of test runs to execute (default: 1)\n`);

    console.log(chalk.bold('SUPPORTED DIRECTIONS:'));
    console.log(`  ${chalk.yellow('XRPL ↔ Base')}        (via Near Intents)`);
    console.log(`    --src xrpl --dst base        ${chalk.dim('(xrpl_to_base)')}`);
    console.log(`    --src base --dst xrpl        ${chalk.dim('(base_to_xrpl)')}\n`);

    console.log(`  ${chalk.yellow('XRPL ↔ XRPL-EVM')}   (via Axelar)`);
    console.log(`    --src xrpl --dst xrpl-evm    ${chalk.dim('(xrpl_to_xrpl_evm)')}`);
    console.log(`    --src xrpl-evm --dst xrpl    ${chalk.dim('(xrpl_evm_to_xrpl)')}\n`);

    console.log(`  ${chalk.yellow('XRPL ↔ Flare')}      (via FAsset - Manual)`);
    console.log(`    --src xrpl --dst flare       ${chalk.dim('(xrpl_to_flare - fixed: 10 XRP, 1 run)')}`);
    console.log(`    --src flare --dst xrpl       ${chalk.dim('(flare_to_xrpl - fixed: 10 FXRP, 1 run)')}\n`);

    console.log(chalk.bold('EXAMPLES:'));
    console.log(`  ${chalk.dim('# Transfer 4 XRP from XRPL to Base, 3 runs')}`);
    console.log(`  npm start --src xrpl --dst base --amount 4 --runs 3\n`);

    console.log(`  ${chalk.dim('# Transfer 2 XRP from XRPL to XRPL-EVM')}`);
    console.log(`  npm start --src xrpl --dst xrpl-evm --amount 2\n`);

    console.log(`  ${chalk.dim('# FAsset bridge (amount and runs are fixed)')}`);
    console.log(`  npm start --src xrpl --dst flare\n`);

    console.log(`  ${chalk.dim('# Interactive menu mode (no parameters)')}`);
    console.log(`  npm start\n`);

    console.log(chalk.bold('NOTES:'));
    console.log(`  ${chalk.dim('• All operations use mainnet (real funds)')}`);
    console.log(`  ${chalk.dim('• FAsset bridge has fixed configuration: 10 XRP/FXRP, 1 run')}`);
    console.log(`  ${chalk.dim('• If parameters are missing or invalid, the interactive menu will be shown')}\n`);
}

/**
 * Map src/dst chain names to NetworkDirection and bridge type
 */
function getDirectionAndBridge(src: string, dst: string): { direction: NetworkDirection; bridgeType: string } | null {
    const key = `${src}_${dst}`;

    const mapping: Record<string, { direction: NetworkDirection; bridgeType: string }> = {
        'xrpl_base': { direction: 'xrpl_to_base', bridgeType: 'near-intents' },
        'base_xrpl': { direction: 'base_to_xrpl', bridgeType: 'near-intents' },
        'xrpl_xrpl-evm': { direction: 'xrpl_to_xrpl_evm', bridgeType: 'axelar' },
        'xrpl-evm_xrpl': { direction: 'xrpl_evm_to_xrpl', bridgeType: 'axelar' },
        'xrpl_flare': { direction: 'xrpl_to_flare', bridgeType: 'fasset' },
        'flare_xrpl': { direction: 'flare_to_xrpl', bridgeType: 'fasset' },
    };

    return mapping[key] || null;
}

/**
 * Validate CLI arguments and return validation result
 */
export function validateCliArgs(args: CliArgs): CliValidation {
    const errors: string[] = [];
    const result: CliValidation = {
        valid: false,
        errors: []
    };

    // Check if we have both src and dst
    if (!args.src && !args.dst) {
        // No CLI args provided, use interactive mode
        return result;
    }

    // Validate src and dst are both provided
    if (!args.src) {
        errors.push('Missing --src parameter. Specify source chain (xrpl, base, xrpl-evm, flare).');
    }

    if (!args.dst) {
        errors.push('Missing --dst parameter. Specify destination chain (xrpl, base, xrpl-evm, flare).');
    }

    if (!args.src || !args.dst) {
        result.errors = errors;
        return result;
    }

    // Validate direction exists
    const directionInfo = getDirectionAndBridge(args.src, args.dst);

    if (!directionInfo) {
        errors.push(`Invalid direction: ${args.src} → ${args.dst}`);
        errors.push(`Supported directions:`);
        errors.push(`  • xrpl ↔ base (Near Intents)`);
        errors.push(`  • xrpl ↔ xrpl-evm (Axelar)`);
        errors.push(`  • xrpl ↔ flare (FAsset)`);
        result.errors = errors;
        return result;
    }

    result.direction = directionInfo.direction;
    result.bridgeType = directionInfo.bridgeType;

    // Special handling for FAsset bridge
    if (directionInfo.bridgeType === 'fasset') {
        result.amount = 10;
        result.runs = 1;

        // Warn if user provided custom values
        if (args.amount && args.amount !== 10) {
            console.log(chalk.yellow(`⚠️  FAsset bridge uses fixed amount: 10 XRP/FXRP (ignoring --amount ${args.amount})`));
        }
        if (args.runs && args.runs !== 1) {
            console.log(chalk.yellow(`⚠️  FAsset bridge uses fixed runs: 1 (ignoring --runs ${args.runs})`));
        }
    } else {
        // Validate amount
        if (args.amount !== undefined) {
            if (isNaN(args.amount) || args.amount <= 0) {
                errors.push(`Invalid amount: ${args.amount}. Must be a positive number.`);
            } else {
                result.amount = args.amount;
            }
        } else {
            errors.push('Missing --amount parameter. Specify amount of XRP to transfer.');
        }

        // Validate runs
        if (args.runs !== undefined) {
            if (isNaN(args.runs) || args.runs <= 0 || !Number.isInteger(args.runs)) {
                errors.push(`Invalid runs: ${args.runs}. Must be a positive integer.`);
            } else {
                result.runs = args.runs;
            }
        } else {
            // Default to 1 run if not specified
            result.runs = 1;
        }
    }

    result.errors = errors;
    result.valid = errors.length === 0;

    return result;
}

/**
 * Display validation errors
 */
export function displayValidationErrors(validation: CliValidation): void {
    console.log(chalk.red('\n❌ Invalid CLI arguments:\n'));

    for (const error of validation.errors) {
        if (error.startsWith('  •')) {
            console.log(chalk.dim(error));
        } else {
            console.log(chalk.red(`  • ${error}`));
        }
    }

    console.log(chalk.yellow('\n💡 Run with --help to see usage information.'));
    console.log(chalk.dim('   Or run without parameters for interactive menu.\n'));
}
