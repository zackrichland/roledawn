export function applicationInputsChanged(
  currentCandidateInputVersion: number,
  snapshotCandidateInputVersion: number,
): boolean {
  if (
    !Number.isSafeInteger(currentCandidateInputVersion) ||
    currentCandidateInputVersion < 1 ||
    !Number.isSafeInteger(snapshotCandidateInputVersion) ||
    snapshotCandidateInputVersion < 1
  ) {
    throw new Error("APPLICATION_INPUT_VERSION_INVALID");
  }

  return currentCandidateInputVersion !== snapshotCandidateInputVersion;
}
