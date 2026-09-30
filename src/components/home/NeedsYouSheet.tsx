"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { loadApplicationNeedAction } from "@/app/(candidate)/dashboard/need-actions";
import { ApplicationAutopilot } from "@/components/applications/ApplicationAutopilot";
import cardStyles from "@/components/applications/ApplicationAutopilot.module.css";
import { StopActions, type RetryTarget } from "@/components/applications/StopActions";
import type { ApplicationAutopilotView } from "@/domain/application-autopilot";
import type { ApplicationPresentation } from "@/domain/application-presentation";
import type { HomeApplication } from "@/server/home/home-data";

import styles from "./HomeView.module.css";

type Loaded = Readonly<{ state: "loading" }> | Readonly<{ state: "ready"; view: ApplicationAutopilotView | null }> | Readonly<{ state: "error"; message: string }>;

/**
 * Resolves whatever a stalled application needs (an emailed code, missing
 * answers, a retry, or the way to finish on the employer's site) without
 * leaving Home. It shows the same controls as the application page, so both
 * places behave identically.
 */
export function NeedsYouSheet({ application, presentation, refreshKey, onClose }: Readonly<{
  application: HomeApplication; presentation: ApplicationPresentation; refreshKey: string; onClose: () => void;
}>) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const panel = useRef<HTMLElement>(null);
  const id = application.applicationRouteKey;

  useEffect(() => {
    let live = true;
    loadApplicationNeedAction(id).then((result) => {
      if (live) setLoaded(result.ok ? { state: "ready", view: result.view } : { state: "error", message: result.message });
    }).catch(() => { if (live) setLoaded({ state: "error", message: "The connection dropped. Open the application to continue." }); });
    return () => { live = false; };
  }, [id, refreshKey]);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A send request speaks here only while it belongs to the current documents (or holds a live question or code).
  const belongsToCurrentFiles = Boolean(application.autopilot) || application.need !== null;
  const showSend = loaded.state === "ready" && loaded.view !== null && belongsToCurrentFiles;
  const guidance = presentation.guidance;
  const retryTarget: RetryTarget | null = application.intakeStatus === "FAILED" ? "IMPORT" : application.hasDocuments === false ? "WRITING" : null;

  return (
    <>
      <div aria-hidden="true" className={styles.sheetBackdrop} onClick={onClose} />
      <aside aria-labelledby="needs-you-title" aria-modal="true" className={styles.sheet} ref={panel} role="dialog" tabIndex={-1}>
        <header className={styles.sheetHead}>
          <div>
            <p className={styles.sheetEyebrow}>{application.company ?? "Application"}</p>
            <h2 id="needs-you-title">{application.role ?? "This application"}</h2>
            {application.location ? <p className={styles.sub}>{application.location}</p> : null}
          </div>
          <button aria-label="Close" className={styles.sheetClose} onClick={onClose} type="button">
            <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></svg>
          </button>
        </header>
        <div className={styles.sheetBody}>
          {loaded.state === "loading" ? <div aria-label="Loading" className={styles.sheetSkeleton} role="status" />
            : loaded.state === "error" ? <p className={styles.error} role="alert">{loaded.message}</p>
              : showSend && loaded.view ? (
                <ApplicationAutopilot
                  applicationId={id} aggregateVersion={1} canStart={false} employerUrl={application.sourceUrl} linkToApplication packetHash=""
                  revisionId={loaded.view.revisionId} summary={application.autopilot ?? null} view={loaded.view}
                />
              ) : guidance ? (
                <section aria-labelledby="needs-you-guidance" className={cardStyles.card}>
                  <h2 id="needs-you-guidance">{guidance.heading}</h2>
                  <p role="status">{guidance.happened}</p>
                  <p>{guidance.next}</p>
                  <StopActions
                    aggregateVersion={application.aggregateVersion} applicationId={id} employerUrl={application.sourceUrl}
                    guidance={guidance} linkToApplication retryTarget={retryTarget}
                  />
                </section>
              ) : <p className={styles.sheetDetail}>{presentation.detail}</p>}
        </div>
        <Link className={styles.sheetLink} href={`/applications/${id}`}>Open the full application
          <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14"><path d="m9 6 6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>
        </Link>
      </aside>
    </>
  );
}
