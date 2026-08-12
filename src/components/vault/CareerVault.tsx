"use client";

import { useActionState } from "react";

import { AuthenticatedAppShell } from "@/components/ui/AuthenticatedAppShell";
import { Icon } from "@/components/ui/Icon";
import type {
  CareerVaultDocumentView,
  CareerVaultStatus,
  CareerVaultViewModel,
  VaultActionState,
  VaultFormAction,
} from "@/domain/career-vault";
import { EMPTY_VAULT_ACTION_STATE } from "@/domain/career-vault";

import styles from "./CareerVault.module.css";

type CareerVaultProps = Readonly<{
  initialData: CareerVaultViewModel;
  uploadAction: VaultFormAction;
  saveReviewAction: VaultFormAction;
  deleteAction: VaultFormAction;
  signOutAction: () => Promise<void>;
}>;

const STATUS_COPY: Record<CareerVaultStatus, Readonly<{ label: string; detail: string }>> = {
  empty: {
    label: "No résumé",
    detail: "Upload a source résumé to begin.",
  },
  uploading: {
    label: "Preparing text",
    detail: "Keep this page open while the file is validated and its text is extracted.",
  },
  "needs-review": {
    label: "Needs review",
    detail: "Compare the extracted text with your source file.",
  },
  ready: {
    label: "Reviewed",
    detail: "This résumé text is ready to support future drafting.",
  },
  error: {
    label: "Needs attention",
    detail: "The source résumé was not made ready.",
  },
};

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Size unavailable";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function fileTypeLabel(mimeType: CareerVaultDocumentView["mimeType"]): string {
  return mimeType === "application/pdf" ? "PDF" : "DOCX";
}

