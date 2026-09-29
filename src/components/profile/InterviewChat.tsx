"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";

import {
  sendInterviewMessageAction,
  setStoryDispositionAction,
  startInterviewAction,
} from "@/app/(candidate)/vault/knowledge-actions";
import ui from "@/components/app/ui.module.css";
import type { StoryDraft } from "@/domain/candidate-stories";

import styles from "./Profile.module.css";
import chat from "./InterviewChat.module.css";

export type InterviewChatView = Readonly<{
  sessionId: string;
  status: "ACTIVE" | "COMPLETED" | "ABANDONED";
  turnCount: number;
  focusPositionKey: string | null;
  coveredPositionKeys: readonly string[];
  turns: readonly Readonly<{ sequenceNumber: number; speaker: "INTERVIEWER" | "CANDIDATE"; content: string }>[];
}>;

export type InterviewRole = Readonly<{ positionKey: string; title: string; organization: string }>;

type Message = Readonly<{ key: string; speaker: "INTERVIEWER" | "CANDIDATE"; content: string; proposal?: Proposal }>;
type Proposal = Readonly<{ storyId: string; aggregateVersion: number; draft: StoryDraft; readback: string }>;

function Readback({ proposal }: Readonly<{ proposal: Proposal }>) {
  const router = useRouter();
  const [state, setState] = useState<"OPEN" | "APPROVED" | "REJECTED">("OPEN");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [line1, ...rest] = proposal.readback.split("\n");

  function decide(disposition: "APPROVED" | "REJECTED") {
    startTransition(async () => {
      const result = await setStoryDispositionAction({
        commandId: crypto.randomUUID(),
        storyId: proposal.storyId,
        expectedAggregateVersion: proposal.aggregateVersion,
        disposition,
        usagePolicy: disposition === "APPROVED" ? "RESUME_AND_COVER_LETTER" : "DO_NOT_USE",
      });
      if (!result.ok) { setMessage(result.message); return; }
      setState(disposition);
      router.refresh();
    });
  }

  return (
    <div className={chat.readback} data-state={state}>
      <span className={chat.readbackLabel}>{state === "APPROVED" ? "Saved to your stories" : state === "REJECTED" ? "Set aside" : "Did I get this right?"}</span>
      <strong>{line1}</strong>
      {rest.length ? <p>{rest.join(" ")}</p> : null}
      {proposal.draft.metrics.length ? (
        <ul>{proposal.draft.metrics.map((metric) => <li key={`${metric.value}-${metric.label}`}>{metric.value} {metric.label}{metric.confidence === "ESTIMATED" ? " (estimate)" : ""}</li>)}</ul>
      ) : null}
      {message ? <p className={ui.noticeError} role="alert">{message}</p> : null}
      {state === "OPEN" ? (
        <div className={styles.actions}>
          <button className={`${ui.cta} ${ui.small}`} disabled={pending} onClick={() => decide("APPROVED")} type="button">Yes, save it</button>
          <Link className={`${ui.secondary} ${ui.small}`} href="/vault/stories">Fix something</Link>
          <button className={`${ui.quiet} ${ui.small}`} disabled={pending} onClick={() => decide("REJECTED")} type="button">Don&apos;t use it</button>
        </div>
      ) : null}
    </div>
  );
}

