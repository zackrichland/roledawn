"use client";

import { useCallback, useEffect, useReducer, type CSSProperties } from "react";
import {
  INITIAL_COMPANY_LOGO_LOAD, companyLogoAttemptSource, companyLogoRetryDelay, companyLogoSource, nextCompanyLogoLoad,
} from "@/domain/company-logo";
import styles from "./CompanyLogo.module.css";

/**
 * The image lives in its own component, keyed by its source, so its load state belongs to one employer's logo:
 * a poll or parent re-render with the same source keeps the logo showing, and a different source starts clean.
 */
function LogoImage({ source }: Readonly<{ source: string }>) {
  const [load, dispatch] = useReducer(nextCompanyLogoLoad, INITIAL_COMPANY_LOGO_LOAD);

  // A failed load is retried a bounded number of times with growing delays, then left as initials.
  useEffect(() => {
    if (load.phase !== "waiting") return undefined;
    const delay = companyLogoRetryDelay(load.attempt);
    if (delay === null) return undefined;
    const timer = window.setTimeout(() => dispatch("retry"), delay);
    return () => window.clearTimeout(timer);
  }, [load.phase, load.attempt]);

  const readServerRenderedImage = useCallback((image: HTMLImageElement | null) => {
    // A server-rendered image can finish (or fail) before React attaches its handlers.
    if (!image?.complete) return;
    dispatch(image.naturalWidth > 0 ? "loaded" : "errored");
  }, []);

  if (load.phase === "failed") return null;
  return (
    // The endpoint already serves a small first-party asset; no image optimizer or remote client request needed.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={readServerRenderedImage} alt="" className={styles.image} data-loaded={load.phase === "loaded" || undefined}
      src={companyLogoAttemptSource(source, load.attempt)} loading="lazy" decoding="async" referrerPolicy="no-referrer"
      onLoad={() => dispatch("loaded")} onError={() => dispatch("errored")}
    />
  );
}

export function CompanyLogo({ name, postingUrl, className, style }: Readonly<{
  name: string | null; postingUrl: string | null | undefined; className: string; style?: CSSProperties;
}>) {
  const source = companyLogoSource(postingUrl);
  return <span aria-hidden="true" className={`${className} ${styles.frame}`} style={style}>
    {(name ?? "").trim().slice(0, 1).toUpperCase() || "·"}
    {source ? <LogoImage key={source} source={source} /> : null}
  </span>;
}
