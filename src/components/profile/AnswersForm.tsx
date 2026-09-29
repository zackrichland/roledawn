"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import { saveCandidateAnswersAction } from "@/app/vault/profile-actions";
import ui from "@/components/app/ui.module.css";
import {
  candidateFactDefinition,
  DECLINE_TO_SELF_IDENTIFY,
  type CandidateFactKey,
  type CandidateProfileFactView,
} from "@/domain/candidate-profile";

import styles from "./Profile.module.css";
import answers from "./AnswersForm.module.css";

type Kind = "text" | "email" | "tel" | "url" | "country" | "tri" | "choice";
type Field = Readonly<{ key: CandidateFactKey; kind: Kind; label?: string; placeholder?: string; hint?: string; optional?: boolean; wide?: boolean }>;
type Section = Readonly<{ id: string; title: string; detail: string; fields: readonly Field[] }>;

const ANSWER_SECTIONS: readonly Section[] = [
  {
    id: "name",
    title: "Your name",
    detail: "Exactly as employers should see it. RoleDawn never splits or guesses a name.",
    fields: [
      { key: "identity.given_name", kind: "text" },
      { key: "identity.family_name", kind: "text" },
      { key: "identity.legal_name", kind: "text", hint: "For forms that ask for your full legal name." },
      { key: "identity.preferred_name", kind: "text", optional: true },
      { key: "identity.pronouns", kind: "text", optional: true },
    ],
  },
  {
    id: "contact",
    title: "Contact",
    detail: "How employers reach you. This goes on your résumé and every form.",
    fields: [
      { key: "contact.application_email", kind: "email" },
      { key: "contact.phone", kind: "tel", placeholder: "(202) 555-0123", hint: "U.S. numbers need no country code." },
      { key: "contact.linkedin_url", kind: "url", placeholder: "https://www.linkedin.com/in/your-name", optional: true },
      { key: "contact.website_url", kind: "url", placeholder: "https://", optional: true },
    ],
  },
  {
    id: "location",
    title: "Where you live",
    detail: "City and state go on your résumé. The street address is only for forms that require it.",
    fields: [
      { key: "location.city", kind: "text" },
      { key: "location.region", kind: "text", placeholder: "e.g. VA" },
      { key: "location.country_code", kind: "country" },
      { key: "location.postal_code", kind: "text", optional: true },
      { key: "contact.address_line1", kind: "text", optional: true },
      { key: "contact.address_line2", kind: "text", optional: true },
    ],
  },
  {
    id: "eligibility",
    title: "Work eligibility",
    detail: "Almost every application asks. RoleDawn answers exactly what you choose here, and asks you when you're not sure.",
    fields: [
      { key: "work_authorization.us.authorized", kind: "tri", label: "Are you legally authorized to work in the United States?", wide: true },
      { key: "work_authorization.us.sponsorship_required", kind: "tri", label: "Will you now or in the future need visa sponsorship to work in the U.S.?", wide: true },
    ],
  },
  {
    id: "common",
    title: "The usual questions",
    detail: "Answer once and RoleDawn uses the same answer everywhere it's asked.",
    fields: [
      { key: "availability.start_date", kind: "text" },
      { key: "preferences.willing_to_relocate", kind: "choice" },
      { key: "education.highest_degree", kind: "choice" },
      { key: "application.heard_about", kind: "text" },
      { key: "compensation.expected_salary", kind: "text", optional: true, wide: true },
    ],
  },
  {
    id: "self-id",
    title: "Voluntary self-identification",
    detail: "U.S. employers must let you decline these, and your answers can't affect hiring. RoleDawn declines on your behalf unless you choose otherwise.",
    fields: [
      { key: "self_id.gender", kind: "choice" },
      { key: "self_id.hispanic_latino", kind: "choice" },
      { key: "self_id.race_ethnicity", kind: "choice", wide: true },
      { key: "self_id.veteran_status", kind: "choice", wide: true },
      { key: "self_id.disability_status", kind: "choice", wide: true },
    ],
  },
];

function rawValue(fact: CandidateProfileFactView | undefined): string {
  if (!fact) return "";
  if (fact.value === true) return "yes";
  if (fact.value === false) return "no";
  return String(fact.value);
}

