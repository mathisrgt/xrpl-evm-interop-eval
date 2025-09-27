import { xrplAdapter } from "./phases/adapters/xrpl.adapter";
import type { RunRecord } from "./types";
import { logConfig, logError, logObserve, logPrepare, logRecord, logStep, logSubmit, showMenu } from "./utils/logger";
import { evmAdapter } from "./phases/adapters/evm.adapter";
import { loadConfig } from "./runners/config";
import { createRunContext, createRunRecord, updateTimestamp, updateTxHash } from "./runners/context";
import { saveRecord } from "./utils/fsio";

async function main() {
    const cfg = await showMenu();
    
    logStep("configuration");
    logConfig(cfg);

    const ctx = createRunContext(cfg);

    try {
        logStep("prepare");
        updateTimestamp(ctx, 't0_prepare');
        await xrplAdapter.prepare(ctx);
        await evmAdapter.prepare(ctx);
        logPrepare(ctx);

        logStep("submit");
        updateTimestamp(ctx, 't1_submit');
        const srcOutput = await xrplAdapter.submit(ctx);
        updateTxHash(ctx, 'sourceTxHash', srcOutput.txHash);
        logSubmit(ctx, srcOutput);

        logStep("observe");
        updateTimestamp(ctx, 't2_observe', srcOutput.submittedAt);
        const trgOutput = await evmAdapter.observe(ctx);
        updateTxHash(ctx, 'targetTxHash', trgOutput.txHash);
        updateTimestamp(ctx, 't3_finalize', trgOutput.finalizedAt);
        logObserve(ctx, trgOutput);

        logStep("Record")
        const record = createRunRecord(ctx, srcOutput, trgOutput, true);
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