export function InterviewChat({ view, roles, waitingStories }: Readonly<{
  view: InterviewChatView | null;
  roles: readonly InterviewRole[];
  waitingStories: number;
}>) {
  const router = useRouter();
  const [messages, setMessages] = useState<readonly Message[]>(() => (view?.turns ?? []).map((turn) => ({
    key: `t${turn.sequenceNumber}`, speaker: turn.speaker, content: turn.content,
  })));
  const [turnCount, setTurnCount] = useState(view?.turnCount ?? 0);
  const [complete, setComplete] = useState(view?.status !== "ACTIVE");
  const [focus, setFocus] = useState(view?.focusPositionKey ?? null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const commands = useRef<{ text: string; stop: boolean; ids: [string, string, string] } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending]);

  function start() {
    startTransition(async () => {
      setError("");
      const result = await startInterviewAction(crypto.randomUUID());
      if (!result.ok) { setError(result.message); return; }
      router.refresh();
    });
  }

  function send(stop = false) {
    if (!view || pending) return;
    const text = draft.trim() || (stop ? "Let's stop here for now." : "");
    if (!text) return;
    if (commands.current?.text !== text || commands.current.stop !== stop) {
      commands.current = { text, stop, ids: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()] };
    }
    const [commandId, storyCommandId, voiceCommandId] = commands.current.ids;
    const optimisticKey = `c${turnCount + 1}`;
    setError("");
    setMessages((current) => current.some((message) => message.key === optimisticKey)
      ? current : [...current, { key: optimisticKey, speaker: "CANDIDATE", content: text }]);
    setDraft("");
    startTransition(async () => {
      const result = await sendInterviewMessageAction({
        commandId, storyCommandId, voiceCommandId,
        sessionId: view.sessionId,
        expectedTurnCount: turnCount,
        message: text,
        wantsToStop: stop,
      });
      if (!result.ok) {
        setError(result.message);
        setDraft(text);
        setMessages((current) => current.filter((message) => message.key !== optimisticKey));
        return;
      }
      commands.current = null;
      setMessages((current) => [...current, {
        key: `i${turnCount + 2}`, speaker: "INTERVIEWER", content: result.reply, proposal: result.proposal ?? undefined,
      }]);
      setTurnCount((count) => count + 2);
      if (result.proposal?.draft.positionKey) setFocus(result.proposal.draft.positionKey);
      if (result.complete) {
        setComplete(true);
        router.refresh();
      }
      input.current?.focus();
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(false);
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(false);
    }
  }

  if (!view || (complete && messages.length === 0)) {
    return (
      <section className={`${styles.card} ${chat.intro}`}>
        <h2>Ten minutes that make every letter better</h2>
        <ul className={chat.points}>
          <li><strong>One role at a time.</strong> It starts with your most recent job and works back.</li>
          <li><strong>It digs for specifics.</strong> The numbers, the stakes, what you did yourself.</li>
          <li><strong>You approve every story.</strong> Nothing is used until you say it&apos;s right.</li>
        </ul>
        {roles.length === 0 ? <p className={ui.noticeInfo}>Tip: <Link href="/vault">confirm your résumé</Link> first so the interviewer can ask about your actual roles.</p> : null}
        {error ? <p className={ui.noticeError} role="alert">{error}</p> : null}
        <div className={styles.actions}>
          <button className={ui.cta} disabled={pending} onClick={start} type="button">{pending ? "Starting…" : "Start the interview"}</button>
        </div>
      </section>
    );
  }

  const focusRole = roles.find((role) => role.positionKey === focus);
  const covered = new Set(view.coveredPositionKeys);

  return (
    <section className={chat.shell} aria-label="Interview">
      <header className={chat.bar}>
        <div>
          <span className={ui.label}>{complete ? "Interview finished" : focusRole ? "Talking about" : "Interview"}</span>
          <strong>{complete ? "Nice work." : focusRole ? `${focusRole.title}, ${focusRole.organization}` : "Your work history"}</strong>
        </div>
        {roles.length > 1 ? (
          <ol className={chat.roles} aria-label="Roles covered">
            {roles.slice(0, 6).map((role) => (
              <li data-state={covered.has(role.positionKey) ? "done" : role.positionKey === focus ? "now" : "todo"} key={role.positionKey} title={`${role.title}, ${role.organization}`} />
            ))}
          </ol>
        ) : null}
      </header>

      <div className={chat.transcript} aria-live="polite">
        {messages.map((message) => (
          <div className={chat.turn} data-speaker={message.speaker} key={message.key}>
            <p>{message.content}</p>
            {message.proposal ? <Readback proposal={message.proposal} /> : null}
          </div>
        ))}
        {pending && messages.at(-1)?.speaker === "CANDIDATE" ? (
          <div className={chat.turn} data-speaker="INTERVIEWER"><p className={chat.typing}><span /><span /><span /></p></div>
        ) : null}
        <div ref={end} />
      </div>

      {complete ? (
        <div className={chat.done}>
          <p>{waitingStories > 0 ? `${waitingStories} ${waitingStories === 1 ? "story is" : "stories are"} waiting for your OK.` : "Your stories are saved."} Come back any time to add more.</p>
          <div className={styles.actions}>
            <Link className={ui.cta} href="/vault/stories">Review my stories</Link>
            <button className={ui.quiet} disabled={pending} onClick={start} type="button">Start a new session</button>
          </div>
        </div>
      ) : (
        <form className={chat.composer} onSubmit={submit}>
          {error ? <p className={ui.noticeError} role="alert">{error}</p> : null}
          <textarea
            aria-label="Your answer"
            disabled={pending}
            maxLength={6000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={keyDown}
            placeholder="Type your answer. Shift+Enter for a new line."
            ref={input}
            rows={3}
            value={draft}
          />
          <div className={chat.composerActions}>
            <button className={ui.quiet} disabled={pending} onClick={() => send(true)} type="button">Finish for now</button>
            <button className={ui.primary} disabled={pending || !draft.trim()} type="submit">{pending ? "Listening…" : "Send"}</button>
          </div>
        </form>
      )}
    </section>
  );
}
