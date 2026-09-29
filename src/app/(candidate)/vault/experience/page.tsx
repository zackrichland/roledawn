import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import ui from "@/components/app/ui.module.css";
import { CareerProfileEditor } from "@/components/profile/CareerProfileEditor";
import { OrganizeExperience } from "@/components/profile/OrganizeExperience";
import styles from "@/components/profile/Profile.module.css";
import { RouteAutoRefresh } from "@/components/ui/RouteAutoRefresh";
import { emptyCareerProfile } from "@/domain/career-profile";
import { getOptionalActor } from "@/server/auth/session";
import { getCandidateKnowledge } from "@/server/candidate/knowledge";
import { getCandidateEvidenceWorkspace } from "@/server/vault/candidate-evidence";

export const metadata: Metadata = {
  title: "Experience",
  description: "Roles, dates, education, and skills exactly as your résumé prints them.",
};

export default async function ExperiencePage({ searchParams }: Readonly<{ searchParams: Promise<{ manual?: string }> }>) {
  const actor = await getOptionalActor();
  if (!actor) redirect("/login?next=/vault/experience");
  const [knowledge, evidence, params] = await Promise.all([
    getCandidateKnowledge(actor),
    getCandidateEvidenceWorkspace(actor).catch(() => null),
    searchParams,
  ]);
  const career = knowledge.career;
  const organizing = career.extractionStatus === "REQUESTED";
  const linesByKey = Object.fromEntries((evidence?.items ?? [])
    .filter((item) => item.reviewStatus === "VERIFIED" && item.usagePolicy !== "DO_NOT_USE")
    .map((item) => [item.evidenceKey, item.claimText]));
  const resumeConfirmed = Boolean(evidence && evidence.status === "READY" && evidence.counts.approved > 0);

  if (career.profile && !organizing) {
    return (
      <CareerProfileEditor
        aggregateVersion={career.profile.aggregateVersion}
        content={career.profile.content}
        extractedFromResume={career.profile.sourceKind === "RESUME_EXTRACTION"}
        key={career.profile.versionId}
        linesByKey={linesByKey}
      />
    );
  }

  if (organizing) {
    return (
      <section className={styles.card} aria-live="polite">
        <RouteAutoRefresh active cycleKey={`${career.extractionStatus}:${career.profile?.versionId ?? ""}`} intervalMs={4_000} />
        <div className={styles.cardHead}>
          <div>
            <h2><span className={styles.pulse} /> Organizing your experience…</h2>
            <p>Reading your roles, dates, education, and skills from your résumé. This usually takes under a minute.</p>
          </div>
        </div>
      </section>
    );
  }

  if (params.manual === "1") {
    return <CareerProfileEditor aggregateVersion={career.aggregateVersion} content={emptyCareerProfile()} extractedFromResume={false} linesByKey={linesByKey} />;
  }

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2>{career.extractionStatus === "FAILED" ? "That didn't work this time." : resumeConfirmed ? "Organize your experience" : "Start with your résumé"}</h2>
          <p>
            {career.extractionStatus === "FAILED"
              ? "RoleDawn couldn't organize your résumé automatically. Try again, or add your roles yourself. It takes a few minutes."
              : resumeConfirmed
                ? "RoleDawn reads your confirmed résumé and lists each role with its dates, so every tailored résumé prints them exactly right."
                : "Once your résumé is confirmed, RoleDawn lists your roles, dates, education, and skills here for you to check."}
          </p>
        </div>
      </div>
      <div className={styles.actions}>
        {resumeConfirmed ? <OrganizeExperience label={career.extractionStatus === "FAILED" ? "Try again" : "Organize it for me"} /> : <Link className={ui.primary} href="/vault">Confirm my résumé</Link>}
        <Link className={ui.quiet} href="/vault/experience?manual=1">Add roles myself</Link>
      </div>
    </section>
  );
}
