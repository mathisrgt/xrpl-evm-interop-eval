import { NETWORK_CONFIG } from "./network";
import { RunConfig, NetworkMode, NetworkDirection } from "../types";

export function loadConfig(networkMode: NetworkMode, networkDirection: NetworkDirection, xrpAmount: number, nbRuns: number): RunConfig {
  const cfg: RunConfig = {
    networks: NETWORK_CONFIG[networkMode],
    tag: `${networkMode}_${networkDirection}_${Date.now()}`,
    runs: nbRuns,
    xrpAmount,
    direction: networkDirection,
  };
  
  sanityCheck(cfg);

  return cfg;
}

function sanityCheck(cfg: RunConfig) {
  if (cfg.xrpAmount <= 0) throw new Error("The amount of XRP must be > 0");
  if (cfg.runs <= 0) throw new Error("The number of runs must be > 0");
}
