"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { retryPreparationAction } from "@/app/(candidate)/applications/[applicationId]/actions";

import styles from "./ApplicationPreparationPanel.module.css";

export function ApplicationPreparationRetry({
  aggregateVersion,
  applicationId,
}: Readonly<{
  aggregateVersion: number;
  applicationId: string;
}>) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function retry() {
    setMessage("");
    startTransition(async () => {
      const result = await retryPreparationAction({
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
    <div className={styles.retryRow}>
      <div>
        <strong>Done?</strong>
        <p>RoleDawn rechecks your profile and continues.</p>
        {message ? <p className={styles.retryError} role="alert">{message}</p> : null}
      </div>
      <button disabled={isPending} onClick={retry} type="button">
        {isPending ? "Checking…" : "Check again"}
      </button>
    </div>
  );
}
