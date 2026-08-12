"use client";

import Link from "next/link";

import { Brand } from "@/components/ui/Brand";
import { Icon } from "@/components/ui/Icon";

import styles from "./AuthenticatedHeader.module.css";

type AuthenticatedHeaderProps = Readonly<{
  active: "queue" | "vault";
  actorLabel: string;
  children?: React.ReactNode;
  signOutAction: () => Promise<void>;
}>;

type HeaderSearchProps = Readonly<{
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}>;

export function HeaderSearch({ label, onChange, placeholder, value }: HeaderSearchProps) {
  return (
    <label className={styles.headerSearch}>
      <span className="sr-only">{label}</span>
      <Icon name="search" size={18} />
      <input
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        value={value}
      />
    </label>
  );
}

export function AuthenticatedHeader({ active, actorLabel, children, signOutAction }: AuthenticatedHeaderProps) {
  return (
    <header className={`${styles.topbar} ${children ? "" : styles.noSearch}`}>
      <Brand href="/dashboard" />

      <nav aria-label="Primary navigation" className={styles.navigation}>
        <Link aria-current={active === "queue" ? "page" : undefined} href="/dashboard">
          Queue
        </Link>
        <Link aria-current={active === "vault" ? "page" : undefined} href="/vault">
          Career Vault
        </Link>
      </nav>

      {children}

      <div className={styles.account}>
        <span title={actorLabel}>{actorLabel}</span>
        <form action={signOutAction}>
          <button className={styles.textButton} type="submit">Sign out</button>
        </form>
      </div>
    </header>
  );
}
