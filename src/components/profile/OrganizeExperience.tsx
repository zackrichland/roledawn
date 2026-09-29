"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { requestCareerProfileAction } from "@/app/(candidate)/vault/knowledge-actions";
import ui from "@/components/app/ui.module.css";

export function OrganizeExperience({ label }: Readonly<{ label: string }>) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const command = useRef<string | null>(null);
  return (
    <>
      <button
        className={ui.primary}
        disabled={pending}
        onClick={() => startTransition(async () => {
          setMessage("");
          command.current ??= crypto.randomUUID();
          const result = await requestCareerProfileAction(command.current);
          if (!result.ok) {
            setMessage(result.message);
            command.current = null;
            return;
          }
          router.refresh();
        })}
        type="button"
      >
        {pending ? "Starting…" : label}
      </button>
      {message ? <p className={ui.noticeError} role="alert">{message}</p> : null}
    </>
  );
}
