import { makePinFileHandler } from "@/lib/server/ipfsPinning";

export const runtime = "nodejs";

/** Shop-item media: any common media type, with a larger cap than logos. */
export const POST = makePinFileHandler({
  maxBytes: 25 * 1024 * 1024,
  typeAllowed: (type, name) =>
    type.startsWith("image/") ||
    type.startsWith("video/") ||
    type.startsWith("audio/") ||
    type === "application/pdf" ||
    type.startsWith("text/") ||
    /\.(md|markdown|txt)$/iu.test(name),
  typeError: "images, video, audio, PDF, or text only",
  filename: "media",
  pinName: "revnet-item-media",
});
