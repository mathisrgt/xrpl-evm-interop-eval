// time.ts

/**
 * Format an elapsed duration (in milliseconds) as "MMm SSs" or "HHh MMm SSs".
 *
 * @param ms - Duration in milliseconds.
 * @param opts.includeHours - If true, include hours in the output (default: false).
 * @param opts.pad - If true, pad minutes/seconds to 2 digits (e.g., 01m 05s).
 *
 * @example
 * formatElapsedMs(83_000)                // "1m 23s"
 * formatElapsedMs(3_900_000, { includeHours: true }) // "1h 05m 00s"
 */
export function formatElapsedMs(
  ms: number,
  opts: { includeHours?: boolean; pad?: boolean } = {}
): string {
  const totalSec = Math.floor(ms / 1000);
  let h = 0, m = 0, s = totalSec;

  if (opts.includeHours) {
    h = Math.floor(totalSec / 3600);
    m = Math.floor((totalSec % 3600) / 60);
    s = totalSec % 60;
  } else {
    m = Math.floor(totalSec / 60);
    s = totalSec % 60;
  }

  const pad = (n: number) => (opts.pad ? String(n).padStart(2, "0") : String(n));

  return opts.includeHours && h > 0
    ? `${pad(h)}h ${pad(m)}m ${pad(s)}s`
    : `${pad(m)}m ${pad(s)}s`;
}
