import chalk from "chalk";
import { createRunContext, createRunRecord, updateTimestamp, updateTxHash } from "./runners/context";
import { Runner } from "./runners/runner";
import type { RunRecord } from "./types";
import { saveBatchRecords, saveBatchSummary } from "./utils/fsio";
import { displayBatchSummary, logConfig, logError, logObserve, logPrepare, logRecord, logStep, logSubmit, showMenu } from "./utils/logger";
import { waitWithCountdown } from "./utils/time";

async function main() {
    const cfg = await showMenu();

    logStep("configuration");
    logConfig(cfg);

    const runner = new Runner(cfg.direction);
    
    const allRecords: RunRecord[] = [];
    let successCount = 0;
    let failureCount = 0;
    const batchStartTime = Date.now();

    try {
        // Prepare once before all runs
        const ctx = createRunContext(cfg);
        logStep("prepare");
        updateTimestamp(ctx, 't0_prepare');
        await runner.prepare(ctx);
        logPrepare(ctx);

        for (let runIndex = 0; runIndex < cfg.runs; runIndex++) {
            const runNumber = runIndex + 1;
            const separator = chalk.bold('═'.repeat(80));
            
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

                await waitWithCountdown(60000, "Bridge being performed...");

                logStep(`observe`);
                updateTimestamp(runCtx, 't2_observe', srcOutput.submittedAt);
                const trgOutput = await runner.observe(runCtx);
                updateTxHash(runCtx, 'targetTxHash', trgOutput.txHash);
                updateTimestamp(runCtx, 't3_finalize', trgOutput.finalizedAt);
                logObserve(runCtx, trgOutput);

                await waitWithCountdown(10000, "Waiting for gas refund transaction...");
                
                logStep("gas refund");
                const gasRfdOutput = await runner.observeGasRefund(runCtx);
                console.log(`✅ Gas refund received: ${gasRfdOutput.xrpAmount} XRP (${gasRfdOutput.txHash})`);

                logStep("record")
                const record = createRunRecord(runCtx, srcOutput, trgOutput, true, gasRfdOutput);
                logRecord(record);
                
                allRecords.push(record);
                successCount++;

                console.log(chalk.green(`✅ Run ${runNumber}/${cfg.runs} completed successfully`));

                // Add delay between runs if not the last run
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
                    { xrpAmount: 0, txHash: runCtx.txs.targetTxHash || "N/A", finalizedAt: ctx.ts.t3_finalize || 0, txFee: 0 },
                    false
                );
                failedRecord.abort_reason = errorMessage;
                
                allRecords.push(failedRecord);

                console.log(chalk.red(`❌ Run ${runNumber}/${cfg.runs} failed: ${errorMessage}`));

                if (runIndex < cfg.runs - 1) {
                    console.log(chalk.yellow(`\n⚠️  ${cfg.runs - runNumber} run(s) remaining. Continue? (Y/n)`));
                    await waitWithCountdown(3000, "Continuing...");
                }
            }
        }

        if (allRecords.length > 0) {
            console.log(chalk.bold('\n💾 Saving batch records...'));
            const batchId = saveBatchRecords(allRecords);
            console.log(chalk.green(`✅ Batch saved: ${batchId}`));
            
            saveBatchSummary(batchId, allRecords, batchStartTime);
            console.log(chalk.green(`✅ Summary saved: ${batchId}_summary.json`));
        }

        displayBatchSummary(cfg.runs, successCount, failureCount, allRecords, batchStartTime);

    } catch (err) {
        logError("Fatal error during batch execution", "BATCH_ERROR", err instanceof Error ? err : undefined);
        console.error(err);
    } finally {
        const ctx = createRunContext(cfg);
        if (ctx.cache.xrpl?.client) {
            try {
                await ctx.cache.xrpl.client.disconnect();
                console.log(chalk.dim("🔌 Disconnected from XRPL"));
            } catch (err) {
                console.warn(chalk.yellow("⚠️  Failed to disconnect XRPL client"));
            }
        }
    }
}

main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
});