import { useEffect, useRef, useCallback } from "react";

/**
 * Runs `onRefresh` on a repeating interval determined by `intervalSeconds`.
 * Pass "never" or null to disable auto-refresh entirely.
 *
 * Returns a `resetTimer` function: calling it cancels the current interval
 * and starts a fresh one (useful after a manual refresh).
 */
export function useAutoRefresh(
  intervalSeconds: number | "never" | null,
  onRefresh: () => void | Promise<void>,
): () => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRefreshRef = useRef(onRefresh);
  const inFlightRef = useRef(false);
  const generationRef = useRef(0);

  // Keep the callback ref up-to-date without restarting the interval
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback((generation: number) => {
    stop();

    if (intervalSeconds === null || intervalSeconds === "never") {
      return;
    }

    const ms = intervalSeconds * 1000;
    timerRef.current = setTimeout(async () => {
      timerRef.current = null;

      if (generation !== generationRef.current) {
        return;
      }

      if (inFlightRef.current) {
        start(generation);
        return;
      }

      inFlightRef.current = true;
      try {
        await onRefreshRef.current();
      } finally {
        inFlightRef.current = false;
        if (generation === generationRef.current) {
          start(generation);
        }
      }
    }, ms);
  }, [intervalSeconds, stop]);

  const resetTimer = useCallback(() => {
    generationRef.current += 1;
    start(generationRef.current);
  }, [start]);

  useEffect(() => {
    generationRef.current += 1;
    start(generationRef.current);

    return () => {
      generationRef.current += 1;
      stop();
    };
  }, [start, stop]);

  return resetTimer;
}
