"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { saveApplicationAgentAnswersAction } from "@/app/(candidate)/applications/[applicationId]/agent-question-actions";
import {
  AGENT_QUESTION_LIMITS,
  displayQuestionLabel,
  validateAgentQuestionAnswer,
  type AgentQuestionValue,
  type ApplicationAgentQuestion,
} from "@/domain/application-agent-questions";

import styles from "./ApplicationAgentQuestions.module.css";

type ApplicationAgentQuestionsProps = Readonly<{
  applicationId: string;
  revisionId: string;
  fillAttemptId: string;
  computerSessionId: string;
  aggregateVersion: number;
  questions: readonly ApplicationAgentQuestion[];
  canContinue: boolean;
}>;

export function ApplicationAgentQuestions(props: ApplicationAgentQuestionsProps) {
  const questions = props.questions.filter((question) => question.status === "OPEN");
  if (questions.length === 0) return null;
  // Refresh preserves client state. Each new server batch needs a fresh form;
  // retries of the unchanged batch keep its command ID and entered answers.
  const batchKey = [props.applicationId, props.revisionId, props.fillAttemptId,
    props.computerSessionId, props.aggregateVersion, ...questions.map((question) => question.id)].join(":");
  return <ApplicationAgentQuestionForm key={batchKey} {...props} questions={questions} />;
}

function ApplicationAgentQuestionForm({
  applicationId, revisionId, fillAttemptId, computerSessionId, aggregateVersion, questions: openQuestions, canContinue,
}: ApplicationAgentQuestionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [invalidQuestions, setInvalidQuestions] = useState<ReadonlySet<string>>(new Set());
  const request = useRef<{ signature: string; commandId: string } | null>(null);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || saved || !canContinue) return;
    const form = new FormData(event.currentTarget);
    const invalid = new Set<string>();
    const answers = openQuestions.map((question) => {
      const raw = form.get(question.id);
      const value: AgentQuestionValue = question.kind === "MULTI_SELECT"
        ? form.getAll(question.id).map(String)
        : question.kind === "BOOLEAN" && (raw === "true" || raw === "false")
          ? raw === "true"
          : typeof raw === "string" ? raw : "";
      try { validateAgentQuestionAnswer(question, value); } catch { invalid.add(question.id); }
      return { questionId: question.id, fingerprint: question.fingerprint, value };
    });
    setInvalidQuestions(invalid);
    setMessage("");
    if (invalid.size > 0) {
      setMessage("Check the highlighted questions before continuing.");
      return;
    }
    const input = { applicationId, revisionId, fillAttemptId, computerSessionId, expectedAggregateVersion: aggregateVersion, answers };
    const signature = JSON.stringify(input);
    if (request.current?.signature !== signature) request.current = { signature, commandId: crypto.randomUUID() };
    const commandId = request.current.commandId;
    startTransition(async () => {
      try {
        const result = await saveApplicationAgentAnswersAction({ ...input, commandId });
        if (!result.ok) { setMessage(result.message); return; }
        setSaved(true);
        router.refresh();
      } catch {
        // Keep the same command for an uncertain network result; no duplicate continuation.
        setMessage("The connection was interrupted. Try again to check the same request.");
      }
    });
  }

  return (
    <section className={styles.card} aria-labelledby="application-missing-details-heading">
      <h2 id="application-missing-details-heading">A few details are missing</h2>
      <p>Answer these questions so RoleDawn can continue filling this application. These answers apply only to this application.</p>
      <form onSubmit={save}>
        <fieldset className={styles.fields} disabled={isPending || saved || !canContinue}>
          <legend className={styles.srOnly}>Application questions</legend>
          {openQuestions.map((question) => {
            const inputId = `application-question-${question.id}`;
            const invalid = invalidQuestions.has(question.id);
            const descriptionId = `${inputId}-error`;
            return (
              <div className={styles.field} key={question.id}>
                {question.kind === "MULTI_SELECT" ? (
                  <fieldset className={styles.choices} aria-describedby={invalid ? descriptionId : undefined} aria-invalid={invalid}>
                    <legend>{displayQuestionLabel(question.label)}{question.required ? <span className={styles.required}> (required)</span> : null}</legend>
                    {question.options.map((option, index) => (
                      <label className={styles.choice} htmlFor={`${inputId}-${index}`} key={option.value}>
                        <input id={`${inputId}-${index}`} name={question.id} type="checkbox" value={option.value} />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </fieldset>
                ) : (
                  <>
                    <label htmlFor={inputId}>{displayQuestionLabel(question.label)}{question.required ? <span className={styles.required}> (required)</span> : null}</label>
                    {question.kind === "LONG_TEXT" ? (
                      <textarea id={inputId} name={question.id} rows={4} required={question.required}
                        maxLength={AGENT_QUESTION_LIMITS.answerCharacters} aria-invalid={invalid} aria-describedby={invalid ? descriptionId : undefined} />
                    ) : question.kind === "SINGLE_SELECT" || question.kind === "BOOLEAN" ? (
                      <select id={inputId} name={question.id} required defaultValue="" aria-invalid={invalid} aria-describedby={invalid ? descriptionId : undefined}>
                        <option value="" disabled>Choose an answer</option>
                        {question.kind === "BOOLEAN" ? <><option value="true">Yes</option><option value="false">No</option></> :
                          question.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    ) : (
                      <input id={inputId} name={question.id} type="text" required={question.required}
                        maxLength={AGENT_QUESTION_LIMITS.answerCharacters} aria-invalid={invalid} aria-describedby={invalid ? descriptionId : undefined} />
                    )}
                  </>
                )}
                {invalid ? <span className={styles.error} id={descriptionId}>Enter an answer using the choices shown.</span> : null}
              </div>
            );
          })}
        </fieldset>
        <p className={styles.permission}>Saving lets RoleDawn enter these answers in this form. Submit stays blocked.</p>
        {!canContinue ? <p className={styles.error}>This application cannot continue right now. Reload to check its status.</p> : null}
        {message ? <p className={styles.error} role="alert">{message}</p> : null}
        {saved ? <p className={styles.success} role="status">Details saved. RoleDawn is continuing the form.</p> : (
          <button disabled={isPending || !canContinue} type="submit">{isPending ? "Saving…" : "Save and continue"}</button>
        )}
      </form>
    </section>
  );
}
