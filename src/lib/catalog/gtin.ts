/**
 * Accept only GTIN variants that can be used for a product lookup. This is
 * deliberately shared by the browser recovery flow and the server contract:
 * a syntactically valid number with a bad check digit is never looked up.
 */
export function isValidGtin(value: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(value)) return false;

  let sum = 0;
  for (let index = value.length - 2, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(value[index]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(value.at(-1));
}

/** Normalise a scanner/OCR string without treating arbitrary text as a GTIN. */
export function parseGtin(value: string | undefined): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  return isValidGtin(digits) ? digits : null;
}
