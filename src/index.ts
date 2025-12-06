import chalk from "chalk";
import { createRunContext, createRunRecord, updateTimestamp, updateTxHash } from "./runners/context";
import type { RunConfig, RunRecord } from "./types";
import { saveBatchArtifacts } from "./utils/fsio";
import { displayMetrics, logConfig, logError, logObserve, logPrepare, logRecord, logStep, logSubmit, showMenu, showMainMenu } from "./utils/logger";
import { waitWithCountdown } from "./utils/time";
import { computeMetrics } from "./utils/metrics";
import { createRunner, BridgeType } from "./runners/runner.factory";
import { parseCliArgs, validateCliArgs, displayHelp, displayValidationErrors } from "./utils/cli";
import { loadConfig } from "./runners/config";
import { BatchAbortedException, RunIgnoredException } from "./utils/data-integrity";

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

        // Display wallet addresses and balances, get user confirmation
        const { displayWalletInfoAndConfirm } = await import('./utils/logger');
        const confirmed = await displayWalletInfoAndConfirm();
        if (!confirmed) {
            process.exit(0);
        }

        // Load configuration from CLI arguments
        cfg = loadConfig(validation.direction, validation.amount, validation.runs, validation.bridgeType);
        bridgeType = validation.bridgeType;

        // Display configuration summary
        console.log(chalk.bold('📋 Configuration:'));
        console.log(`  ${chalk.bold('Bridge:')}     ${chalk.cyan(bridgeType)}`);
        console.log(`  ${chalk.bold('Direction:')} ${chalk.cyan(validation.direction)}`);
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
        const menuResult = await showMenu();
        cfg = menuResult.config;
        bridgeType = menuResult.bridgeType;
    }

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

            // Add 30-second pause before each run (except the first) to avoid detecting previous run's transactions
            if (runIndex > 0) {
                await waitWithCountdown(30000, "Waiting before next run to avoid transaction conflicts...");
            }

            console.log(`\n${separator}`);
            console.log(chalk.bold.cyan(`🔄 RUN ${runNumber}/${cfg.runs}`));
            console.log(separator);

            const runCtx = createRunContext(cfg);
            runCtx.cache = ctx.cache;
            runCtx.runId = `${cfg.tag}_run${runNumber}`;

            try {
                // Check balance before submitting
                logStep("balance check");
                const balanceCheck = await runner.checkBalance(runCtx);

                console.log(chalk.cyan(`💰 ${balanceCheck.message}`));

                if (!balanceCheck.sufficient) {
                    console.log(chalk.red(`❌ Stopping batch at run ${runNumber}/${cfg.runs} due to insufficient balance`));
                    console.log(chalk.yellow(`⚠️  Subsequent runs would fail with the same error, so stopping the entire batch.`));
                    console.log(chalk.dim(`   This run will not be counted as a failure.`));
                    break; // Stop the entire batch to avoid repeated failures
                }

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

                // Gas refund observation removed - not applicable for mainnet
                let gasRfdOutput;

                logStep("record")
                const record = await createRunRecord(runCtx, srcOutput, trgOutput, true, gasRfdOutput);
                logRecord(record);

                records.push(record);
                successCount++;

                console.log(chalk.green(`✅ Run ${runNumber}/${cfg.runs} completed successfully`));

            } catch (err) {
                // Handle data integrity exceptions
                if (err instanceof BatchAbortedException) {
                    console.log(chalk.red(`\n🛑 Batch aborted by user: ${err.message}`));
                    console.log(chalk.yellow(`⚠️  No data will be saved for this batch.`));
                    break; // Exit the run loop without saving any data
                }

                if (err instanceof RunIgnoredException) {
                    console.log(chalk.yellow(`\n⚠️  Run ${runNumber}/${cfg.runs} ignored by user: ${err.message}`));
                    console.log(chalk.dim(`   This run's data will not be saved.`));
                    // Don't increment failureCount or add to records
                    continue; // Skip to next run
                }

                // Handle regular errors
                failureCount++;
                const errorMessage = err instanceof Error ? err.message : String(err);

                logError(`Run ${runNumber} failed`, "RUN_ERROR", err instanceof Error ? err : undefined);

                try {
                    const failedRecord = await createRunRecord(
                        runCtx,
                        { xrpAmount: 0, txHash: runCtx.txs.sourceTxHash || "N/A", submittedAt: ctx.ts.t1_submit || 0, txFee: 0 },
                        { xrpAmount: 0, txHash: runCtx.txs.targetTxHash || "N/A", finalizedAt: ctx.ts.t3_finalized || 0, txFee: 0 },
                        false
                    );
                    failedRecord.abort_reason = errorMessage;

                    records.push(failedRecord);
                } catch (recordErr) {
                    // If creating the failed record also fails due to data integrity issues, handle it
                    if (recordErr instanceof BatchAbortedException) {
                        console.log(chalk.red(`\n🛑 Batch aborted by user while recording failure: ${(recordErr as Error).message}`));
                        console.log(chalk.yellow(`⚠️  No data will be saved for this batch.`));
                        break;
                    }
                    if (recordErr instanceof RunIgnoredException) {
                        console.log(chalk.yellow(`\n⚠️  Failed run ${runNumber}/${cfg.runs} ignored by user`));
                        continue;
                    }
                    // If it's some other error, rethrow
                    throw recordErr;
                }

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