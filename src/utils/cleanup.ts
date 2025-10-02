import type { Client as XrplClient } from "xrpl";
import type { Interface as ReadlineIF } from "node:readline";

export type Disposer = () => void | Promise<void>;

export class CleanupManager {
  private disposers: Disposer[] = [];
  private ran = false;

  /** Register any cleanup function (idempotent-safe). */
  add(fn?: Disposer | null) {
    if (fn) this.disposers.push(fn);
  }

  /** Run all registered disposers once, in reverse order. */
  async run() {
    if (this.ran) return;
    this.ran = true;
    for (let i = this.disposers.length - 1; i >= 0; i--) {
      try { await this.disposers[i](); } catch { }
    }
    this.disposers.length = 0;
  }

  /** XRPL: remove listeners, unsubscribe (optional), and disconnect. */
  trackXrpl(client: XrplClient, accountAddress?: string) {
    this.add(async () => {
      try { client.removeAllListeners(); } catch {}
      if (accountAddress) {
        try { await client.request({ command: "unsubscribe", accounts: [accountAddress] }); } catch {}
      }
      try { await client.disconnect(); } catch {}
    });
  }

  /** viem: unwatch function returned by watchBlockNumber / etc. */
  trackViemUnwatch(unwatch?: () => void) {
    this.add(() => { try { unwatch?.(); } catch {} });
  }

  /** Clear a timeout/interval; call `to.unref()` yourself if desired. */
  trackTimer(to?: NodeJS.Timeout) {
    this.add(() => { try { if (to) clearTimeout(to); } catch {} });
  }

  /** Abort a fetch / stream / long op. */
  trackAbortController(ctrl?: AbortController) {
    this.add(() => { try { ctrl?.abort(); } catch {} });
  }

  /** Debug what keeps the event loop alive (use ad-hoc). */
  static debugActiveHandles(label = "active-handles") {
    setTimeout(() => {
      // @ts-ignore – private API, useful for diagnostics only
      const hs = (process as any)._getActiveHandles?.() || [];
      // eslint-disable-next-line no-console
      console.log(`[${label}]`, hs.map((h: any) => h?.constructor?.name || typeof h));
    }, 100).unref();
  }
}
