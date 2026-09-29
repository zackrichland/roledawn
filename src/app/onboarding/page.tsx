import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/app/dashboard/sign-out-action";
import ui from "@/components/app/ui.module.css";
import { SearchGoals } from "@/components/onboarding/SearchGoals";
import { AnswersForm } from "@/components/profile/AnswersForm";
import { InterviewChat } from "@/components/profile/InterviewChat";
import { ResumePanel } from "@/components/profile/ResumePanel";
import { Brand } from "@/components/ui/Brand";
import { RouteAutoRefresh } from "@/components/ui/RouteAutoRefresh";
import type { OnboardingMissingItemCode } from "@/domain/candidate-onboarding";
import { readSupabasePublicConfig } from "@/lib/supabase/config";
import { requireActor } from "@/server/auth/session";
import { readSingleAccountConfig } from "@/server/auth/single-account-policy";
import { getActiveInterview } from "@/server/candidate/interview";
import { getCandidateKnowledge } from "@/server/candidate/knowledge";
import { getCandidateOnboarding } from "@/server/candidate/onboarding";
import { isResumeConfirmed, loadResumeState } from "@/server/profile/resume-state";
import { getCandidateProfile } from "@/server/vault/candidate-profile";

import { completeCandidateOnboardingAction, saveCandidateSearchProfileAction } from "./actions";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Set up RoleDawn",
  description: "Your résumé, the basics, what you want, and your best stories.",
};

type Step = "resume" | "basics" | "goals" | "stories" | "finish";
const STEPS: readonly Readonly<{ key: Step; label: string }>[] = [
  { key: "resume", label: "Résumé" },
  { key: "basics", label: "Basics" },
  { key: "goals", label: "What you want" },
  { key: "stories", label: "Your stories" },
];

const BASICS: ReadonlySet<OnboardingMissingItemCode> = new Set(["GIVEN_NAME", "FAMILY_NAME", "LEGAL_NAME", "APPLICATION_EMAIL", "PHONE", "LOCATION"]);
const MISSING_LABEL: Readonly<Record<OnboardingMissingItemCode, string>> = {
  RESUME: "your résumé",
  GIVEN_NAME: "first name",
  FAMILY_NAME: "last name",
  LEGAL_NAME: "full legal name",
  APPLICATION_EMAIL: "email",
  PHONE: "phone",
  LOCATION: "city, state, and country",
  SEARCH_RULES: "what you're looking for",
};

const COPY: Readonly<Record<Step, Readonly<{ title: string; lede: string }>>> = {
  resume: { title: "Start with your résumé.", lede: "RoleDawn tailors it for every job. You check the text once, and it stays yours." },
  basics: { title: "The basics every application asks.", lede: "Answer once. RoleDawn fills them exactly as you write them, and asks when something's missing." },
  goals: { title: "What are you looking for?", lede: "Autopilot only applies to jobs that fit. Change this any time." },
  stories: { title: "Now, the part that gets interviews.", lede: "A short conversation about your best work. It's optional, and it's the biggest upgrade to your cover letters." },
  finish: { title: "You're set.", lede: "Paste any job link on Home and RoleDawn prepares a tailored application. Turn on autopilot when you're ready." },
};

function isStep(value: unknown): value is Step {
  return value === "resume" || value === "basics" || value === "goals" || value === "stories" || value === "finish";
}

