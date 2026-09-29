"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { disconnectMailboxAction } from "@/app/(candidate)/vault/preferences/mailbox-actions";
import ui from "@/components/app/ui.module.css";
import type { CandidateMailboxConnection } from "@/server/mailbox/mailbox-connections";

import styles from "./Profile.module.css";

const STATUS: Readonly<Record<string, Readonly<{ tone: "success" | "error" | "info"; text: string }>>> = {
  connected: { tone: "success", text: "Gmail is connected. RoleDawn will read employer codes while it sends." },
  denied: { tone: "info", text: "Gmail wasn’t connected. You can type codes yourself when an employer sends one." },
  scope: { tone: "error", text: "Google didn’t grant read access. Connect again and allow RoleDawn to read email." },
  failed: { tone: "error", text: "Gmail couldn’t be connected. Try again." },
  unavailable: { tone: "info", text: "Automatic codes aren’t set up on this server yet." },
};

export function MailboxConnectionCard({ connection, available, status }: Readonly<{ connection: CandidateMailboxConnection | null; available: boolean; status?: string }>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const banner = status ? STATUS[status] : undefined;
  function disconnect() {
    setMessage("");
    startTransition(async () => {
      const result = await disconnectMailboxAction();
      if (!result.ok) { setMessage(result.message); return; }
      router.replace("/vault/preferences");
      router.refresh();
    });
  }
  return (
    <section className={styles.card} aria-labelledby="mailbox-heading">
      <div className={styles.cardHead}>
        <div>
          <h2 id="mailbox-heading">Verification codes</h2>
          <p>Some employers email you a code before they accept an application. With Gmail connected, RoleDawn reads that code while it sends, so applications don’t wait on you.</p>
        </div>
      </div>
      {banner ? <p className={banner.tone === "error" ? ui.noticeError : banner.tone === "success" ? ui.noticeSuccess : ui.noticeInfo} role="status">{banner.text}</p> : null}
      {connection ? <>
        <p className={styles.muted}>
          Connected as <strong>{connection.emailAddress}</strong>
          {/* Local time differs between the server render and the browser. */}
          {connection.lastUsedAt ? <span suppressHydrationWarning>{` · last read a code ${new Date(connection.lastUsedAt).toLocaleString()}`}</span> : null}
        </p>
        {connection.lastError ? <p className={ui.noticeError}>The last read failed ({connection.lastError.toLowerCase().replaceAll("_", " ")}). Connect Gmail again if this continues.</p> : null}
        <div className={styles.actions}>
          <a className={ui.secondary} href="/api/mailbox/google/connect">Reconnect</a>
          <button className={ui.quiet} disabled={pending} onClick={disconnect} type="button">{pending ? "Disconnecting…" : "Disconnect Gmail"}</button>
        </div>
      </> : available ? (
        <div className={styles.actions}>
          <a className={ui.primary} href="/api/mailbox/google/connect">Connect Gmail</a>
        </div>
      ) : <p className={styles.muted}>Automatic codes aren’t set up on this server yet, so you’ll type codes yourself when asked.</p>}
      <p className={styles.muted}>Read-only. RoleDawn searches only for employer verification-code emails, and only while it’s sending one of your applications. It can’t send, delete or change email. Disconnect any time.</p>
      {message ? <p className={ui.noticeError} role="alert">{message}</p> : null}
    </section>
  );
}
