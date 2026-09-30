"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setSendWhenReadyAction } from "@/app/(candidate)/apply-actions";
import ui from "@/components/app/ui.module.css";

import styles from "./SendWhenReady.module.css";

/**
 * One switch: when on, RoleDawn applies the moment this application's
 * documents pass every check. Off means the candidate reviews first.
 */
export function SendWhenReady({ applicationId, open, ready, retry = false }: Readonly<{ applicationId: string; open: boolean; ready: boolean; retry?: boolean }>) {
  const router = useRouter();
  const [on, setOn] = useState(open);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next);
    setMessage("");
    startTransition(async () => {
      try {
        const result = await setSendWhenReadyAction({ commandId: crypto.randomUUID(), applicationId, send: next });
        if (!result.ok) {
          setOn(!next);
          setMessage(result.message ?? "That change didn't save.");
          return;
        }
        router.refresh();
      } catch {
        setOn(!next);
        setMessage("The connection was interrupted. Reload to check the send request.");
      }
    });
  }

  return (
    <div className={styles.row}>
      <div>
        <strong id={`send-${applicationId}`}>{ready && on ? "Queued to apply" : retry ? "This job board is now supported" : "Send when ready"}</strong>
        <p>
          {on
            ? ready
              ? "Your send request is saved. RoleDawn will start the employer's form next. Turn this off to review first."
              : "RoleDawn will apply as soon as your documents pass every check. Turn this off to review them first."
            : retry ? "Your earlier send stopped before it could start. Retry to continue with your documents."
              : "Off: RoleDawn will prepare your documents and wait for you to press Apply."}
        </p>
        {message ? <p className={ui.noticeError} role="alert">{message}</p> : null}
      </div>
      {retry && !on ? <button className={ui.primary} disabled={pending} onClick={toggle} type="button">{pending ? "Starting…" : "Retry sending"}</button> : <button
        aria-checked={on}
        aria-labelledby={`send-${applicationId}`}
        className={ui.switch}
        disabled={pending}
        onClick={toggle}
        role="switch"
        type="button"
      >
        <span aria-hidden="true" />
      </button>}
    </div>
  );
}
