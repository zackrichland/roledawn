"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { retryImportAction, retryPreparationAction } from "@/app/(candidate)/applications/[applicationId]/actions";
import ui from "@/components/app/ui.module.css";
import type { StopAction, StopGuidance } from "@/domain/application-stop-guidance";

import styles from "./StopGuidance.module.css";

/** What "Try again" runs for a state that has no live send: reading the posting again, or writing the documents again. */
export type RetryTarget = "IMPORT" | "WRITING";

/**
 * The actions for a stop that has no send card of its own (the job couldn't be
 * read, or writing stopped), plus its expandable details. It offers only what
 * the guidance allows: Try again exists only when trying again can help.
 */
export function StopActions({ applicationId, aggregateVersion, guidance, retryTarget, employerUrl, linkToApplication = false }: Readonly<{
  applicationId: string;
  aggregateVersion?: number;
  guidance: StopGuidance;
  retryTarget: RetryTarget | null;
  employerUrl?: string | null;
  /** In the Home side panel, actions that live on the application page link there. */
  linkToApplication?: boolean;
}>) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const command = useRef<string | null>(null);

  function retry() {
    if (!retryTarget || pending) return;
    setMessage("");
    startTransition(async () => {
      try {
        command.current ??= crypto.randomUUID();
        const result: Readonly<{ ok: boolean; message?: string }> = retryTarget === "IMPORT"
          ? await retryImportAction({ commandId: command.current, applicationId })
          : aggregateVersion === undefined ? { ok: false, message: "Open the application to try again." }
            : await retryPreparationAction({ commandId: command.current, applicationId, expectedAggregateVersion: aggregateVersion });
        if (!result.ok) {
          setMessage(result.message ?? "That didn’t start. Try again in a moment.");
          command.current = null;
          return;
        }
        router.refresh();
      } catch {
        setMessage("The connection was interrupted. Try again in a moment.");
        command.current = null;
      }
    });
  }

  function control(item: StopAction, primary: boolean) {
    const classes = `${primary ? ui.primary : ui.secondary} ${ui.small}`;
    switch (item.kind) {
      case "TRY_AGAIN":
        return retryTarget ? <button className={classes} disabled={pending} onClick={retry} type="button">{pending ? "Working…" : item.label}</button> : null;
      case "EMPLOYER_PAGE":
        return employerUrl ? <a className={classes} href={employerUrl} rel="noreferrer" target="_blank">{item.label} ↗</a> : null;
      case "OPEN_PROFILE":
        return item.href ? <Link className={classes} href={item.href}>{item.label}</Link> : null;
      case "OPEN_APPLICATION":
      case "REFRESH_FILES":
        return linkToApplication ? <Link className={classes} href={`/applications/${applicationId}`}>{item.label}</Link> : null;
      default: return null;
    }
  }

  const primary = control(guidance.primary, true);
  const secondary = guidance.secondary ? control(guidance.secondary, false) : null;
  return (
    <>
      {primary || secondary ? <div className={styles.actions}>{primary}{secondary}</div> : null}
      {message ? <p className={ui.noticeError} role="alert">{message}</p> : null}
      {guidance.code ? (
        <details className={styles.details}>
          <summary>Details</summary>
          <p>Reference: <code>{guidance.code}</code></p>
        </details>
      ) : null}
    </>
  );
}