export default async function OnboardingPage({ searchParams }: Readonly<{
  searchParams: Promise<{ step?: string | string[]; error?: string | string[] }>;
}>) {
  if (!readSupabasePublicConfig()) {
    return (
      <main className="setup-page">
        <section className="setup-card">
          <span className="setup-card__eyebrow">Setup required</span>
          <h1>Connect RoleDawn to Supabase.</h1>
          <p>Add the public Supabase URL and publishable key, then reload.</p>
        </section>
      </main>
    );
  }

  const actor = await requireActor("/onboarding");
  const onboarding = await getCandidateOnboarding(actor);
  if (onboarding.readiness.candidateStatus !== "ONBOARDING") redirect("/dashboard");
  const params = await searchParams;
  const missing = new Set(onboarding.readiness.missingItems);
  const basicsMissing = onboarding.readiness.missingItems.filter((code) => BASICS.has(code));
  const [resumeState, profile, knowledge, interview] = await Promise.all([
    loadResumeState(actor),
    getCandidateProfile(actor),
    getCandidateKnowledge(actor).catch(() => null),
    getActiveInterview().catch(() => null),
  ]);
  const approvedStories = knowledge?.stories.filter((story) => story.disposition === "APPROVED").length ?? 0;
  const resumeConfirmed = !missing.has("RESUME") && isResumeConfirmed(resumeState.confirmation);

  const fallback: Step = !resumeConfirmed ? "resume" : basicsMissing.length ? "basics" : missing.has("SEARCH_RULES") ? "goals" : approvedStories ? "finish" : "stories";
  const requested = Array.isArray(params.step) ? params.step[0] : params.step;
  const step: Step = isStep(requested) ? requested : fallback;
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  const complete: Readonly<Record<Step, boolean>> = {
    resume: resumeConfirmed,
    basics: basicsMissing.length === 0,
    goals: !missing.has("SEARCH_RULES"),
    stories: approvedStories > 0,
    finish: onboarding.readiness.missingItems.length === 0,
  };
  const stepIndex = STEPS.findIndex((entry) => entry.key === step);
  const roles = (knowledge?.career.profile?.content.positions ?? []).map((position) => ({
    positionKey: position.positionKey, title: position.title, organization: position.organization,
  }));

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Brand href="/onboarding" />
        {!readSingleAccountConfig() ? <form action={signOut}><button className={`${ui.quiet} ${ui.small}`} type="submit">Sign out</button></form> : null}
      </header>

      <div className={styles.column}>
        <nav aria-label="Setup steps" className={styles.steps}>
          {STEPS.map((entry, index) => (
            <Link
              aria-current={entry.key === step ? "step" : undefined}
              data-done={complete[entry.key]}
              href={`/onboarding?step=${entry.key}`}
              key={entry.key}
            >
              <span className={styles.stepBar} />
              <span className={styles.stepLabel}>{complete[entry.key] ? "✓ " : `${index + 1}. `}{entry.label}</span>
            </Link>
          ))}
        </nav>

        <header className={styles.intro}>
          {stepIndex >= 0 ? <span className={ui.eyebrow}>Step {stepIndex + 1} of {STEPS.length}{step === "stories" ? " · optional" : ""}</span> : null}
          <h1 className={styles.title}>{COPY[step].title}</h1>
          <p className={styles.lede}>{COPY[step].lede}</p>
        </header>

        {step === "resume" ? (
          <>
            <RouteAutoRefresh
              active={resumeState.vault.status === "uploading" || resumeState.confirmation?.careerProfile === "ORGANIZING"}
              cycleKey={`${resumeState.vault.status}:${resumeState.confirmation?.careerProfile ?? ""}`}
              intervalMs={5_000}
            />
            <ResumePanel
              confirmation={resumeState.confirmation}
              key={resumeState.vault.document?.documentVersionId ?? resumeState.vault.status}
              nextHref="/onboarding?step=basics"
              vault={resumeState.vault}
            />
          </>
        ) : null}

        {step === "basics" ? (
          <>
            <AnswersForm accountEmail={profile.accountEmail} facts={profile.facts} only={["name", "contact", "location", "eligibility"]} />
            <div className={styles.next}>
              {basicsMissing.length ? (
                <p className={ui.hint}>Still needed: {basicsMissing.map((code) => MISSING_LABEL[code]).join(", ")}.</p>
              ) : <p className={ui.hint}>Everything else (salary, start date, voluntary questions) lives in Profile → Answers.</p>}
              <Link aria-disabled={basicsMissing.length > 0} className={basicsMissing.length ? ui.secondary : ui.cta} href="/onboarding?step=goals">Continue</Link>
            </div>
          </>
        ) : null}

        {step === "goals" ? (
          <section className={styles.card}>
            <SearchGoals
              action={saveCandidateSearchProfileAction}
              commandId={randomUUID()}
              continueHref="/onboarding?step=stories"
              key={onboarding.searchProfile.aggregateVersion ?? "new"}
              profile={onboarding.searchProfile}
            />
          </section>
        ) : null}

        {step === "stories" ? (
          <>
            <InterviewChat
              key={interview ? `${interview.sessionId}:${interview.status}` : "none"}
              roles={roles}
              view={interview && interview.status !== "ABANDONED" ? {
                sessionId: interview.sessionId,
                status: interview.status,
                turnCount: interview.turnCount,
                focusPositionKey: interview.state.focusPositionKey,
                coveredPositionKeys: interview.state.coveredPositionKeys,
                turns: interview.turns.map((turn) => ({ sequenceNumber: turn.sequenceNumber, speaker: turn.speaker, content: turn.content })),
              } : null}
              waitingStories={knowledge?.stories.filter((story) => story.disposition === "PROPOSED").length ?? 0}
            />
            <div className={styles.next}>
              <p className={ui.hint}>{approvedStories ? `${approvedStories} ${approvedStories === 1 ? "story" : "stories"} saved.` : "You can do this later from Profile → Stories."}</p>
              <Link className={approvedStories ? ui.cta : ui.secondary} href="/onboarding?step=finish">{approvedStories ? "Continue" : "Skip for now"}</Link>
            </div>
          </>
        ) : null}

        {step === "finish" ? (
          <section className={styles.card}>
            <ul className={styles.summary}>
              {STEPS.map((entry) => (
                <li data-done={complete[entry.key]} key={entry.key}>
                  <span aria-hidden="true">{complete[entry.key] ? "✓" : "–"}</span>
                  <Link href={`/onboarding?step=${entry.key}`}>{entry.label}</Link>
                  <small>{entry.key === "stories" ? (approvedStories ? `${approvedStories} approved` : "Optional") : complete[entry.key] ? "Done" : "Needs you"}</small>
                </li>
              ))}
            </ul>
            {error ? <p className={ui.noticeError} role="alert">{error}</p> : null}
            {complete.finish ? (
              <form action={completeCandidateOnboardingAction}>
                <input name="commandId" type="hidden" value={randomUUID()} />
                <button className={ui.cta} type="submit">Open RoleDawn</button>
              </form>
            ) : (
              <p className={ui.noticeInfo}>
                Finish {onboarding.readiness.missingItems.map((code) => MISSING_LABEL[code]).join(", ")} to continue.
              </p>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}
