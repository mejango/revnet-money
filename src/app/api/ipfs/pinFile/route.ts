import { makePinFileHandler } from "@/lib/server/ipfsPinning";

export const runtime = "nodejs";

/** Logos and profile images: small pictures. Anything bigger belongs on pinMedia. */
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/avif",
]);

export const POST = makePinFileHandler({
  maxBytes: 1024 * 1024,
  typeAllowed: (type) => ALLOWED_TYPES.has(type),
  typeError: "only image uploads are allowed",
  filename: "logo",
  pinName: "revnet-logo",
});
