"use client";

import { useCallback, useState, type CSSProperties } from "react";
import { companyLogoSource } from "@/domain/company-logo";
import styles from "./CompanyLogo.module.css";

export function CompanyLogo({ name, postingUrl, className, style }: Readonly<{
  name: string | null; postingUrl: string | null | undefined; className: string; style?: CSSProperties;
}>) {
  const source = companyLogoSource(postingUrl);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const readCachedImage = useCallback((image: HTMLImageElement | null) => {
    // A cached image can finish before React attaches its load handler.
    if (source && image?.complete && image.naturalWidth > 0) setLoadedSource(source);
  }, [source]);
  return <span aria-hidden="true" className={`${className} ${styles.frame}`} style={style}>
    {(name ?? "").trim().slice(0, 1).toUpperCase() || "·"}
    {source && failedSource !== source ? (
      // The endpoint already caches a small first-party asset; no image optimizer or remote client request needed.
      // eslint-disable-next-line @next/next/no-img-element
      <img ref={readCachedImage} alt="" className={styles.image} data-loaded={loadedSource === source || undefined} src={source} loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => setLoadedSource(source)} onError={() => setFailedSource(source)} />
    ) : null}
  </span>;
}
