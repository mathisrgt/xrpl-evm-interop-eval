import { ChainAdapter, NetworkDirection } from "../types";
import { xrplAdapter as axelarXrplAdapter } from "../adapters/axelar/axelar.xrpl.adapter";
import { evmAdapter as axelarEvmAdapter } from "../adapters/axelar/axelar.xrpl-evm.adapter";
import { xrplAdapter as nearIntentsXrplAdapter } from "../adapters/near-intents/near-intents.xrpl.adapter";
import { baseAdapter as nearIntentsBaseAdapter } from "../adapters/near-intents/near-intents.base.adapter";
import { xrplAdapter as fassetXrplAdapter } from "../adapters/fasset/fasset.xrpl.adapter";
import { flareAdapter as fassetFlareAdapter } from "../adapters/fasset/fasset.flare.adapter";
import { Runner } from "./runner";

export type BridgeType = "axelar" | "near-intents" | "fasset";

export function createRunner(bridgeType: BridgeType, direction: NetworkDirection): Runner {
    let sourceAdapter: ChainAdapter;
    let targetAdapter: ChainAdapter;

    if (bridgeType === "axelar") {
        if (direction === "xrpl_to_xrpl_evm") {
            sourceAdapter = axelarXrplAdapter;
            targetAdapter = axelarEvmAdapter;
        } else if (direction === "xrpl_evm_to_xrpl") {
            sourceAdapter = axelarEvmAdapter;
            targetAdapter = axelarXrplAdapter;
        } else {
            throw new Error(`Invalid direction "${direction}" for Axelar bridge. Expected "xrpl_to_xrpl_evm" or "xrpl_evm_to_xrpl"`);
        }
    } else if (bridgeType === "near-intents") {
        if (direction === "xrpl_to_base") {
            sourceAdapter = nearIntentsXrplAdapter;
            targetAdapter = nearIntentsBaseAdapter;
        } else if (direction === "base_to_xrpl") {
            sourceAdapter = nearIntentsBaseAdapter;
            targetAdapter = nearIntentsXrplAdapter;
        } else {
            throw new Error(`Invalid direction "${direction}" for Near Intents bridge. Expected "xrpl_to_base" or "base_to_xrpl"`);
        }
    } else if (bridgeType === "fasset") {
        if (direction === "xrpl_to_flare") {
            sourceAdapter = fassetXrplAdapter;
            targetAdapter = fassetFlareAdapter;
        } else if (direction === "flare_to_xrpl") {
            sourceAdapter = fassetFlareAdapter;
            targetAdapter = fassetXrplAdapter;
        } else {
            throw new Error(`Invalid direction "${direction}" for FAsset bridge. Expected "xrpl_to_flare" or "flare_to_xrpl"`);
        }
    } else {
        throw new Error(`Unknown bridge type: ${bridgeType}`);
    }

    return new Runner(direction, sourceAdapter, targetAdapter);
}
