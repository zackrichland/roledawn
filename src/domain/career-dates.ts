import type { CareerPosition } from "./career-profile.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function displayCareerDate(value: string | null): string | null {
  if (!value) return null;
  const [year, month] = value.split("-");
  return month ? `${MONTHS[Number(month) - 1]} ${year}` : year ?? null;
}

/** "Mar 2024 – Present", "2019 – 2020", or null when no dates are known. */
export function displayCareerRange(startDate: string | null, endDate: string | null, current: boolean): string | null {
  const start = displayCareerDate(startDate);
  const end = current ? "Present" : displayCareerDate(endDate);
  if (start && end) {
    // Use the same granularity on both sides when one side has only a year.
    return start === end ? start : `${start} – ${end}`;
  }
  return start ?? end ?? null;
}

/** Newest first: current roles, then by end date, then by start date. */
export function sortPositionsNewestFirst(positions: readonly CareerPosition[]): readonly CareerPosition[] {
  const rank = (position: CareerPosition) => `${position.current ? "9999-99" : (position.endDate ?? position.startDate ?? "0000").padEnd(7, "-")}|${(position.startDate ?? "0000").padEnd(7, "-")}`;
  return [...positions].sort((left, right) => rank(right).localeCompare(rank(left)));
}

