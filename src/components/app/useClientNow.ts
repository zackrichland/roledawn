"use client";

import { useSyncExternalStore } from "react";

const MINUTE = 60_000;

function subscribe(onChange: () => void): () => void {
  const timer = window.setInterval(onChange, MINUTE);
  return () => window.clearInterval(timer);
}

/**
 * The viewer's clock, to the minute. Null during server rendering and
 * hydration, so time-of-day text never mismatches between the server (UTC)
 * and the browser (the viewer's timezone).
 */
export function useClientNow(): Date | null {
  const minute = useSyncExternalStore(subscribe, () => Math.floor(Date.now() / MINUTE), () => null);
  return minute === null ? null : new Date(minute * MINUTE);
}
