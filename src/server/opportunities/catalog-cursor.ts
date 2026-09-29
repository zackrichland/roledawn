export type CatalogCursor = Readonly<{
  jobId: string;
  observedAt: string;
  /** Relevance tier of the last row when results are ranked (0–4). */
  tier?: number;
}>;

const MAX_CURSOR_LENGTH = 512;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function encodeCatalogCursor(cursor: CatalogCursor): string {
  if (!isUuid(cursor.jobId) || Number.isNaN(Date.parse(cursor.observedAt))) {
    throw new Error("OPPORTUNITY_CURSOR_INVALID");
  }

  if (cursor.tier !== undefined && (!Number.isInteger(cursor.tier) || cursor.tier < 0 || cursor.tier > 4)) {
    throw new Error("OPPORTUNITY_CURSOR_INVALID");
  }
  return Buffer.from(JSON.stringify({
    j: cursor.jobId,
    o: new Date(cursor.observedAt).toISOString(),
    ...(cursor.tier !== undefined ? { t: cursor.tier } : {}),
  }), "utf8").toString("base64url");
}

export function decodeCatalogCursor(value: string): CatalogCursor | null {
  const token = value.trim();
  if (!token || token.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/u.test(token)) return null;

  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    if (!decoded || decoded.length > MAX_CURSOR_LENGTH) return null;
    const parsed: unknown = JSON.parse(decoded);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

    const candidate = parsed as Readonly<Record<string, unknown>>;
    if (typeof candidate.j !== "string" || !isUuid(candidate.j)) return null;
    if (typeof candidate.o !== "string" || Number.isNaN(Date.parse(candidate.o))) return null;

    const tier = typeof candidate.t === "number" && Number.isInteger(candidate.t) && candidate.t >= 0 && candidate.t <= 4
      ? candidate.t : undefined;
    if (candidate.t !== undefined && tier === undefined) return null;
    return Object.freeze({
      jobId: candidate.j,
      observedAt: new Date(candidate.o).toISOString(),
      ...(tier !== undefined ? { tier } : {}),
    });
  } catch {
    return null;
  }
}
