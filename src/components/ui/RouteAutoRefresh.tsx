"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const REFRESH_INTERVAL_MS = 12_000;
const MAX_UNCHANGED_REFRESHES = 25;

export function RouteAutoRefresh({
  active,
  cycleKey,
  intervalMs = REFRESH_INTERVAL_MS,
  maxUnchangedRefreshes = MAX_UNCHANGED_REFRESHES,
}: Readonly<{
  active: boolean;
  cycleKey: string;
  intervalMs?: number;
  maxUnchangedRefreshes?: number;
}>) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;

    let refreshCount = 0;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (refreshCount >= maxUnchangedRefreshes) {
        window.clearInterval(intervalId);
        return;
      }

      refreshCount += 1;
      router.refresh();
    }, intervalMs);
    const onVisible = () => { if (document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => { window.clearInterval(intervalId); document.removeEventListener("visibilitychange", onVisible); };
  }, [active, cycleKey, router, intervalMs, maxUnchangedRefreshes]);

  return active ? (
    <span className="sr-only" role="status">
      This page refreshes while RoleDawn works on your application.
    </span>
  ) : null;
}
