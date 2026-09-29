/** Candidate-side mailbox connection records. The sealed token never reaches the browser. */
export type CandidateMailboxConnection = Readonly<{
  provider: "GOOGLE"; emailAddress: string; connectedAt: string; lastUsedAt: string | null; lastError: string | null;
}>;
type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
async function call(client: unknown, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await (client as RpcClient).rpc(name, args);
  if (result.error) {
    const code = result.error.message?.match(/\b(?:CANDIDATE_MAILBOX_[A-Z_]+|AUTHENTICATION_REQUIRED)\b/u)?.[0];
    if (["42883", "PGRST202"].includes(result.error.code ?? "")) throw new Error("CANDIDATE_MAILBOX_UNAVAILABLE");
    throw new Error(code ?? "CANDIDATE_MAILBOX_OPERATION_FAILED");
  }
  return result.data;
}

export async function getCandidateMailboxConnection(client: unknown, candidateId: string): Promise<CandidateMailboxConnection | null> {
  if (!UUID.test(candidateId)) throw new Error("CANDIDATE_MAILBOX_INVALID");
  const value = await call(client, "get_candidate_mailbox_connection", { p_candidate_id: candidateId });
  if (value === null) return null;
  if (!record(value) || value.provider !== "GOOGLE" || typeof value.emailAddress !== "string" || typeof value.connectedAt !== "string") throw new Error("CANDIDATE_MAILBOX_PROTOCOL_INVALID");
  return Object.freeze({ provider: "GOOGLE", emailAddress: value.emailAddress, connectedAt: value.connectedAt,
    lastUsedAt: typeof value.lastUsedAt === "string" ? value.lastUsedAt : null, lastError: typeof value.lastError === "string" ? value.lastError : null });
}

export async function saveCandidateMailboxConnection(client: unknown, input: Readonly<{ candidateId: string; emailAddress: string; encryptedToken: string; keyId: string; scopes: readonly string[] }>): Promise<void> {
  if (!UUID.test(input.candidateId)) throw new Error("CANDIDATE_MAILBOX_INVALID");
  await call(client, "save_candidate_mailbox_connection", { p_candidate_id: input.candidateId, p_provider: "GOOGLE", p_email: input.emailAddress,
    p_encrypted_token: input.encryptedToken, p_key_id: input.keyId, p_scopes: [...input.scopes] });
}

/** Removes the connection and returns its sealed token once, for provider revocation. */
export async function deleteCandidateMailboxConnection(client: unknown, candidateId: string): Promise<Readonly<{ encryptedToken: string }> | null> {
  if (!UUID.test(candidateId)) throw new Error("CANDIDATE_MAILBOX_INVALID");
  const value = await call(client, "delete_candidate_mailbox_connection", { p_candidate_id: candidateId });
  if (value === null) return null;
  if (!record(value) || typeof value.encryptedToken !== "string") throw new Error("CANDIDATE_MAILBOX_PROTOCOL_INVALID");
  return Object.freeze({ encryptedToken: value.encryptedToken });
}
