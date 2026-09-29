"use client";

import Link from "next/link";
import { useEffect } from "react";

import ui from "@/components/app/ui.module.css";

import styles from "./CandidateRouteState.module.css";

export default function CandidateError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1>Something didn&apos;t load.</h1>
        <p>Try again in a moment. Nothing was sent to an employer from this page.</p>
        <div className={styles.actions}>
          <button className={ui.primary} onClick={() => retry()} type="button">Try again</button>
          <Link className={ui.quiet} href="/dashboard">Go home</Link>
        </div>
      </section>
    </main>
  );
}
