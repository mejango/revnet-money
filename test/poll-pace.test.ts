import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MINIMUM_MS = 30_000;

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

/**
 * A page refreshes about every 30 seconds. A fixed interval under that is refused here; a faster
 * pace has to be a function of state, such as the short window after the user's own write.
 */
describe("poll pace", () => {
  it("has no fixed refresh interval under 30 seconds", () => {
    const fast = sources("src").flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const constant = (name: string) =>
        source.match(new RegExp(`\\b${name}\\s*(?::[^=]+)?=\\s*([\\d_]+)\\b`, "u"))?.[1];
      return [...source.matchAll(/\b(?:refetchInterval|pollInterval)\s*[:=]\s*([\w.]+)/gu)].flatMap(
        ([, value]) => {
          const literal = /^[\d_]+$/u.test(value) ? value : constant(value.split(".").at(-1)!);
          const interval = literal === undefined ? undefined : Number(literal.replaceAll("_", ""));
          return interval !== undefined && interval < MINIMUM_MS ? [`${path}: ${interval} ms`] : [];
        },
      );
    });

    expect(fast).toEqual([]);
  });
});