function ActionMessage({ state }: { state: VaultActionState }) {
  if (!state.message) return null;
  return (
    <p
      aria-live="polite"
      className={state.outcome === "error" ? styles.formError : styles.formSuccess}
      role={state.outcome === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

function UploadForm({
  action,
  compact = false,
}: {
  action: VaultFormAction;
  compact?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_VAULT_ACTION_STATE);

  return (
    <form action={formAction} className={compact ? styles.compactUpload : styles.uploadForm}>
      <label className={styles.filePicker} htmlFor={compact ? "replacement-resume" : "resume"}>
        <span className={styles.filePickerIcon}><Icon name="document" size={25} /></span>
        <span>
          <strong>{compact ? "Choose a replacement" : "Choose your résumé"}</strong>
          <small>PDF or DOCX · 10 MB maximum</small>
        </span>
        <input
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          aria-describedby={state.fieldErrors?.resume ? "resume-error" : undefined}
          disabled={pending}
          id={compact ? "replacement-resume" : "resume"}
          name="resume"
          required
          type="file"
        />
      </label>
      {state.fieldErrors?.resume ? <p className={styles.fieldError} id="resume-error">{state.fieldErrors.resume}</p> : null}
      <ActionMessage state={state} />
      <button className={styles.darkButton} disabled={pending} type="submit">
        {pending ? "Uploading…" : compact ? "Replace résumé" : "Upload résumé"}
        {!pending ? <Icon name="arrow" size={17} /> : null}
      </button>
    </form>
  );
}

function SourceMetadata({ document }: { document: CareerVaultDocumentView }) {
  return (
    <dl className={styles.sourceMetadata}>
      <div>
        <dt>Source file</dt>
        <dd title={document.filename}>{document.filename}</dd>
      </div>
      <div>
        <dt>Format</dt>
        <dd>{fileTypeLabel(document.mimeType)} · {formatFileSize(document.byteSize)}</dd>
      </div>
      <div>
        <dt>Uploaded</dt>
        <dd>{formatUploadDate(document.uploadedAt)}</dd>
      </div>
      <div>
        <dt>Version</dt>
        <dd>{document.versionNumber}</dd>
      </div>
    </dl>
  );
}

function ReviewForm({
  action,
  document,
  ready,
}: {
  action: VaultFormAction;
  document: CareerVaultDocumentView;
  ready: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_VAULT_ACTION_STATE);

  return (
    <form action={formAction} className={styles.reviewForm}>
      <input name="documentId" type="hidden" value={document.documentId} />
      <input name="documentVersionId" type="hidden" value={document.documentVersionId} />
      <input name="extractionId" type="hidden" value={document.extractionId} />
      <input name="expectedAggregateVersion" type="hidden" value={document.documentAggregateVersion} />
      <div className={styles.reviewHeading}>
        <div>
          <label htmlFor="extracted-text">{ready ? "Reviewed résumé text" : "Extracted résumé text"}</label>
          <p>{ready ? "Correct the saved text whenever your source changes." : "Fix missing characters, spacing, or any text that does not match your résumé."}</p>
        </div>
        <span>{document.extractedText.length.toLocaleString("en-US")} characters</span>
      </div>
      <textarea
        aria-describedby={state.fieldErrors?.extractedText ? "extracted-text-error" : "text-review-note"}
        defaultValue={document.extractedText}
        disabled={pending}
        id="extracted-text"
        key={document.documentVersionId}
        name="extractedText"
        required
        spellCheck
      />
      {state.fieldErrors?.extractedText ? <p className={styles.fieldError} id="extracted-text-error">{state.fieldErrors.extractedText}</p> : null}
      <p className={styles.reviewNote} id="text-review-note">
        Saving confirms this transcription. Sensitive and exact application answers still require their own reviewed records.
      </p>
      <ActionMessage state={state} />
      <div className={styles.reviewActions}>
        <span><Icon name="check" size={16} /> Nothing is sent to an employer from this page.</span>
        <button className={styles.darkButton} disabled={pending} type="submit">
          {pending ? "Saving…" : ready ? "Save changes" : "Review and save"}
        </button>
      </div>
    </form>
  );
}

function DeleteResumeForm({
  action,
  documentId,
  documentAggregateVersion,
  recoveryKind = null,
}: {
  action: VaultFormAction;
  documentId: string;
  documentAggregateVersion: number;
  recoveryKind?: "upload" | "deletion" | null;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_VAULT_ACTION_STATE);

  return (
    <details className={styles.deletePanel}>
      <summary>
        {recoveryKind === "upload"
          ? "Remove unfinished upload"
          : recoveryKind === "deletion"
            ? "Retry removal"
            : "Remove résumé"}
      </summary>
      <form action={formAction}>
        <input name="documentId" type="hidden" value={documentId} />
        <input name="expectedAggregateVersion" type="hidden" value={documentAggregateVersion} />
        <p>This permanently removes the original file and its extracted and reviewed text from your Career Vault.</p>
        <label className={styles.deleteConfirmation}>
          <input disabled={pending} name="confirmDelete" required type="checkbox" value="yes" />
          <span>I understand this résumé and its saved text will be deleted.</span>
        </label>
        <ActionMessage state={state} />
        <button className={styles.dangerButton} disabled={pending} type="submit">
          {pending ? "Removing…" : "Permanently remove résumé"}
        </button>
      </form>
    </details>
  );
}

export function CareerVault({
  initialData,
  uploadAction,
  saveReviewAction,
  deleteAction,
  signOutAction,
}: CareerVaultProps) {
  const status = STATUS_COPY[initialData.status];
  const document = initialData.document;

  return (
    <AuthenticatedAppShell active="resume" actorLabel={initialData.actorLabel} signOutAction={signOutAction}>
      <main className={styles.shell}>
      <section className={styles.content}>
        <header className={styles.banner}>
          <div>
            <span className={styles.eyebrow}>Career Vault</span>
            <h1>Résumé</h1>
            <p>Keep one reviewed résumé ready for future application drafts.</p>
          </div>
          <div className={`${styles.status} ${styles[`status--${initialData.status}`]}`}>
            <i aria-hidden="true" />
            <span>
              <strong>{status.label}</strong>
              <small>{status.detail}</small>
            </span>
          </div>
        </header>

        <div className={styles.grid}>
          <section className={styles.card} aria-labelledby="resume-source-heading">
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.sectionLabel}>Primary source</span>
                <h2 id="resume-source-heading">Résumé</h2>
              </div>
              {document ? <span className={styles.versionBadge}>Version {document.versionNumber}</span> : null}
            </div>

            {initialData.status === "empty" ? (
              <div className={styles.emptyState}>
                <div>
                  <h3>Add the résumé you trust.</h3>
                  <p>RoleDawn stores the original privately, validates its format, extracts a working text copy, and waits for your review.</p>
                </div>
                <UploadForm action={uploadAction} />
              </div>
            ) : null}

            {initialData.status === "uploading" ? (
              <div className={styles.uploadingState} aria-live="polite" role="status">
                <span className={styles.spinner} aria-hidden="true" />
                <div>
                  <h3>Preparing your résumé text.</h3>
                  <p>If this state persists after reloading, remove the unfinished upload and try again.</p>
                  {initialData.deletionTarget ? (
                    <DeleteResumeForm
                      action={deleteAction}
                      documentAggregateVersion={initialData.deletionTarget.documentAggregateVersion}
                      documentId={initialData.deletionTarget.documentId}
                      recoveryKind="upload"
                    />
                  ) : null}
                </div>
              </div>
            ) : null}

            {initialData.status === "error" ? (
              <div className={styles.errorState} role="alert">
                <div>
                  <h3>The résumé is not ready.</h3>
                  <p>{initialData.errorMessage ?? "The file could not be prepared. No résumé text was approved."}</p>
                </div>
                <div>
                  {initialData.recoveryKind === "deletion" ? null : <UploadForm action={uploadAction} />}
                  {initialData.deletionTarget ? (
                    <DeleteResumeForm
                      action={deleteAction}
                      documentAggregateVersion={initialData.deletionTarget.documentAggregateVersion}
                      documentId={initialData.deletionTarget.documentId}
                      recoveryKind={initialData.recoveryKind}
                    />
                  ) : null}
                </div>
              </div>
            ) : null}

            {(initialData.status === "needs-review" || initialData.status === "ready") && document ? (
              <>
                <SourceMetadata document={document} />
                <ReviewForm action={saveReviewAction} document={document} ready={initialData.status === "ready"} />
                <details className={styles.replacePanel}>
                  <summary>Replace source résumé</summary>
                  <p>A replacement creates a new source version. The current reviewed version remains identifiable.</p>
                  <UploadForm action={uploadAction} compact />
                </details>
                <DeleteResumeForm
                  action={deleteAction}
                  documentAggregateVersion={document.documentAggregateVersion}
                  documentId={document.documentId}
                />
              </>
            ) : null}

            {(initialData.status === "needs-review" || initialData.status === "ready") && !document ? (
              <div className={styles.errorState} role="alert">
                <div>
                  <h3>The résumé record is incomplete.</h3>
                  <p>Reload the page. If the problem remains, upload the source résumé again.</p>
                </div>
                <UploadForm action={uploadAction} />
              </div>
            ) : null}
          </section>

          <aside className={styles.guide} aria-labelledby="vault-guide-heading">
            <span className={styles.sectionLabel}>How it works</span>
            <h2 id="vault-guide-heading">Source first. Then review.</h2>
            <ol>
              <li><span>1</span><div><strong>Upload</strong><p>Add a PDF or DOCX résumé.</p></div></li>
              <li><span>2</span><div><strong>Compare</strong><p>Check the extracted text against your file.</p></div></li>
              <li><span>3</span><div><strong>Save</strong><p>Confirm the text before it supports drafting.</p></div></li>
            </ol>
            <div className={styles.boundaryNote}>
              <Icon name="vault" size={20} />
              <p>The source file stays private. Uploading a résumé does not approve or submit an application.</p>
            </div>
          </aside>
        </div>
      </section>
      </main>
    </AuthenticatedAppShell>
  );
}
