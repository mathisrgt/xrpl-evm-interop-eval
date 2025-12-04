import chalk from "chalk";
import { createRunContext, createRunRecord, updateTimestamp, updateTxHash } from "./runners/context";
import type { RunConfig, RunRecord } from "./types";
import { saveBatchArtifacts } from "./utils/fsio";
import { displayMetrics, logConfig, logError, logObserve, logPrepare, logRecord, logStep, logSubmit, showMenu, showMainMenu } from "./utils/logger";
import { waitWithCountdown } from "./utils/time";
import { computeMetrics } from "./utils/metrics";
import { createRunner, BridgeType } from "./runners/runner.factory";
import { getXrplWallet, getEvmAccount } from "./utils/environment";
import { parseCliArgs, validateCliArgs, displayHelp, displayValidationErrors } from "./utils/cli";
import { loadConfig } from "./runners/config";
import * as readline from 'readline';

async function main() {
    // Parse CLI arguments
    const cliArgs = parseCliArgs();

    // Handle help command
    if (cliArgs.help) {
        displayHelp();
        return;
    }

    // Validate CLI arguments
    const validation = validateCliArgs(cliArgs);

    let cfg: RunConfig;
    let bridgeType: string;

    // If CLI validation failed, show errors and use interactive menu
    if (cliArgs.src || cliArgs.dst) {
        if (!validation.valid) {
            displayValidationErrors(validation);
            console.log(chalk.cyan('Falling back to interactive menu...\n'));
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    // Use CLI mode if validation passed
    if (validation.valid && validation.direction && validation.bridgeType !== undefined && validation.amount !== undefined && validation.runs !== undefined) {
        console.log(chalk.bold.cyan('\n╔══════════════════════════════════════════════════════════════════════════════╗'));
        console.log(chalk.bold.cyan('║             XRPL ↔ EVM Bridge Performance & Metrics Tool                     ║'));
        console.log(chalk.bold.cyan('╚══════════════════════════════════════════════════════════════════════════════╝\n'));

        console.log(chalk.green('✅ CLI mode: Using provided parameters\n'));

        // Load configuration from CLI arguments
        cfg = loadConfig(validation.mode!, validation.direction, validation.amount, validation.runs, validation.bridgeType);
        bridgeType = validation.bridgeType;

        // Display configuration summary
        console.log(chalk.bold('📋 Configuration:'));
        console.log(`  ${chalk.bold('Bridge:')}     ${chalk.cyan(bridgeType)}`);
        console.log(`  ${chalk.bold('Direction:')} ${chalk.cyan(validation.direction)}`);
        console.log(`  ${chalk.bold('Mode:')}      ${chalk.cyan(validation.mode)}`);
        console.log(`  ${chalk.bold('Amount:')}    ${chalk.cyan(validation.amount)} XRP`);
        console.log(`  ${chalk.bold('Runs:')}      ${chalk.cyan(validation.runs)}`);
        console.log('');
    } else {
        // Interactive menu mode
        const result = await showMainMenu();

        if (result.action === 'metrics') {
            // Metrics management mode - handled in showMainMenu
            return;
        }

        // Bridge test mode - continue with bridge configuration
        const menuResult = await showMenu(result.mode!);
        cfg = menuResult.config;
        bridgeType = menuResult.bridgeType;
    }

    // Display wallet addresses and get confirmation
    console.log(chalk.bold('\n📍 Wallet Addresses'));
    console.log(chalk.cyan('═'.repeat(60)));

    const xrplWallet = getXrplWallet();
    const evmAccount = getEvmAccount();

    console.log(chalk.bold('XRPL Address: ') + chalk.green(xrplWallet.address));
    console.log(chalk.bold('EVM Address:  ') + chalk.green(evmAccount.address));
    console.log(chalk.cyan('═'.repeat(60)));

    // Prompt for confirmation
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.yellow('\nContinue with these addresses? (Y/n): '), (ans) => {
            rl.close();
            resolve(ans.trim().toLowerCase());
        });
    });

    if (answer === 'n' || answer === 'no') {
        console.log(chalk.red('❌ Aborted by user'));
        process.exit(0);
    }

    console.log(chalk.green('✅ Proceeding with bridge operations...\n'));

    logStep("configuration");
    logConfig(cfg);

    const batchId = [
        new Date().toISOString().replace(/[:.]/g, "-"),
        cfg.direction,
        cfg.tag
    ].join("_");

    console.log(chalk.cyan(`🌉 Using bridge: ${bridgeType}\n`));

    const runner = createRunner(bridgeType as BridgeType, cfg.direction);

    const records: RunRecord[] = [];
    let successCount = 0;
    let failureCount = 0;
    const batchStartTime = Date.now();
    const ctx = createRunContext(cfg);

    try {
        logStep("prepare");
        updateTimestamp(ctx, 't0_prepare');
        await runner.prepare(ctx);
        logPrepare(ctx);

        for (let runIndex = 0; runIndex < cfg.runs; runIndex++) {
            const runNumber = runIndex + 1;
            const separator = chalk.bold('═'.repeat(60));

            console.log(`\n${separator}`);
            console.log(chalk.bold.cyan(`🔄 RUN ${runNumber}/${cfg.runs}`));
            console.log(separator);

            const runCtx = createRunContext(cfg);
            runCtx.cache = ctx.cache;
            runCtx.runId = `${cfg.tag}_run${runNumber}`;

            try {
                logStep("submit");
                updateTimestamp(runCtx, 't1_submit');
                const srcOutput = await runner.submit(runCtx);
                updateTxHash(runCtx, 'sourceTxHash', srcOutput.txHash);
                logSubmit(runCtx, srcOutput);

                logStep(`observe`);
                updateTimestamp(runCtx, 't2_observe', srcOutput.submittedAt);
                const trgOutput = await runner.observe(runCtx);
                updateTxHash(runCtx, 'targetTxHash', trgOutput.txHash);
                updateTimestamp(runCtx, 't3_finalized', trgOutput.finalizedAt);
                logObserve(runCtx, trgOutput);

                let gasRfdOutput;
                
                if (cfg.networks.mode === "testnet") {
                    logStep(`gas refund`);
                    await waitWithCountdown(10000, "Waiting for gas refund transaction...");
                    gasRfdOutput = await runner.observeGasRefund(runCtx);
                    updateTimestamp(runCtx, 't4_finalized_gas_refund', srcOutput.submittedAt);
                    console.log(`⛽ Gas refund received: ${gasRfdOutput.xrpAmount} XRP (${gasRfdOutput.txHash})`);
                }

                logStep("record")
                const record = createRunRecord(runCtx, srcOutput, trgOutput, true, gasRfdOutput);
                logRecord(record);

                records.push(record);
                successCount++;

                console.log(chalk.green(`✅ Run ${runNumber}/${cfg.runs} completed successfully`));

                if (runIndex < cfg.runs - 1) {
                    await waitWithCountdown(5000, "Preparing next run...");
                }

            } catch (err) {
                failureCount++;
                const errorMessage = err instanceof Error ? err.message : String(err);

                logError(`Run ${runNumber} failed`, "RUN_ERROR", err instanceof Error ? err : undefined);

                const failedRecord = createRunRecord(
                    runCtx,
                    { xrpAmount: 0, txHash: runCtx.txs.sourceTxHash || "N/A", submittedAt: ctx.ts.t1_submit || 0, txFee: 0 },
                    { xrpAmount: 0, txHash: runCtx.txs.targetTxHash || "N/A", finalizedAt: ctx.ts.t3_finalized || 0, txFee: 0 },
                    false
                );
                failedRecord.abort_reason = errorMessage;

                records.push(failedRecord);

                console.log(chalk.red(`❌ Run ${runNumber}/${cfg.runs} failed: ${errorMessage}`));
            }
        }

        if (records.length > 0) {
            logStep("Metrics");
            const metricsReport = computeMetrics(cfg, records, (Date.now() - batchStartTime));
            displayMetrics(metricsReport.summary);

            console.log(chalk.bold('\n💾 Saving batch records...'));
            saveBatchArtifacts(batchId, cfg, ctx, records, metricsReport);
            console.log(chalk.green(`✅ Batch saved: ${batchId}`));
        }
    } catch (err) {
        logError("Fatal error during batch execution", "BATCH_ERROR", err instanceof Error ? err : undefined);
        console.error(err);
    } finally {
        await ctx.cleaner.run();
    }
}

main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
});