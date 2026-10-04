/** A named live cohort passes only when every application has its own employer receipt. */
export type AcceptanceBoard = "GREENHOUSE" | "LEVER" | "ASHBY";
export type AcceptanceManifest = Readonly<{
  candidateId: string;
  cases: readonly Readonly<{ applicationId: string; board: AcceptanceBoard; role: string }> [];
}>;
export type AcceptanceRecords = Readonly<{
  applications: readonly Readonly<{ id: string; candidate_id: string; status: string }> [];
  attempts: readonly Readonly<{ id: string; application_id: string; status: string }> [];
  receipts: readonly Readonly<{ id: string; application_id: string; attempt_id: string; confirmation_reference: string;
    receipt_hash: string; confirmed_at: string; evidence_manifest: unknown }> [];
}>;

export function evaluateEmployerAcceptance(manifest: AcceptanceManifest, records: AcceptanceRecords) {
  const boards: readonly AcceptanceBoard[] = ["GREENHOUSE", "LEVER", "ASHBY"];
  const ids = manifest.cases.map(item => item.applicationId);
  const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;
  if (manifest.cases.length !== 9 || new Set(ids).size !== 9 || !uuid.test(manifest.candidateId) ||
      boards.some(board => manifest.cases.filter(item => item.board === board).length !== 3) ||
      manifest.cases.some(item => !uuid.test(item.applicationId) || !item.role || !boards.includes(item.board))) {
    throw new Error("EMPLOYER_ACCEPTANCE_MANIFEST_INVALID");
  }
  const cases = manifest.cases.map(item => {
    const reasons: string[] = [];
    const applications = records.applications.filter(row => row.id === item.applicationId);
    const attempts = records.attempts.filter(row => row.application_id === item.applicationId);
    const receipts = records.receipts.filter(row => row.application_id === item.applicationId);
    const confirmed = attempts.filter(row => row.status === "CONFIRMED");
    if (applications.length !== 1 || applications[0].candidate_id !== manifest.candidateId) reasons.push("APPLICATION_IDENTITY_UNVERIFIED");
    if (applications[0]?.status !== "CONFIRMED") reasons.push("APPLICATION_NOT_CONFIRMED");
    if (attempts.some(row => ["STARTED", "UNCERTAIN"].includes(row.status))) reasons.push("ATTEMPT_OUTCOME_UNCERTAIN");
    if (confirmed.length !== 1) reasons.push("CONFIRMED_ATTEMPT_COUNT_INVALID");
    if (receipts.length !== 1) reasons.push("EMPLOYER_RECEIPT_COUNT_INVALID");
    const receipt = receipts[0];
    const evidence = receipt?.evidence_manifest;
    const manifestAttemptId = evidence && typeof evidence === "object" && !Array.isArray(evidence) ?
      (evidence as Record<string, unknown>).attemptId : null;
    if (receipt && (receipt.attempt_id !== confirmed[0]?.id || manifestAttemptId !== receipt.attempt_id ||
        !/^https:\/\//u.test(receipt.confirmation_reference) || !/^[a-f0-9]{64}$/u.test(receipt.receipt_hash) ||
        !Number.isFinite(Date.parse(receipt.confirmed_at)))) reasons.push("RECEIPT_EVIDENCE_UNVERIFIED");
    return { ...item, passed: reasons.length === 0, reasons, attemptCount: attempts.length,
      receiptId: receipt?.id ?? null, confirmedAt: receipt?.confirmed_at ?? null };
  });
  const counts = Object.fromEntries(boards.map(board => [board, cases.filter(item => item.board === board && item.passed).length])) as Record<AcceptanceBoard, number>;
  return { passed: cases.every(item => item.passed), confirmed: cases.filter(item => item.passed).length, counts, cases };
}
