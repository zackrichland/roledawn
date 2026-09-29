"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { retryImportAction } from "@/app/(candidate)/applications/[applicationId]/actions";
import ui from "@/components/app/ui.module.css";

export function RetryImport({ applicationId }: Readonly<{ applicationId: string }>) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const command = useRef<string | null>(null);
  return (
    <>
      <button
        className={`${ui.primary} ${ui.small}`}
        disabled={pending}
        onClick={() => startTransition(async () => {
          setMessage("");
          command.current ??= crypto.randomUUID();
          const result = await retryImportAction({ commandId: command.current, applicationId });
          if (!result.ok) {
            setMessage(result.message ?? "The retry didn't start.");
            command.current = null;
            return;
          }
          router.refresh();
        })}
        type="button"
      >
        {pending ? "Retrying…" : "Try again"}
      </button>
      {message ? <p className={ui.noticeError} role="alert">{message}</p> : null}
    </>
  );
}
