type User = Readonly<{ id: string; email?: string }>;
type Result<T> = Readonly<{ data: T; error: unknown }>;

export type SingleAccountSessionPorts = Readonly<{
  getUser: (userId: string) => Promise<Result<{ user: User | null }>>;
  generateLink: (email: string) => Promise<Result<{ user: User | null; properties: { hashed_token: string } | null }>>;
  verify: (tokenHash: string) => Promise<Result<{ user: User | null }>>;
  clearLocalSession: () => Promise<unknown>;
}>;

/** Never creates an account or trusts a browser-supplied identity. */
export async function establishSingleAccountSession(userId: string, ports: SingleAccountSessionPorts): Promise<void> {
  const existing = await ports.getUser(userId);
  const user = existing.data.user;
  if (existing.error || user?.id !== userId || !user.email?.toLowerCase().endsWith("@local.invalid")) {
    throw new Error("SINGLE_ACCOUNT_EXISTING_TEST_USER_REQUIRED");
  }
  const generated = await ports.generateLink(user.email);
  if (generated.error || generated.data.user?.id !== userId || !generated.data.properties?.hashed_token) {
    throw new Error("SINGLE_ACCOUNT_LINK_FAILED");
  }
  let verified: Awaited<ReturnType<SingleAccountSessionPorts["verify"]>>;
  try {
    verified = await ports.verify(generated.data.properties.hashed_token);
  } catch {
    await ports.clearLocalSession();
    throw new Error("SINGLE_ACCOUNT_SESSION_FAILED");
  }
  if (verified.error || verified.data.user?.id !== userId) {
    await ports.clearLocalSession();
    throw new Error("SINGLE_ACCOUNT_SESSION_FAILED");
  }
}