function SectionForm({ section, saved, accountEmail }: Readonly<{
  section: Section;
  saved: ReadonlyMap<CandidateFactKey, CandidateProfileFactView>;
  accountEmail: string | null;
}>) {
  const router = useRouter();
  const initial = useMemo(() => Object.fromEntries(section.fields.map((field) => {
    const fact = saved.get(field.key);
    const definition = candidateFactDefinition(field.key);
    const fallback = field.key === "contact.application_email" ? accountEmail ?? "" : definition.suggestedValue ?? "";
    return [field.key, fact ? rawValue(fact) : fallback];
  })) as Record<string, string>, [section, saved, accountEmail]);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [notice, setNotice] = useState<Readonly<{ ok: boolean; text: string }> | null>(null);
  const [pending, startTransition] = useTransition();
  const commands = useRef(new Map<string, { value: string; id: string }>());

  const changed = section.fields.filter((field) => {
    const value = (values[field.key] ?? "").trim();
    return value !== "" && value !== rawValue(saved.get(field.key));
  });
  const unsavedSuggestions = changed.filter((field) => !saved.has(field.key));

  function save() {
    const entries = changed.map((field) => {
      const value = values[field.key].trim();
      const existing = commands.current.get(field.key);
      const id = existing?.value === value ? existing.id : crypto.randomUUID();
      commands.current.set(field.key, { value, id });
      return { key: field.key, rawValue: value, commandId: id, expectedAggregateVersion: saved.get(field.key)?.aggregateVersion ?? null };
    });
    setNotice(null);
    startTransition(async () => {
      const result = await saveCandidateAnswersAction(entries);
      setErrors(result.errors);
      for (const key of result.saved) commands.current.delete(key);
      setNotice(result.message ? { ok: false, text: result.message } : { ok: true, text: "Saved." });
      router.refresh();
    });
  }

  return (
    <section className={styles.card} aria-labelledby={`${section.id}-heading`}>
      <div className={styles.cardHead}>
        <div>
          <h2 id={`${section.id}-heading`}>{section.title}</h2>
          <p>{section.detail}</p>
        </div>
      </div>
      <div className={answers.grid}>
        {section.fields.map((field) => {
          const definition = candidateFactDefinition(field.key);
          const id = `answer-${field.key.replaceAll(".", "-")}`;
          const value = values[field.key] ?? "";
          const error = errors[field.key];
          const isSaved = saved.has(field.key);
          const label = field.label ?? definition.label;
          const hint = field.hint ?? definition.help;
          const set = (next: string) => { setValues((current) => ({ ...current, [field.key]: next })); setNotice(null); };
          return (
            <div className={`${answers.field} ${field.wide || field.kind === "tri" ? answers.wide : ""}`} key={field.key}>
              <div className={answers.labelRow}>
                <label htmlFor={field.kind === "tri" ? undefined : id} id={`${id}-label`}>
                  {label}{field.optional ? <span className={answers.optional}>optional</span> : null}
                </label>
                {!isSaved && value ? <span className={answers.unsaved}>Not saved</span> : null}
                {isSaved && saved.get(field.key)?.value === "unsure" ? <span className={answers.unsaved}>Undecided</span> : null}
              </div>
              {field.kind === "tri" ? (
                <div aria-labelledby={`${id}-label`} className={answers.segmented} role="radiogroup">
                  {[["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"]].map(([option, text]) => (
                    <button aria-checked={value === option} key={option} onClick={() => set(option)} role="radio" type="button">{text}</button>
                  ))}
                </div>
              ) : field.kind === "choice" ? (
                <select aria-invalid={Boolean(error)} className={ui.select} id={id} onChange={(event) => set(event.target.value)} value={value}>
                  <option value="">Choose…</option>
                  {(definition.choices ?? []).map((choice) => <option key={choice} value={choice}>{choice}</option>)}
                </select>
              ) : field.kind === "country" ? (
                <select aria-invalid={Boolean(error)} className={ui.select} id={id} onChange={(event) => set(event.target.value)} value={value}>
                  <option value="">Choose…</option>
                  <option value="US">United States</option>
                  <option value="CA">Canada</option>
                </select>
              ) : (
                <input
                  aria-invalid={Boolean(error)}
                  autoComplete={field.kind === "email" ? "email" : field.kind === "tel" ? "tel" : undefined}
                  className={ui.input}
                  id={id}
                  inputMode={field.kind === "tel" ? "tel" : undefined}
                  onChange={(event) => set(event.target.value)}
                  placeholder={field.placeholder ?? definition.placeholder}
                  type={field.kind === "tel" ? "tel" : field.kind === "email" ? "email" : field.kind === "url" ? "url" : "text"}
                  value={value}
                />
              )}
              {error ? <span className={answers.error} role="alert">{error}</span> : hint ? <span className={ui.hint}>{hint}</span> : null}
            </div>
          );
        })}
      </div>
      <div className={answers.footer}>
        <p className={notice ? (notice.ok ? answers.ok : answers.error) : ui.hint} role="status">
          {notice?.text ?? (unsavedSuggestions.length > 0 && section.id === "self-id"
            ? `Suggested: “${DECLINE_TO_SELF_IDENTIFY}”. Save to use it.`
            : changed.length > 0 ? `${changed.length} unsaved ${changed.length === 1 ? "change" : "changes"}` : "")}
        </p>
        <button className={changed.length > 0 ? ui.primary : ui.secondary} disabled={pending || changed.length === 0} onClick={save} type="button">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}

export function AnswersForm({ facts, accountEmail, only }: Readonly<{
  facts: readonly CandidateProfileFactView[];
  accountEmail: string | null;
  /** Section ids to show, e.g. onboarding's essentials. All when omitted. */
  only?: readonly string[];
}>) {
  const saved = useMemo(() => new Map(facts.map((fact) => [fact.key, fact] as const)), [facts]);
  const sections = only ? ANSWER_SECTIONS.filter((section) => only.includes(section.id)) : ANSWER_SECTIONS;
  return (
    <div className={styles.stack}>
      {sections.map((section) => (
        <SectionForm accountEmail={accountEmail} key={`${section.id}:${section.fields.map((field) => saved.get(field.key)?.factVersionId ?? "").join(",")}`} saved={saved} section={section} />
      ))}
    </div>
  );
}
