import Link from "next/link";

import ui from "@/components/app/ui.module.css";

import styles from "./CandidateRouteState.module.css";

export default function CandidateNotFound() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1>That page isn&apos;t here.</h1>
        <p>It may have been removed, or the link may be incomplete.</p>
        <div className={styles.actions}>
          <Link className={ui.primary} href="/dashboard">Go home</Link>
        </div>
      </section>
    </main>
  );
}
