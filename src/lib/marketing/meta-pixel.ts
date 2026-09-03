/**
 * Meta Pixel IDs are public browser identifiers, but keeping the value in an
 * environment variable lets staging and local development stay untracked.
 */
export function metaPixelId(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && /^\d{5,30}$/.test(normalized) ? normalized : null;
}
