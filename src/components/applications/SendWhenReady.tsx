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
export function SendWhenReady({ applicationId, open, ready }: Readonly<{ applicationId: string; open: boolean; ready: boolean }>) {
  const router = useRouter();
  const [on, setOn] = useState(open);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next);
    setMessage("");
    startTransition(async () => {
      const result = await setSendWhenReadyAction({ commandId: crypto.randomUUID(), applicationId, send: next });
      if (!result.ok) {
        setOn(!next);
        setMessage(result.message ?? "That change didn't save.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className={styles.row}>
      <div>
        <strong id={`send-${applicationId}`}>{ready && on ? "Sending in a moment" : "Send when ready"}</strong>
        <p>
          {on
            ? ready
              ? "Your documents passed every check. RoleDawn is starting the application. Turn this off to stop it before it starts."
              : "RoleDawn will apply as soon as your documents pass every check. Turn this off to review them first."
            : "Off: RoleDawn will prepare your documents and wait for you to press Apply."}
        </p>
        {message ? <p className={ui.noticeError} role="alert">{message}</p> : null}
      </div>
      <button
        aria-checked={on}
        aria-labelledby={`send-${applicationId}`}
        className={ui.switch}
        disabled={pending}
        onClick={toggle}
        role="switch"
        type="button"
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );
}
