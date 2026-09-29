"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import { saveCareerProfileAction } from "@/app/(candidate)/vault/knowledge-actions";
import ui from "@/components/app/ui.module.css";
import { displayCareerRange, sortPositionsNewestFirst } from "@/domain/career-dates";
import type {
  CareerCertification,
  CareerEducation,
  CareerGap,
  CareerPosition,
  CareerProfileContent,
  CareerSkillGroup,
  EmploymentKind,
} from "@/domain/career-profile";

import styles from "./Profile.module.css";
import editor from "./CareerProfileEditor.module.css";

type Draft = {
  headline: string;
  positions: CareerPosition[];
  education: CareerEducation[];
  certifications: CareerCertification[];
  skills: CareerSkillGroup[];
  gaps: CareerGap[];
};

const KINDS: readonly Readonly<{ value: EmploymentKind | ""; label: string }>[] = [
  { value: "", label: "Not specified" },
  { value: "FULL_TIME", label: "Full-time" },
  { value: "PART_TIME", label: "Part-time" },
  { value: "CONTRACT", label: "Contract" },
  { value: "INTERNSHIP", label: "Internship" },
  { value: "FOUNDER", label: "Founder" },
  { value: "VOLUNTEER", label: "Volunteer" },
  { value: "OTHER", label: "Other" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toDraft(content: CareerProfileContent): Draft {
  return {
    headline: content.headline ?? "",
    positions: [...sortPositionsNewestFirst(content.positions)],
    education: [...content.education],
    certifications: [...content.certifications],
    skills: [...content.skills],
    gaps: [...content.gaps],
  };
}

function toContent(draft: Draft): unknown {
  const blank = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);
  return {
    schemaVersion: 1,
    headline: blank(draft.headline),
    // New entries get a key derived from their content when saved.
    positions: draft.positions.map((position) => ({
      ...position,
      positionKey: position.positionKey.startsWith("new-") ? "" : position.positionKey,
      location: blank(position.location),
      summary: blank(position.summary),
    })),
    education: draft.education.map((entry) => ({
      ...entry,
      educationKey: entry.educationKey.startsWith("new-") ? "" : entry.educationKey,
      field: blank(entry.field),
      location: blank(entry.location),
    })),
    certifications: draft.certifications.map((entry) => ({ ...entry, issuer: blank(entry.issuer) })),
    skills: draft.skills.filter((group) => group.items.length > 0),
    gaps: draft.gaps,
  };
}

/** Month is optional: "2021" or "2021-03". */
function DateField({ label, value, onChange, disabled }: Readonly<{ label: string; value: string | null; onChange: (value: string | null) => void; disabled?: boolean }>) {
  const [year, month] = (value ?? "").split("-");
  const update = (nextYear: string, nextMonth: string) => {
    const cleanYear = nextYear.replace(/\D/gu, "").slice(0, 4);
    onChange(cleanYear.length === 4 ? (nextMonth ? `${cleanYear}-${nextMonth}` : cleanYear) : cleanYear ? cleanYear : null);
  };
  return (
    <fieldset className={editor.date} disabled={disabled}>
      <legend className={ui.label}>{label}</legend>
      <div>
        <select aria-label={`${label} month`} className={ui.select} onChange={(event) => update(year ?? "", event.target.value)} value={month ?? ""}>
          <option value="">Month</option>
          {MONTHS.map((name, index) => <option key={name} value={String(index + 1).padStart(2, "0")}>{name}</option>)}
        </select>
        <input aria-label={`${label} year`} className={ui.input} inputMode="numeric" maxLength={4} onChange={(event) => update(event.target.value, month ?? "")} placeholder="Year" value={year ?? ""} />
      </div>
    </fieldset>
  );
}

function PositionForm({ position, onChange, onRemove, onDone }: Readonly<{
  position: CareerPosition;
  onChange: (next: CareerPosition) => void;
  onRemove: () => void;
  onDone: () => void;
}>) {
  const set = <K extends keyof CareerPosition>(key: K, value: CareerPosition[K]) => onChange({ ...position, [key]: value });
  return (
    <div className={editor.form}>
      <div className={styles.grid2}>
        <label className={ui.field}><span>Title</span><input className={ui.input} onChange={(event) => set("title", event.target.value)} value={position.title} /></label>
        <label className={ui.field}><span>Employer</span><input className={ui.input} onChange={(event) => set("organization", event.target.value)} value={position.organization} /></label>
      </div>
      <div className={styles.grid2}>
        <label className={ui.field}><span>Location</span><input className={ui.input} onChange={(event) => set("location", event.target.value)} placeholder="City, ST or Remote" value={position.location ?? ""} /></label>
        <label className={ui.field}>
          <span>Type</span>
          <select className={ui.select} onChange={(event) => set("employmentKind", (event.target.value || null) as EmploymentKind | null)} value={position.employmentKind ?? ""}>
            {KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
          </select>
        </label>
      </div>
      <div className={editor.dates}>
        <DateField label="Started" onChange={(value) => set("startDate", value)} value={position.startDate} />
        <DateField disabled={position.current} label="Ended" onChange={(value) => set("endDate", value)} value={position.current ? null : position.endDate} />
        <label className={styles.check}>
          <input checked={position.current} onChange={(event) => onChange({ ...position, current: event.target.checked, endDate: event.target.checked ? null : position.endDate })} type="checkbox" />
          <span>I work here now</span>
        </label>
      </div>
      <label className={ui.field}>
        <span>Scope <em className={editor.optional}>optional</em></span>
        <input className={ui.input} maxLength={240} onChange={(event) => set("summary", event.target.value)} placeholder="e.g. Led a team of 6 across three hospitals" value={position.summary ?? ""} />
      </label>
      <div className={styles.actions}>
        <button className={`${ui.primary} ${ui.small}`} onClick={onDone} type="button">Done</button>
        <button className={`${ui.quiet} ${ui.small}`} onClick={onRemove} type="button">Remove this role</button>
      </div>
    </div>
  );
}

function EducationForm({ entry, onChange, onRemove, onDone }: Readonly<{
  entry: CareerEducation;
  onChange: (next: CareerEducation) => void;
  onRemove: () => void;
  onDone: () => void;
}>) {
  const set = <K extends keyof CareerEducation>(key: K, value: CareerEducation[K]) => onChange({ ...entry, [key]: value });
  return (
    <div className={editor.form}>
      <div className={styles.grid2}>
        <label className={ui.field}><span>School</span><input className={ui.input} onChange={(event) => set("institution", event.target.value)} value={entry.institution} /></label>
        <label className={ui.field}><span>Degree or program</span><input className={ui.input} onChange={(event) => set("credential", event.target.value)} placeholder="e.g. B.S., Business Management" value={entry.credential} /></label>
      </div>
      <div className={editor.dates}>
        <DateField label="Started" onChange={(value) => set("startDate", value)} value={entry.startDate} />
        <DateField label="Finished" onChange={(value) => set("endDate", value)} value={entry.endDate} />
      </div>
      <label className={ui.field}>
        <span>Honors or details <em className={editor.optional}>one per line</em></span>
        <textarea className={ui.textarea} onChange={(event) => set("details", event.target.value.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 6))} rows={3} value={entry.details.join("\n")} />
      </label>
      <div className={styles.actions}>
        <button className={`${ui.primary} ${ui.small}`} onClick={onDone} type="button">Done</button>
        <button className={`${ui.quiet} ${ui.small}`} onClick={onRemove} type="button">Remove</button>
      </div>
    </div>
  );
}

export function CareerProfileEditor({ content, aggregateVersion, linesByKey, extractedFromResume }: Readonly<{
  content: CareerProfileContent;
  aggregateVersion: number | null;
  /** Approved résumé lines by evidence key, shown under each role. */
  linesByKey: Readonly<Record<string, string>>;
  extractedFromResume: boolean;
}>) {
  const router = useRouter();
  const initial = useMemo(() => toDraft(content), [content]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [skillsText, setSkillsText] = useState(() => initial.skills.map((group) => `${group.label ? `${group.label}: ` : ""}${group.items.join(", ")}`).join("\n"));
  const [message, setMessage] = useState<Readonly<{ ok: boolean; text: string }> | null>(null);
  const [pending, startTransition] = useTransition();
  const command = useRef<{ signature: string; id: string } | null>(null);
  const dirty = JSON.stringify(toContent(draft)) !== JSON.stringify(toContent(initial));

  function update(mutator: (current: Draft) => Draft) {
    setDraft((current) => mutator(current));
    setMessage(null);
  }

  function parseSkills(value: string): CareerSkillGroup[] {
    return value.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 12).map((line) => {
      const colon = line.indexOf(":");
      const label = colon > 0 && colon < 40 ? line.slice(0, colon).trim() : null;
      const list = colon > 0 && colon < 40 ? line.slice(colon + 1) : line;
      return { label, items: list.split(/[,;·]/u).map((item) => item.trim()).filter(Boolean).slice(0, 40) };
    });
  }

  function problem(): string | null {
    const validDate = (value: string | null) => value === null || /^(?:19|20)\d{2}(?:-(?:0[1-9]|1[0-2]))?$/u.test(value);
    for (const position of draft.positions) {
      if (!position.title.trim() || !position.organization.trim()) return "Every role needs a title and an employer.";
      if (!validDate(position.startDate) || !validDate(position.endDate)) return `Check the dates for ${position.title || "a role"}: use a four-digit year.`;
      if (position.startDate && position.endDate && position.endDate.slice(0, 7) < position.startDate.slice(0, 7)) return `${position.title}: the end date is before the start date.`;
    }
    for (const entry of draft.education) {
      if (!entry.institution.trim() || !entry.credential.trim()) return "Each education entry needs a school and a degree or program.";
      if (!validDate(entry.startDate) || !validDate(entry.endDate)) return `Check the dates for ${entry.institution || "your education"}: use a four-digit year.`;
    }
    return null;
  }

  function save() {
    const issue = problem();
    if (issue) {
      setMessage({ ok: false, text: issue });
      return;
    }
    const payload = toContent(draft);
    const signature = JSON.stringify(payload);
    if (command.current?.signature !== signature) command.current = { signature, id: crypto.randomUUID() };
    const commandId = command.current.id;
    startTransition(async () => {
      const result = await saveCareerProfileAction({ commandId, content: payload, expectedAggregateVersion: aggregateVersion });
      if (!result.ok) {
        setMessage({ ok: false, text: /CAREER_PROFILE_INVALID/u.test(result.message) ? "Every role needs a title and an employer, and end dates can't come before start dates." : result.message });
        return;
      }
      command.current = null;
      setEditing(null);
      setMessage({ ok: true, text: "Saved. New applications use this version." });
      router.refresh();
    });
  }

  const newPosition = (): CareerPosition => ({
    positionKey: "", title: "", organization: "", location: null, startDate: null, endDate: null, current: false,
    employmentKind: null, summary: null, evidenceKeys: [],
  });

  return (
    <div className={styles.stack}>
      {extractedFromResume ? (
        <p className={ui.noticeInfo}>RoleDawn organized this from your résumé. Fix anything it got wrong; your résumé always prints what&apos;s here.</p>
      ) : null}

      <section className={styles.card} aria-labelledby="roles-heading">
        <div className={styles.cardHead}>
          <div>
            <h2 id="roles-heading">Roles</h2>
            <p>Newest first. Titles and dates print exactly as written here.</p>
          </div>
          <button className={`${ui.secondary} ${ui.small}`} onClick={() => {
            const position = newPosition();
            const key = `new-${draft.positions.length}-${Date.now()}`;
            update((current) => ({ ...current, positions: [{ ...position, positionKey: key }, ...current.positions] }));
            setEditing(key);
          }} type="button">Add a role</button>
        </div>
        {draft.positions.length === 0 ? <p className={ui.empty}>No roles yet. Add your most recent one.</p> : null}
        <ol className={editor.items}>
          {draft.positions.map((position, index) => {
            const key = position.positionKey || `index-${index}`;
            const lines = position.evidenceKeys.map((evidenceKey) => linesByKey[evidenceKey]).filter((line): line is string => Boolean(line));
            return (
              <li key={key}>
                {editing === position.positionKey ? (
                  <PositionForm
                    onChange={(next) => update((current) => ({ ...current, positions: current.positions.map((entry, at) => at === index ? next : entry) }))}
                    onDone={() => setEditing(null)}
                    onRemove={() => { update((current) => ({ ...current, positions: current.positions.filter((_, at) => at !== index) })); setEditing(null); }}
                    position={position}
                  />
                ) : (
                  <div className={editor.row}>
                    <div>
                      <strong>{position.title || "Untitled role"}</strong>
                      <span>{[position.organization, position.location].filter(Boolean).join(" · ")}</span>
                      <small>{displayCareerRange(position.startDate, position.endDate, position.current) ?? "Dates not set"}</small>
                      {position.summary ? <p>{position.summary}</p> : null}
                      {lines.length > 0 ? (
                        <details className={editor.lines}>
                          <summary>{lines.length} {lines.length === 1 ? "line" : "lines"} from your résumé</summary>
                          <ul>{lines.map((line) => <li key={line}>{line}</li>)}</ul>
                        </details>
                      ) : null}
                    </div>
                    <button className={`${ui.quiet} ${ui.small}`} onClick={() => setEditing(position.positionKey)} type="button">Edit</button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section className={styles.card} aria-labelledby="education-heading">
        <div className={styles.cardHead}>
          <div>
            <h2 id="education-heading">Education</h2>
            <p>Degrees, programs, and certificates that belong on your résumé.</p>
          </div>
          <button className={`${ui.secondary} ${ui.small}`} onClick={() => {
            const key = `new-${Date.now()}`;
            update((current) => ({ ...current, education: [...current.education, { educationKey: key, institution: "", credential: "", field: null, location: null, startDate: null, endDate: null, details: [] }] }));
            setEditing(`edu:${key}`);
          }} type="button">Add</button>
        </div>
        {draft.education.length === 0 ? <p className={styles.muted}>Nothing listed. That&apos;s fine if your experience speaks for itself.</p> : null}
        <ol className={editor.items}>
          {draft.education.map((entry, index) => (
            <li key={entry.educationKey || index}>
              {editing === `edu:${entry.educationKey}` ? (
                <EducationForm
                  entry={entry}
                  onChange={(next) => update((current) => ({ ...current, education: current.education.map((item, at) => at === index ? next : item) }))}
                  onDone={() => setEditing(null)}
                  onRemove={() => { update((current) => ({ ...current, education: current.education.filter((_, at) => at !== index) })); setEditing(null); }}
                />
              ) : (
                <div className={editor.row}>
                  <div>
                    <strong>{entry.credential || "Degree"}</strong>
                    <span>{entry.institution}</span>
                    <small>{displayCareerRange(entry.startDate, entry.endDate, false) ?? ""}</small>
                  </div>
                  <button className={`${ui.quiet} ${ui.small}`} onClick={() => setEditing(`edu:${entry.educationKey}`)} type="button">Edit</button>
                </div>
              )}
            </li>
          ))}
        </ol>
        {draft.certifications.length > 0 ? (
          <div className={editor.certs}>
            <span className={ui.label}>Certifications</span>
            <ul>
              {draft.certifications.map((cert, index) => (
                <li key={`${cert.name}-${index}`}>
                  <span>{cert.name}{cert.issuer ? `, ${cert.issuer}` : ""}{cert.date ? ` · ${cert.date}` : ""}</span>
                  <button className={`${ui.quiet} ${ui.small}`} onClick={() => update((current) => ({ ...current, certifications: current.certifications.filter((_, at) => at !== index) }))} type="button">Remove</button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className={styles.card} aria-labelledby="skills-heading">
        <div className={styles.cardHead}>
          <div>
            <h2 id="skills-heading">Skills</h2>
            <p>One group per line. Start a line with a label and a colon to group it, like “Tools: Salesforce, SQL, Figma”.</p>
          </div>
        </div>
        <textarea
          aria-label="Skills"
          className={ui.textarea}
          onChange={(event) => {
            setSkillsText(event.target.value);
            update((current) => ({ ...current, skills: parseSkills(event.target.value) }));
          }}
          rows={Math.max(3, Math.min(8, skillsText.split("\n").length + 1))}
          value={skillsText}
        />
        <p className={ui.hint}>RoleDawn picks the skills that match each job. It won&apos;t add skills you didn&apos;t list.</p>
      </section>

      <section className={styles.card} aria-labelledby="headline-heading">
        <div className={styles.cardHead}>
          <div>
            <h2 id="headline-heading">Headline <span className={editor.optional}>optional</span></h2>
            <p>A short line under your name. RoleDawn adjusts it per job, using only what&apos;s true here.</p>
          </div>
        </div>
        <input className={ui.input} maxLength={160} onChange={(event) => update((current) => ({ ...current, headline: event.target.value }))} placeholder="e.g. Customer success leader · Healthcare SaaS" value={draft.headline} />
      </section>

      {draft.gaps.length > 0 ? (
        <section className={styles.card} aria-labelledby="gaps-heading">
          <div className={styles.cardHead}>
            <div>
              <h2 id="gaps-heading">Time between roles</h2>
              <p>Only used if an application asks. Say it plainly, in your words.</p>
            </div>
          </div>
          {draft.gaps.map((gap, index) => (
            <label className={ui.field} key={`${gap.from}-${gap.to}`}>
              <span>{displayCareerRange(gap.from, gap.to, false)}</span>
              <input className={ui.input} maxLength={300} onChange={(event) => update((current) => ({ ...current, gaps: current.gaps.map((item, at) => at === index ? { ...item, note: event.target.value } : item) }))} value={gap.note} />
            </label>
          ))}
        </section>
      ) : null}

      <p className={ui.hint}><Link href="/vault/facts">Review your résumé lines one by one</Link> to hide any you don&apos;t want used.</p>

      {dirty || message ? (
        <div className={editor.saveBar} role="region" aria-label="Save changes">
          {message ? <p className={message.ok ? editor.saved : editor.error} role="status">{message.text}</p> : <p>You have unsaved changes.</p>}
          {dirty ? (
            <div className={styles.actions}>
              <button className={`${ui.quiet} ${ui.small}`} disabled={pending} onClick={() => { setDraft(initial); setSkillsText(initial.skills.map((group) => `${group.label ? `${group.label}: ` : ""}${group.items.join(", ")}`).join("\n")); setEditing(null); setMessage(null); }} type="button">Discard</button>
              <button className={ui.cta} disabled={pending} onClick={save} type="button">{pending ? "Saving…" : "Save changes"}</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
