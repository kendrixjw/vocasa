// Imperial unit helpers. Everything internal is inches; these format for the
// user (feet-inches).

/**
 * Format inches as feet-and-inches, e.g. 150 -> `12' 6"`. Rounds inches to the
 * nearest whole inch for a clean readout. Handles negatives correctly.
 */
export function formatFeetInches(inches: number): string {
  const sign = inches < 0 ? "-" : "";
  const total = Math.round(Math.abs(inches));
  const feet = Math.floor(total / 12);
  const rem = total % 12;
  return `${sign}${feet}' ${rem}"`;
}

/** Convert feet to inches. */
export function feetToInches(feet: number): number {
  return feet * 12;
}
