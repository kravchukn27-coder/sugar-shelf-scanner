/**
 * Formats a validated sugar value for display only. `null`, `undefined`,
 * negative values, and non-finite values return `null` so callers can choose
 * their own empty-state copy. It never normalizes or changes the score value
 * used by calculations.
 */
export function formatSugarPer100g(sugarPer100g: number | null | undefined): string | null {
  if (
    typeof sugarPer100g !== "number"
    || !Number.isFinite(sugarPer100g)
    || sugarPer100g < 0
  ) {
    return null;
  }

  // Round only the presentation value. The small epsilon prevents common
  // binary floating-point representation errors at a one-decimal boundary.
  const rounded = Math.round((sugarPer100g + Number.EPSILON) * 10) / 10;
  return rounded.toFixed(1).replace(/\.0$/, "");
}
