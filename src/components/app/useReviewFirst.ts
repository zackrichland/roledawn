"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "roledawn.reviewFirst";
const listeners = new Set<() => void>();
let memory = false;

function read(): boolean {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === null ? memory : stored === "1";
  } catch {
    return memory;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === KEY) listener(); };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * "Let me review before it's sent": one remembered choice for every Apply
 * button on this device. Off means RoleDawn sends once documents pass checks.
 */
export function useReviewFirst(): readonly [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(subscribe, read, () => false);
  const set = useCallback((next: boolean) => {
    memory = next;
    try {
      window.localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // Private windows may block storage; the choice then lasts for this view only.
    }
    for (const listener of listeners) listener();
  }, []);
  return [value, set] as const;
}
