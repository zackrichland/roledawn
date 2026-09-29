"use client";

import { useRef, useState, useTransition, type DragEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { finishDirectResumeUploadAction, reserveDirectResumeUploadAction } from "@/app/vault/actions";
import ui from "@/components/app/ui.module.css";
import { DIRECT_RESUME_MAX_BYTES, resumeUploadMediaType } from "@/domain/resume-direct-upload";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

import styles from "./ResumeUpload.module.css";

export function ResumeUploadForm({ compact = false, pendingVersionId }: Readonly<{ compact?: boolean; pendingVersionId?: string }>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState("");
  const [succeeded, setSucceeded] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<{ signature: string; commandId: string } | null>(null);

  async function finalize(versionId: string) {
    setPhase("Reading your résumé…");
    const result = await finishDirectResumeUploadAction(versionId);
    setSucceeded(result.ok);
    setMessage(result.ok ? "Uploaded. Check the text below." : result.message);
    if (result.ok) router.refresh();
  }

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (!file || !input.current) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.current.files = transfer.files;
    request.current = null;
    setChosen(file.name);
    setMessage("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setSucceeded(false);
    const file = new FormData(event.currentTarget).get("resume");
    if (!(file instanceof File) || file.size < 1 || file.size > DIRECT_RESUME_MAX_BYTES) {
      setMessage("Choose a PDF or Word (.docx) file under 10 MB.");
      return;
    }
    const filename = file.name.trim().normalize("NFC");
    const mediaType = resumeUploadMediaType(filename, file.type);
    if (!mediaType) {
      setMessage("That file isn't a PDF or Word (.docx) document.");
      return;
    }
    setMessage("");
    startTransition(async () => {
      try {
        setPhase("Checking the file…");
        const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
        const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        const signature = JSON.stringify({ filename, mediaType, byteSize: file.size, sha256 });
        if (request.current?.signature !== signature) request.current = { signature, commandId: crypto.randomUUID() };
        const result = await reserveDirectResumeUploadAction({
          commandId: request.current.commandId, resumeVersionId: pendingVersionId, filename, mediaType, byteSize: file.size, sha256,
        });
        if (!result.ok) {
          setMessage(result.message);
          return;
        }
        if (result.target.status === "RESERVED") {
          setPhase("Uploading…");
          // File bytes go directly to private Storage, outside the Netlify request.
          // Existing RLS authorizes this exact, still-live reservation on INSERT.
          await createSupabaseBrowserClient().storage.from(result.target.bucket).upload(result.target.path, file, {
            contentType: mediaType, upsert: false, cacheControl: "3600",
          });
          // A lost response or duplicate object is reconciled by reading and hashing
          // the actual reserved object server-side. Never overwrite it to retry.
        }
        await finalize(result.target.documentVersionId);
      } catch {
        setMessage("The connection dropped. Try again; RoleDawn will pick up the same upload.");
      } finally {
        setPhase("");
      }
    });
  }

  const id = compact ? "replacement-resume" : "resume";
  return (
    <form className={compact ? styles.compact : styles.form} onSubmit={submit}>
      {pendingVersionId ? (
        <button
          className={ui.primary}
          disabled={pending}
          onClick={() => startTransition(async () => {
            try { await finalize(pendingVersionId); } catch { setMessage("The upload couldn't be checked. Try again."); } finally { setPhase(""); }
          })}
          type="button"
        >
          Finish the upload that already started
        </button>
      ) : null}
      <label
        className={styles.drop}
        data-dragging={dragging}
        htmlFor={id}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDrop={drop}
      >
        <span className={styles.icon} aria-hidden="true">
          <svg fill="none" height="22" viewBox="0 0 24 24" width="22"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" /><path d="M14 3v5h5M9 13h6M9 17h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" /></svg>
        </span>
        <span>
          <strong>{chosen ?? (compact ? "Choose a new file" : "Drop your résumé here, or choose a file")}</strong>
          <small>PDF or Word (.docx), up to 10 MB</small>
        </span>
        <input
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          aria-describedby={message ? `${id}-message` : undefined}
          className={styles.input}
          disabled={pending}
          id={id}
          name="resume"
          onChange={(event) => { request.current = null; setMessage(""); setChosen(event.currentTarget.files?.[0]?.name ?? null); }}
          ref={input}
          required
          type="file"
        />
      </label>
      {message ? <p className={succeeded ? ui.noticeSuccess : ui.noticeError} id={`${id}-message`} role="status">{message}</p> : null}
      <button className={compact ? ui.secondary : ui.cta} disabled={pending || !chosen} type="submit">
        {pending ? phase || "Uploading…" : compact ? "Replace résumé" : "Upload"}
      </button>
    </form>
  );
}
