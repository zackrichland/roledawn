export type CareerVaultStatus =
  | "empty"
  | "uploading"
  | "needs-review"
  | "ready"
  | "error";

export type CareerVaultDocumentView = Readonly<{
  documentId: string;
  documentAggregateVersion: number;
  documentVersionId: string;
  extractionId: string;
  versionNumber: number;
  filename: string;
  mimeType: "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  byteSize: number;
  uploadedAt: string;
  extractedText: string;
}>;

export type CareerVaultViewModel = Readonly<{
  actorLabel: string;
  status: CareerVaultStatus;
  recoveryKind: "upload" | "deletion" | null;
  document: CareerVaultDocumentView | null;
  deletionTarget: Readonly<{
    documentId: string;
    documentAggregateVersion: number;
  }> | null;
  errorMessage: string | null;
}>;

export type VaultActionState = Readonly<{
  outcome: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Readonly<{
    resume?: string;
    extractedText?: string;
  }>;
}>;

export type VaultFormAction = (
  previousState: VaultActionState,
  formData: FormData,
) => Promise<VaultActionState>;

export const EMPTY_VAULT_ACTION_STATE: VaultActionState = {
  outcome: "idle",
  message: "",
};
