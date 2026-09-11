"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * False while rendering on the server and during hydration, true afterwards.
 *
 * Needed wherever the first paint must not depend on something only the
 * browser knows — the reader's clock, or their stored theme. Doing this with
 * a useState flag set inside an effect causes a second render pass and is
 * flagged by React's lint rules; this reads the same value without one.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}
