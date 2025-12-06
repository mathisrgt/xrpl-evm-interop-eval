import { NETWORK_CONFIG } from "./network";
import { RunConfig, NetworkDirection } from "../types";

export function loadConfig(networkDirection: NetworkDirection, xrpAmount: number, nbRuns: number, bridgeName: string): RunConfig {
  const cfg: RunConfig = {
    networks: NETWORK_CONFIG,
    tag: `mainnet_${networkDirection}_${Date.now()}`,
    runs: nbRuns,
    xrpAmount,
    direction: networkDirection,
    bridgeName,
  };

  sanityCheck(cfg);

  return cfg;
}

function sanityCheck(cfg: RunConfig) {
  if (cfg.xrpAmount <= 0) throw new Error("The amount of XRP must be > 0");
  if (cfg.runs <= 0) throw new Error("The number of runs must be > 0");
}
