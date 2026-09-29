"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { refreshApplicationFilesAction } from "@/app/(candidate)/applications/[applicationId]/actions";

import styles from "./ApplicationPreparationPanel.module.css";

export function ApplicationFilesRefresh({
  aggregateVersion,
  applicationId,
}: Readonly<{
  aggregateVersion: number;
  applicationId: string;
}>) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function refreshFiles() {
    setMessage("");
    startTransition(async () => {
      const result = await refreshApplicationFilesAction({
        commandId: crypto.randomUUID(),
        applicationId,
        expectedAggregateVersion: aggregateVersion,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section
      className={`${styles.panel} ${styles.panelAttention}`}
      aria-labelledby="application-files-refresh-heading"
    >
      <header className={styles.header}>
        <span className={`${styles.statusDot} ${styles.statusDotAttention}`} aria-hidden="true" />
        <div>
          <span className={styles.eyebrow}>Your profile changed</span>
          <h2 id="application-files-refresh-heading">Rewrite with your latest profile?</h2>
          <p>
            These documents were written before your last profile update. RoleDawn won&apos;t send them until they&apos;re rewritten.
          </p>
        </div>
      </header>
      <div className={styles.retryRow}>
        <div>
          <strong>Your current documents stay here meanwhile.</strong>
          <p>They&apos;re replaced only after the new ones pass every check.</p>
          {message ? <p className={styles.retryError} role="alert">{message}</p> : null}
        </div>
        <button disabled={isPending} onClick={refreshFiles} type="button">
          {isPending ? "Starting…" : "Rewrite documents"}
        </button>
      </div>
    </section>
  );
}
