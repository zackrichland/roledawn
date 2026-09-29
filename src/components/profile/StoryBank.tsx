"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import {
  archiveStoryAction,
  saveStoryAction,
  saveVoiceAction,
  setStoryDispositionAction,
  type KnowledgeActionResult,
} from "@/app/(candidate)/vault/knowledge-actions";
import ui from "@/components/app/ui.module.css";
import {
  parseStoryDraft,
  STORY_THEMES,
  StoryValidationError,
  type CandidateStoryView,
  type StoryDisposition,
  type StoryDraft,
  type StoryMetric,
  type StoryUsagePolicy,
} from "@/domain/candidate-stories";
import type { VoiceProfileContent } from "@/domain/voice-profile";

import styles from "./Profile.module.css";
import bank from "./StoryBank.module.css";

export type StoryRoleOption = Readonly<{ positionKey: string; title: string; organization: string; dates: string | null }>;

const EMPTY_DRAFT: StoryDraft = {
  title: "", positionKey: null, organization: null, roleTitle: null, periodLabel: null,
  situation: "", task: "", action: "", result: "", metrics: [], themes: [], guardrails: null,
};

function useCommand() {
  const ref = useRef<{ signature: string; id: string } | null>(null);
  return (payload: unknown) => {
    const signature = JSON.stringify(payload);
    if (ref.current?.signature !== signature) ref.current = { signature, id: crypto.randomUUID() };
    return ref.current.id;
  };
}

