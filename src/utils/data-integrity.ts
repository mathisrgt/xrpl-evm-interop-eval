import chalk from "chalk";
import readline from "readline";

/**
 * Data integrity issue actions
 */
export type DataIntegrityAction = 'retry' | 'ignore-run' | 'abort-batch';

/**
 * Ask user what to do when price conversion fails
 * Returns the user's choice: retry, ignore-run, or abort-batch
 */
export async function askPriceConversionAction(
    currency: string,
    amount: number,
    error: Error
): Promise<DataIntegrityAction> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        console.log(chalk.red.bold('\n⚠️  PRICE CONVERSION FAILED'));
        console.log(chalk.yellow('═'.repeat(80)));
        console.log(chalk.red(`Error converting ${amount} ${currency} to USD:`));
        console.log(chalk.dim(`   ${error.message}`));
        console.log(chalk.yellow('═'.repeat(80)));
        console.log(chalk.bold('\n⚠️  Data Integrity Issue:'));
        console.log('   Without accurate price conversion, the saved data will be incomplete/biased.');
        console.log('   What would you like to do?');
        console.log('');
        console.log(chalk.cyan('   1) Retry conversion (fetch price again)'));
        console.log(chalk.yellow('   2) Ignore this run (skip saving this run\'s data)'));
        console.log(chalk.red('   3) Abort batch (stop all runs and don\'t save anything)'));
        console.log('');

        while (true) {
            const answer = await new Promise<string>((resolve) => {
                rl.question(chalk.bold('Enter your choice (1/2/3): '), (ans) => {
                    resolve(ans.trim());
                });
            });

            if (answer === '1') {
                console.log(chalk.cyan('\n🔄 Retrying price conversion...'));
                return 'retry';
            } else if (answer === '2') {
                console.log(chalk.yellow('\n⚠️  Skipping this run (data will not be saved)'));
                return 'ignore-run';
            } else if (answer === '3') {
                console.log(chalk.red('\n🛑 Aborting batch (no data will be saved)'));
                return 'abort-batch';
            } else {
                console.log(chalk.red('Invalid choice. Please enter 1, 2, or 3.'));
            }
        }
    } finally {
        rl.close();
    }
}

/**
 * Ask user what to do when negative costs are detected
 * Returns the user's choice: ignore-run or abort-batch
 */
export async function askNegativeCostAction(
    costType: string,
    costValue: number,
    currency: string
): Promise<DataIntegrityAction> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        console.log(chalk.red.bold('\n⚠️  NEGATIVE COST DETECTED'));
        console.log(chalk.yellow('═'.repeat(80)));
        console.log(chalk.red(`Detected negative ${costType}: ${costValue} ${currency}`));
        console.log(chalk.yellow('═'.repeat(80)));
        console.log(chalk.bold('\n⚠️  Data Integrity Issue:'));
        console.log('   Negative costs indicate a calculation error or data corruption.');
        console.log('   This data should not be saved as it will bias metrics.');
        console.log('   What would you like to do?');
        console.log('');
        console.log(chalk.yellow('   1) Ignore this run (skip saving this run\'s data)'));
        console.log(chalk.red('   2) Abort batch (stop all runs and don\'t save anything)'));
        console.log('');

        while (true) {
            const answer = await new Promise<string>((resolve) => {
                rl.question(chalk.bold('Enter your choice (1/2): '), (ans) => {
                    resolve(ans.trim());
                });
            });

            if (answer === '1') {
                console.log(chalk.yellow('\n⚠️  Skipping this run (data will not be saved)'));
                return 'ignore-run';
            } else if (answer === '2') {
                console.log(chalk.red('\n🛑 Aborting batch (no data will be saved)'));
                return 'abort-batch';
            } else {
                console.log(chalk.red('Invalid choice. Please enter 1 or 2.'));
            }
        }
    } finally {
        rl.close();
    }
}

/**
 * Exception class for when user chooses to abort batch
 */
export class BatchAbortedException extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BatchAbortedException';
    }
}

/**
 * Exception class for when user chooses to ignore run
 */
export class RunIgnoredException extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RunIgnoredException';
    }
}
