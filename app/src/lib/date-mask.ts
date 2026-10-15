/**
 * The MM/YYYY date mask for the entry editor.
 *
 * Dates are stored as typed text — "08/2018", or just "2018" — so the mask
 * has one job: whatever the user types or pastes, the field only ever holds a
 * prefix of one of those two shapes. The slash is inserted, never typed, so
 * "082018" becomes "08/2018" and a typed "/" can't double it up.
 */

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Mask raw input. `deleting` is true when the edit removed characters, so a
 * backspace over the slash isn't immediately undone by re-inserting it.
 */
export function maskMonthYear(raw: string, deleting = false): string {
  const digits = raw.replace(/\D/g, "").slice(0, 6);
  if (!digits) return "";

  // Four digits that can't start a month ("2018": 20 isn't a month) are a year.
  const month = Number(digits.slice(0, 2));
  if (digits.length >= 3 && (month < 1 || month > 12)) return digits.slice(0, 4);

  // One digit could start a month or a year, so it waits for the second.
  // Two digits that form a month get their slash.
  if (digits.length <= 2) {
    if (digits.length === 2 && !deleting && month >= 1 && month <= 12) return `${digits}/`;
    return digits;
  }
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

/** A complete value worth storing: empty, MM/YYYY, or YYYY. */
export function isCompleteDate(value: string): boolean {
  return value === "" || /^(0[1-9]|1[0-2])\/\d{4}$/.test(value) || /^\d{4}$/.test(value);
}

export function parseMonthYear(value: string): { month: number | null; year: number | null } {
  const my = value.match(/^(0[1-9]|1[0-2])\/(\d{4})$/);
  if (my) return { month: Number(my[1]), year: Number(my[2]) };
  const y = value.match(/^(\d{4})$/);
  if (y) return { month: null, year: Number(y[1]) };
  return { month: null, year: null };
}

export function formatMonthYear(month: number | null, year: number | null): string {
  if (year === null) return "";
  return month === null ? String(year) : `${String(month).padStart(2, "0")}/${year}`;
}
