// ── Latency formatter ────────────────────────────────────────────────────────

/**
 * Format a millisecond latency value. If >= 10 000 ms (10 s), show in seconds.
 * Examples: 145 → "145ms", 12500 → "12.5s"
 */
export function formatLatencyMs(ms: number): string {
  if (ms >= 10_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${Math.round(ms)}ms`;
}
