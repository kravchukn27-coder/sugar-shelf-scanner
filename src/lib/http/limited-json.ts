/**
 * JSON sent to the three vision routes contains a base64 image. Do not call
 * Request.json() there: it reads an unbounded body before the schema/image
 * checks get a chance to reject it.
 *
 * The streaming cap remains authoritative when a client omits or lies about
 * Content-Length (for example, with chunked transfer encoding).
 */
export const IMAGE_JSON_BODY_LIMITS = {
  // 6 MiB of decoded image becomes at most 8 MiB in base64; reserve 64 KiB
  // for JSON keys and the small non-image fields.
  analyze: 8 * 1024 * 1024 + 64 * 1024,
  recoveryLabel: 8 * 1024 * 1024 + 64 * 1024,
  // The preflight image limit is 2 MiB decoded, so 3 MiB encoded gives the
  // same small JSON headroom without accepting a larger camera frame.
  preflight: 3 * 1024 * 1024,
} as const;

export type LimitedJsonResult =
  | { kind: "ok"; value: unknown }
  | { kind: "invalid" }
  | { kind: "too_large" };

function declaredLength(request: Request) {
  const value = request.headers.get("content-length");
  if (!value || !/^\d+$/.test(value)) return null;
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

/** Read and parse at most maxBytes from a request body without retaining chunks. */
export async function readLimitedJson(request: Request, maxBytes: number): Promise<LimitedJsonResult> {
  const contentLength = declaredLength(request);
  if (contentLength !== null && contentLength > maxBytes) return { kind: "too_large" };
  if (!request.body) return { kind: "invalid" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return { kind: "too_large" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { kind: "ok", value: JSON.parse(text) };
  } catch {
    return { kind: "invalid" };
  }
}
