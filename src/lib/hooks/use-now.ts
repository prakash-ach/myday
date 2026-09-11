"use client";

import { useSyncExternalStore } from "react";

/**
 * The current time, refreshed on a shared interval.
 *
 * Modelled as an external store rather than state-plus-effect: the clock is
 * genuinely outside React, every subscriber shares one timer, and the timer
 * stops when the last component unmounts. Returns null on the server, since
 * the server's clock is not the reader's clock and rendering it would flash
 * the wrong time.
 */
function createClock(intervalMs: number) {
  let snapshot = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (timer === null) {
        timer = setInterval(() => {
          snapshot = Date.now();
          listeners.forEach((l) => l());
        }, intervalMs);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => null,
  };
}

const everySecond = createClock(1000);

export function useNow(): Date | null {
  const ms = useSyncExternalStore(
    everySecond.subscribe,
    everySecond.getSnapshot,
    everySecond.getServerSnapshot,
  );
  return ms === null ? null : new Date(ms);
}
