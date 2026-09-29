import { randomUUID } from "node:crypto";
import Link from "next/link";

import ui from "@/components/app/ui.module.css";
import type {
  CandidateEvidenceReviewFormAction,
  CandidateEvidenceWorkspaceView,
} from "@/domain/candidate-evidence";

import { CandidateEvidenceCard } from "./CandidateEvidenceCard";
import styles from "./CandidateEvidence.module.css";

export function VerifiedFacts({
  action,
  evidence,
}: Readonly<{
  action: CandidateEvidenceReviewFormAction;
  evidence: CandidateEvidenceWorkspaceView;
}>) {
  if (evidence.status !== "READY") {
    return (
      <section className={styles.card}>
        <h2>{evidence.status === "RESUME_NEEDS_REVIEW" ? "Confirm your résumé first." : "Add your résumé first."}</h2>
        <p className={styles.muted}>Once your résumé text is confirmed, every line RoleDawn may use shows up here.</p>
        <Link className={ui.primary} href="/vault">Go to Résumé</Link>
      </section>
    );
  }

  return (
    <div className={styles.workspace}>
      <p className={styles.summary}>
        <strong>{evidence.counts.approved}</strong> in use
        {evidence.counts.restricted ? <> · <strong>{evidence.counts.restricted}</strong> letters only or hidden</> : null}
        {evidence.counts.rejected ? <> · <strong>{evidence.counts.rejected}</strong> hidden</> : null}
        {evidence.counts.needsReview ? <> · <strong>{evidence.counts.needsReview}</strong> waiting for you</> : null}
      </p>
      <div className={styles.list}>
        {evidence.items.map((item) => (
          <CandidateEvidenceCard
            action={action}
            commandId={randomUUID()}
            item={item}
            key={`${item.evidenceItemId}:${item.evidenceVersionId}`}
          />
        ))}
      </div>
      <p className={styles.muted}>Your name, contact details, and work eligibility never come from these lines; they come only from <Link href="/vault/answers">Answers</Link>.</p>
    </div>
  );
}
