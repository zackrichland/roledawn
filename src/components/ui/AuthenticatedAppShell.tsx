"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Brand } from "@/components/ui/Brand";
import { Icon, type IconName } from "@/components/ui/Icon";

import styles from "./AuthenticatedAppShell.module.css";

export type AuthenticatedDestination = "application-kits" | "resume";

type AuthenticatedAppShellProps = Readonly<{
  active: AuthenticatedDestination;
  actorLabel: string;
  children: React.ReactNode;
  signOutAction: () => Promise<void>;
}>;

type LiveNavigationItem = Readonly<{
  activeKey: AuthenticatedDestination;
  href: string;
  icon: IconName;
  label: string;
  status?: never;
}>;

type PlannedNavigationItem = Readonly<{
  activeKey?: never;
  href?: never;
  icon: IconName;
  label: string;
  status: "Soon";
}>;

type NavigationItem = LiveNavigationItem | PlannedNavigationItem;

const NAVIGATION_GROUPS: ReadonlyArray<Readonly<{
  heading: "Prepare" | "Apply" | "Interview";
  items: ReadonlyArray<NavigationItem>;
}>> = [
  {
    heading: "Prepare",
    items: [
      { activeKey: "application-kits", href: "/dashboard", icon: "applications", label: "Application Kits" },
      { activeKey: "resume", href: "/vault", icon: "document", label: "Résumé" },
      { icon: "inbox", label: "Cover Letters", status: "Soon" },
    ],
  },
  {
    heading: "Apply",
    items: [
      { icon: "spark", label: "Auto Apply", status: "Soon" },
      { icon: "search", label: "Search", status: "Soon" },
      { icon: "bookmark", label: "Saved", status: "Soon" },
    ],
  },
  {
    heading: "Interview",
    items: [
      { icon: "today", label: "Interview Buddy", status: "Soon" },
      { icon: "clock", label: "Mock Interviews", status: "Soon" },
    ],
  },
];

function initials(label: string): string {
  const parts = label.trim().split(/[\s._-]+/u).filter(Boolean);
  if (parts.length === 0) return "RD";
  return parts.slice(0, 2).map((part) => part[0]?.toLocaleUpperCase()).join("");
}

function Navigation({
  active,
  label,
  onNavigate,
}: {
  active: AuthenticatedDestination;
  label: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label={label} className={styles.navigation}>
      {NAVIGATION_GROUPS.map((group) => (
        <section className={styles.navigationGroup} key={group.heading}>
          <h2>{group.heading}</h2>
          <ul>
            {group.items.map((item) => (
              <li key={item.label}>
                {item.href ? (
                  <Link
                    aria-current={item.activeKey === active ? "page" : undefined}
                    className={styles.navigationItem}
                    href={item.href}
                    onClick={onNavigate}
                  >
                    <Icon name={item.icon} size={18} />
                    <span>{item.label}</span>
                  </Link>
                ) : (
                  <span aria-disabled="true" className={`${styles.navigationItem} ${styles.plannedItem}`}>
                    <Icon name={item.icon} size={18} />
                    <span>{item.label}</span>
                    <small>{item.status}</small>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

function Account({ actorLabel, signOutAction }: Pick<AuthenticatedAppShellProps, "actorLabel" | "signOutAction">) {
  return (
    <div className={styles.account}>
      <span aria-hidden="true" className={styles.avatar}>{initials(actorLabel)}</span>
      <span className={styles.accountName} title={actorLabel}>{actorLabel}</span>
      <form action={signOutAction}>
        <button type="submit">Sign out</button>
      </form>
    </div>
  );
}

export function AuthenticatedAppShell({
  active,
  actorLabel,
  children,
  signOutAction,
}: AuthenticatedAppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (menuOpen) {
      closeButtonRef.current?.focus();
      wasOpenRef.current = true;
      return;
    }

    if (wasOpenRef.current) {
      menuButtonRef.current?.focus();
      wasOpenRef.current = false;
    }
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        return;
      }

      if (event.key !== "Tab" || !mobileMenuRef.current) return;
      const focusable = Array.from(
        mobileMenuRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
      );
      const first = focusable.at(0);
      const last = focusable.at(-1);
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <div className={styles.appShell}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarBrand}><Brand href="/dashboard" /></div>
        <Navigation active={active} label="Main navigation" />
        <Account actorLabel={actorLabel} signOutAction={signOutAction} />
      </aside>

      <header className={styles.mobileHeader}>
        <Brand href="/dashboard" />
        <button
          aria-controls="mobile-navigation"
          aria-expanded={menuOpen}
          aria-label="Open navigation"
          onClick={() => setMenuOpen(true)}
          ref={menuButtonRef}
          type="button"
        >
          <Icon name="menu" size={21} />
        </button>
      </header>

      {menuOpen ? (
        <div className={styles.mobileMenuLayer}>
          <button
            aria-label="Close navigation"
            className={styles.mobileMenuBackdrop}
            onClick={() => setMenuOpen(false)}
            type="button"
          />
          <aside
            aria-label="Mobile navigation"
            aria-modal="true"
            className={styles.mobileMenu}
            id="mobile-navigation"
            ref={mobileMenuRef}
            role="dialog"
          >
            <div className={styles.mobileMenuHeader}>
              <Brand href="/dashboard" />
              <button aria-label="Close navigation" onClick={() => setMenuOpen(false)} ref={closeButtonRef} type="button">
                <Icon name="close" size={20} />
              </button>
            </div>
            <Navigation active={active} label="Mobile main navigation" onNavigate={() => setMenuOpen(false)} />
            <Account actorLabel={actorLabel} signOutAction={signOutAction} />
          </aside>
        </div>
      ) : null}

      <div className={styles.workspace}>{children}</div>
    </div>
  );
}