function StoryForm({ story, roles, onCancel, onSaved }: Readonly<{
  story: CandidateStoryView | null;
  roles: readonly StoryRoleOption[];
  onCancel: () => void;
  onSaved: () => void;
}>) {
  const [draft, setDraft] = useState<StoryDraft>(story?.draft ?? EMPTY_DRAFT);
  const [usage, setUsage] = useState<StoryUsagePolicy>(story?.usagePolicy === "COVER_LETTER_ONLY" ? "COVER_LETTER_ONLY" : "RESUME_AND_COVER_LETTER");
  const [error, setError] = useState<Readonly<{ field: string; text: string }> | null>(null);
  const [pending, startTransition] = useTransition();
  const command = useCommand();
  const set = <K extends keyof StoryDraft>(key: K, value: StoryDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  function chooseRole(positionKey: string) {
    const role = roles.find((entry) => entry.positionKey === positionKey);
    setDraft((current) => ({
      ...current,
      positionKey: role?.positionKey ?? null,
      organization: role?.organization ?? null,
      roleTitle: role?.title ?? null,
      periodLabel: role?.dates ?? null,
    }));
  }

  function setMetric(index: number, next: StoryMetric | null) {
    setDraft((current) => ({
      ...current,
      metrics: next === null ? current.metrics.filter((_, at) => at !== index) : current.metrics.map((metric, at) => at === index ? next : metric),
    }));
  }

  function save() {
    let parsed: StoryDraft;
    try {
      parsed = parseStoryDraft(draft);
    } catch (problem) {
      setError(problem instanceof StoryValidationError ? { field: problem.field, text: problem.message } : { field: "story", text: "Check the story and try again." });
      return;
    }
    setError(null);
    const payload = { storyId: story?.storyId ?? null, draft: parsed, usage };
    const commandId = command(payload);
    startTransition(async () => {
      const result = await saveStoryAction({
        commandId,
        storyId: story?.storyId ?? null,
        expectedAggregateVersion: story?.aggregateVersion ?? null,
        draft: parsed,
        disposition: "APPROVED",
        usagePolicy: usage,
      });
      if (!result.ok) {
        setError({ field: "story", text: result.message });
        return;
      }
      onSaved();
    });
  }

  const fieldError = (field: string) => error?.field === field ? <span className={bank.fieldError}>{error.text}</span> : null;

  return (
    <div className={bank.form}>
      <label className={ui.field}>
        <span>Give it a short name</span>
        <input className={ui.input} maxLength={140} onChange={(event) => set("title", event.target.value)} placeholder="e.g. Rebuilt onboarding for the Midwest region" value={draft.title} />
        {fieldError("title")}
      </label>
      {roles.length > 0 ? (
        <label className={ui.field}>
          <span>Which role was this?</span>
          <select className={ui.select} onChange={(event) => chooseRole(event.target.value)} value={draft.positionKey ?? ""}>
            <option value="">Not tied to one role</option>
            {roles.map((role) => <option key={role.positionKey} value={role.positionKey}>{role.title}, {role.organization}{role.dates ? ` (${role.dates})` : ""}</option>)}
          </select>
        </label>
      ) : null}
      <label className={ui.field}>
        <span>The situation</span>
        <textarea className={ui.textarea} maxLength={1500} onChange={(event) => set("situation", event.target.value)} placeholder="What was going on? What was at stake?" rows={3} value={draft.situation} />
        {fieldError("situation")}
      </label>
      <label className={ui.field}>
        <span>What you had to do</span>
        <textarea className={ui.textarea} maxLength={1000} onChange={(event) => set("task", event.target.value)} placeholder="Your part: the goal, the constraint, the deadline." rows={2} value={draft.task} />
        {fieldError("task")}
      </label>
      <label className={ui.field}>
        <span>What you did</span>
        <textarea className={ui.textarea} maxLength={2500} onChange={(event) => set("action", event.target.value)} placeholder="The specific moves you made. Use “I”, not “we”, for your part." rows={4} value={draft.action} />
        {fieldError("action")}
      </label>
      <label className={ui.field}>
        <span>What happened</span>
        <textarea className={ui.textarea} maxLength={1500} onChange={(event) => set("result", event.target.value)} placeholder="The outcome, with numbers if you have them." rows={3} value={draft.result} />
        {fieldError("result")}
      </label>

      <fieldset className={bank.metrics}>
        <legend className={ui.label}>Numbers <span className={bank.optional}>as you&apos;d say them</span></legend>
        {draft.metrics.map((metric, index) => (
          <div className={bank.metricRow} key={index}>
            <input aria-label="Number" className={ui.input} onChange={(event) => setMetric(index, { ...metric, value: event.target.value })} placeholder="e.g. $3M → $10M" value={metric.value} />
            <input aria-label="What it measures" className={ui.input} onChange={(event) => setMetric(index, { ...metric, label: event.target.value })} placeholder="e.g. annual revenue" value={metric.label} />
            <label className={styles.check}>
              <input checked={metric.confidence === "ESTIMATED"} onChange={(event) => setMetric(index, { ...metric, confidence: event.target.checked ? "ESTIMATED" : "STATED" })} type="checkbox" />
              <span>Estimate</span>
            </label>
            <button aria-label="Remove number" className={`${ui.quiet} ${ui.small}`} onClick={() => setMetric(index, null)} type="button">✕</button>
          </div>
        ))}
        {draft.metrics.length < 12 ? (
          <button className={`${ui.quiet} ${ui.small} ${bank.add}`} onClick={() => set("metrics", [...draft.metrics, { value: "", label: "", confidence: "STATED" }])} type="button">+ Add a number</button>
        ) : null}
      </fieldset>

      <fieldset className={bank.themes}>
        <legend className={ui.label}>What it shows <span className={bank.optional}>pick up to 8</span></legend>
        <div>
          {STORY_THEMES.map((theme) => {
            const on = draft.themes.includes(theme);
            return (
              <button
                aria-pressed={on}
                className={bank.theme}
                key={theme}
                onClick={() => set("themes", on ? draft.themes.filter((entry) => entry !== theme) : [...draft.themes, theme].slice(0, 8))}
                type="button"
              >
                {theme}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className={ui.field}>
        <span>Anything RoleDawn should never round up? <span className={bank.optional}>optional</span></span>
        <input className={ui.input} maxLength={800} onChange={(event) => set("guardrails", event.target.value || null)} placeholder="e.g. I co-led this; don't say I led it alone." value={draft.guardrails ?? ""} />
      </label>

      <fieldset className={bank.usage}>
        <legend className={ui.label}>Where RoleDawn may use it</legend>
        <label className={styles.check}><input checked={usage === "RESUME_AND_COVER_LETTER"} name="usage" onChange={() => setUsage("RESUME_AND_COVER_LETTER")} type="radio" /><span>Résumé and cover letters</span></label>
        <label className={styles.check}><input checked={usage === "COVER_LETTER_ONLY"} name="usage" onChange={() => setUsage("COVER_LETTER_ONLY")} type="radio" /><span>Cover letters only</span></label>
      </fieldset>

      {error?.field === "story" ? <p className={ui.noticeError} role="alert">{error.text}</p> : null}
      <div className={styles.actions}>
        <button className={ui.cta} disabled={pending} onClick={save} type="button">{pending ? "Saving…" : story ? "Save story" : "Add story"}</button>
        <button className={ui.quiet} disabled={pending} onClick={onCancel} type="button">Cancel</button>
      </div>
    </div>
  );
}

function StoryCard({ story, roles }: Readonly<{ story: CandidateStoryView; roles: readonly StoryRoleOption[] }>) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const command = useCommand();
  const { draft } = story;

  function run(action: () => Promise<KnowledgeActionResult>) {
    setMessage("");
    startTransition(async () => {
      const result = await action();
      if (!result.ok) { setMessage(result.message); return; }
      router.refresh();
    });
  }

  function disposition(next: StoryDisposition, usage: StoryUsagePolicy) {
    const payload = { story: story.storyId, version: story.aggregateVersion, next, usage };
    run(() => setStoryDispositionAction({ commandId: command(payload), storyId: story.storyId, expectedAggregateVersion: story.aggregateVersion, disposition: next, usagePolicy: usage }));
  }

  function remove() {
    const payload = { story: story.storyId, version: story.aggregateVersion, archive: true };
    run(() => archiveStoryAction({ commandId: command(payload), storyId: story.storyId, expectedAggregateVersion: story.aggregateVersion }));
  }

  if (editing) {
    return (
      <li className={bank.card}>
        <StoryForm onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); router.refresh(); }} roles={roles} story={story} />
      </li>
    );
  }

  const chip = story.disposition === "PROPOSED"
    ? { label: "Needs your OK", tone: "attention" }
    : story.disposition === "REJECTED" || story.usagePolicy === "DO_NOT_USE"
      ? { label: "Not used", tone: "neutral" }
      : story.usagePolicy === "COVER_LETTER_ONLY" ? { label: "Letters only", tone: "done" } : { label: "In use", tone: "done" };
  const where = [draft.roleTitle, draft.organization].filter(Boolean).join(", ");

  return (
    <li className={bank.card} data-disposition={story.disposition}>
      <div className={bank.cardHead}>
        <div>
          <h3>{draft.title}</h3>
          {where || draft.periodLabel ? <span>{[where, draft.periodLabel].filter(Boolean).join(" · ")}</span> : null}
        </div>
        <span className={`${ui.chip} ${ui[`tone-${chip.tone}`]}`}>{chip.label}</span>
      </div>
      <dl className={bank.star}>
        <div><dt>Situation</dt><dd>{draft.situation}</dd></div>
        <div><dt>Task</dt><dd>{draft.task}</dd></div>
        <div><dt>What you did</dt><dd>{draft.action}</dd></div>
        <div><dt>Result</dt><dd>{draft.result}</dd></div>
      </dl>
      {draft.metrics.length > 0 ? (
        <ul className={bank.numbers}>
          {draft.metrics.map((metric) => (
            <li key={`${metric.value}-${metric.label}`}>
              <strong>{metric.value}</strong> {metric.label}
              {metric.confidence === "ESTIMATED" ? <em> · estimate</em> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {draft.guardrails ? <p className={bank.guard}><strong>Never round up:</strong> {draft.guardrails}</p> : null}
      {message ? <p className={ui.noticeError} role="alert">{message}</p> : null}
      <div className={styles.actions}>
        {story.disposition === "PROPOSED" ? (
          <>
            <button className={`${ui.cta} ${ui.small}`} disabled={pending} onClick={() => disposition("APPROVED", "RESUME_AND_COVER_LETTER")} type="button">Yes, that&apos;s right</button>
            <button className={`${ui.secondary} ${ui.small}`} disabled={pending} onClick={() => setEditing(true)} type="button">Fix something</button>
            <button className={`${ui.quiet} ${ui.small}`} disabled={pending} onClick={() => disposition("REJECTED", "DO_NOT_USE")} type="button">Don&apos;t use this</button>
          </>
        ) : story.disposition === "REJECTED" || story.usagePolicy === "DO_NOT_USE" ? (
          <>
            <button className={`${ui.secondary} ${ui.small}`} disabled={pending} onClick={() => disposition("APPROVED", "RESUME_AND_COVER_LETTER")} type="button">Use it after all</button>
            <button className={`${ui.quiet} ${ui.small}`} disabled={pending} onClick={remove} type="button">Delete</button>
          </>
        ) : (
          <>
            <button className={`${ui.secondary} ${ui.small}`} disabled={pending} onClick={() => setEditing(true)} type="button">Edit</button>
            <button className={`${ui.quiet} ${ui.small}`} disabled={pending} onClick={() => disposition("REJECTED", "DO_NOT_USE")} type="button">Stop using</button>
          </>
        )}
      </div>
    </li>
  );
}

function VoiceCard({ voice, aggregateVersion }: Readonly<{ voice: VoiceProfileContent | null; aggregateVersion: number | null }>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState(voice?.toneNotes ?? "");
  const [avoid, setAvoid] = useState((voice?.avoidPhrases ?? []).join(", "));
  const [signOff, setSignOff] = useState(voice?.signOff ?? "");
  const [sample, setSample] = useState(voice?.writingSample ?? "");
  const [message, setMessage] = useState<Readonly<{ ok: boolean; text: string }> | null>(null);
  const [pending, startTransition] = useTransition();
  const command = useCommand();

  function save() {
    const content = {
      schemaVersion: 1,
      selfDescription: voice?.selfDescription ?? null,
      writingSample: sample.trim() || null,
      toneNotes: tone.trim() || null,
      preferredPhrases: voice?.preferredPhrases ?? [],
      avoidPhrases: avoid.split(/[,\n]/u).map((phrase) => phrase.trim()).filter(Boolean).slice(0, 40),
      signOff: signOff.trim() || null,
    };
    const commandId = command(content);
    startTransition(async () => {
      const result = await saveVoiceAction({ commandId, content, expectedAggregateVersion: aggregateVersion });
      setMessage({ ok: result.ok, text: result.ok ? "Saved." : result.message });
      if (result.ok) { setOpen(false); router.refresh(); }
    });
  }

  return (
    <section className={styles.card} aria-labelledby="voice-heading">
      <div className={styles.cardHead}>
        <div>
          <h2 id="voice-heading">How you sound</h2>
          <p>{voice?.toneNotes ?? voice?.selfDescription ?? "Tell RoleDawn how you write, and which words you'd never use. It matches your tone; it never adds facts."}</p>
        </div>
        {!open ? <button className={`${ui.secondary} ${ui.small}`} onClick={() => setOpen(true)} type="button">{voice ? "Edit" : "Add"}</button> : null}
      </div>
      {!open && voice?.avoidPhrases.length ? (
        <div className={bank.avoid}>
          <span className={ui.label}>Never write</span>
          <div>{voice.avoidPhrases.map((phrase) => <span className={ui.chip} key={phrase}>{phrase}</span>)}</div>
        </div>
      ) : null}
      {open ? (
        <div className={bank.form}>
          <label className={ui.field}>
            <span>Your tone, in a sentence</span>
            <input className={ui.input} maxLength={400} onChange={(event) => setTone(event.target.value)} placeholder="e.g. Direct and warm. Short sentences. No exclamation marks." value={tone} />
          </label>
          <label className={ui.field}>
            <span>Words and phrases to never use</span>
            <input className={ui.input} onChange={(event) => setAvoid(event.target.value)} placeholder="e.g. passionate, synergy, rockstar" value={avoid} />
          </label>
          <label className={ui.field}>
            <span>How you sign off</span>
            <input className={ui.input} maxLength={60} onChange={(event) => setSignOff(event.target.value)} placeholder="e.g. Best," value={signOff} />
          </label>
          <label className={ui.field}>
            <span>Something you wrote <span className={bank.optional}>optional: an email, a post, a note</span></span>
            <textarea className={ui.textarea} maxLength={4000} onChange={(event) => setSample(event.target.value)} rows={5} value={sample} />
          </label>
          {message && !message.ok ? <p className={ui.noticeError} role="alert">{message.text}</p> : null}
          <div className={styles.actions}>
            <button className={ui.primary} disabled={pending} onClick={save} type="button">{pending ? "Saving…" : "Save"}</button>
            <button className={ui.quiet} disabled={pending} onClick={() => setOpen(false)} type="button">Cancel</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function StoryBank({ stories, roles, voice, voiceAggregateVersion, interviewActive }: Readonly<{
  stories: readonly CandidateStoryView[];
  roles: readonly StoryRoleOption[];
  voice: VoiceProfileContent | null;
  voiceAggregateVersion: number | null;
  interviewActive: boolean;
}>) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const proposed = stories.filter((story) => story.disposition === "PROPOSED");
  const inUse = stories.filter((story) => story.disposition === "APPROVED" && story.usagePolicy !== "DO_NOT_USE");
  const setAside = stories.filter((story) => story.disposition === "REJECTED" || (story.disposition === "APPROVED" && story.usagePolicy === "DO_NOT_USE"));

  return (
    <div className={styles.stack}>
      <section className={`${styles.card} ${bank.interview}`}>
        <div>
          <h2>{interviewActive ? "Pick up where you left off" : stories.length ? "Add more stories" : "Tell RoleDawn your best work"}</h2>
          <p>
            A short conversation, one role at a time. It asks for the numbers and the details you&apos;d forget to write down,
            then reads each story back for your OK.
          </p>
        </div>
        <div className={styles.actions}>
          <Link className={ui.cta} href="/vault/interview">{interviewActive ? "Continue the interview" : "Start the interview"}</Link>
          {!adding ? <button className={ui.quiet} onClick={() => setAdding(true)} type="button">Write one myself</button> : null}
        </div>
      </section>

      {adding ? (
        <section className={styles.card}>
          <div className={styles.cardHead}><div><h2>New story</h2><p>One moment, told plainly. Specifics beat adjectives.</p></div></div>
          <StoryForm onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); router.refresh(); }} roles={roles} story={null} />
        </section>
      ) : null}

      {proposed.length > 0 ? (
        <section aria-labelledby="proposed-heading">
          <h2 className={bank.groupTitle} id="proposed-heading">Waiting for your OK <span>{proposed.length}</span></h2>
          <ul className={bank.list}>{proposed.map((story) => <StoryCard key={story.storyId} roles={roles} story={story} />)}</ul>
        </section>
      ) : null}

      <section aria-labelledby="in-use-heading">
        <h2 className={bank.groupTitle} id="in-use-heading">In use <span>{inUse.length}</span></h2>
        {inUse.length > 0
          ? <ul className={bank.list}>{inUse.map((story) => <StoryCard key={story.storyId} roles={roles} story={story} />)}</ul>
          : <p className={`${ui.card} ${ui.empty}`}>No approved stories yet. Your letters will lean on your résumé until you add some.</p>}
      </section>

      {setAside.length > 0 ? (
        <details className={bank.setAside}>
          <summary>Set aside ({setAside.length})</summary>
          <ul className={bank.list}>{setAside.map((story) => <StoryCard key={story.storyId} roles={roles} story={story} />)}</ul>
        </details>
      ) : null}

      <VoiceCard aggregateVersion={voiceAggregateVersion} voice={voice} />
    </div>
  );
}
