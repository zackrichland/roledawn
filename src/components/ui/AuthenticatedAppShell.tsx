"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { DawnMark } from "@/components/ui/Brand";
import styles from "./AuthenticatedAppShell.module.css";

export type AutopilotIndicator = "ON" | "OFF" | "PAUSED" | null;

const NAV = [
  { href: "/dashboard", label: "Home", match: (path: string) => path === "/dashboard" || path.startsWith("/applications") },
  { href: "/search", label: "Jobs", match: (path: string) => path.startsWith("/search") || path.startsWith("/saved") },
  { href: "/vault", label: "Profile", match: (path: string) => path.startsWith("/vault") },
] as const;

export function AuthenticatedAppShell({ actorLabel, children, signOutAction, hideAccount = false, autopilot = null }: Readonly<{
  actorLabel: string;
  children: React.ReactNode;
  signOutAction: () => Promise<void>;
  hideAccount?: boolean;
  autopilot?: AutopilotIndicator;
}>) {
  const pathname = usePathname();
  return (
    <div className={styles.appShell}>
      <header className={styles.header}>
        <div className={styles.inner}>
          <Link className={styles.brand} href="/dashboard" aria-label="RoleDawn home">
            <DawnMark />
            <span>RoleDawn</span>
          </Link>
          <nav aria-label="Main navigation" className={styles.navigation}>
            {NAV.map((item) => (
              <Link aria-current={item.match(pathname) ? "page" : undefined} href={item.href} key={item.href}>{item.label}</Link>
            ))}
          </nav>
          <div className={styles.end}>
            {autopilot ? (
              <Link className={styles.autopilot} data-state={autopilot} href="/dashboard#autopilot">
                <i aria-hidden="true" />
                {autopilot === "ON" ? "Autopilot on" : autopilot === "PAUSED" ? "Autopilot paused" : "Autopilot off"}
              </Link>
            ) : null}
            {!hideAccount ? (
              <details className={styles.account}>
                <summary aria-label="Account menu">{actorLabel.slice(0, 1).toUpperCase() || "·"}</summary>
                <div className={styles.accountMenu}>
                  <span>{actorLabel}</span>
                  <form action={signOutAction}><button type="submit">Sign out</button></form>
                </div>
              </details>
            ) : null}
          </div>
        </div>
      </header>
      <div className={styles.workspace}>{children}</div>
    </div>
  );
}
