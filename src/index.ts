import { xrplAdapter } from "./phases/adapters/xrpl.adapter";
import type { RunRecord } from "./types";
import { logConfig, logError, logObserve, logPrepare, logRecord, logStep, logSubmit, showMenu } from "./utils/logger";
import { evmAdapter } from "./phases/adapters/evm.adapter";
import { loadConfig } from "./runners/config";
import { createRunContext, createRunRecord, updateTimestamp, updateTxHash } from "./runners/context";
import { saveRecord } from "./utils/fsio";
import { waitWithCountdown } from "./utils/time";
import { Runner } from "./runners/runner";

async function main() {
    const cfg = await showMenu();

    logStep("configuration");
    logConfig(cfg);

    const runner = new Runner(cfg.direction);
    const ctx = createRunContext(cfg);

    try {
        logStep("prepare");
        updateTimestamp(ctx, 't0_prepare');
        await runner.prepare(ctx);
        logPrepare(ctx);

        logStep("submit");
        updateTimestamp(ctx, 't1_submit');
        const srcOutput = await runner.submit(ctx);
        updateTxHash(ctx, 'sourceTxHash', srcOutput.txHash);
        logSubmit(ctx, srcOutput);

        await waitWithCountdown(60000, "Bridge being performed...");

        logStep(`observe`);
        updateTimestamp(ctx, 't2_observe', srcOutput.submittedAt);
        const trgOutput = await runner.observe(ctx);
        updateTxHash(ctx, 'targetTxHash', trgOutput.txHash);
        updateTimestamp(ctx, 't3_finalize', trgOutput.finalizedAt);
        logObserve(ctx, trgOutput);

        await waitWithCountdown(10000, "Waiting for gas refund transaction...");
            
        logStep("gas refund");
        const gasRfdOutput = await runner.observeGasRefund(ctx);
        console.log(`Gas refund received: ${gasRfdOutput.xrpAmount} XRP (${gasRfdOutput.txHash})`);

        logStep("record")
        const record = createRunRecord(ctx, srcOutput, trgOutput, true, gasRfdOutput);
        logRecord(record);
        saveRecord(record);
    } catch (err) {
        console.log(err);
    } finally {
        if (ctx.cache.xrpl?.client) await ctx.cache.xrpl.client.disconnect();
    }
}

main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
});
