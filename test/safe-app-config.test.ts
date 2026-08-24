import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const config = require("../next.config.js") as {
  headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>;
};
const publicDirectory = resolve(process.cwd(), "public");

describe("Safe App hosting", () => {
  it("allows only Safe Wallet to frame the app", async () => {
    const routes = await config.headers();
    const appHeaders = routes.find(({ source }) => source === "/:path*")?.headers ?? [];
    const byName = Object.fromEntries(appHeaders.map(({ key, value }) => [key, value]));

    expect(byName["Content-Security-Policy"]).toBe(
      "frame-ancestors https://app.safe.global https://app.5afe.dev",
    );
    expect(byName["X-Frame-Options"]).toBeUndefined();
  });

  it("serves a cross-origin-readable root manifest with a real icon", async () => {
    const routes = await config.headers();
    const manifestHeaders = routes.find(({ source }) => source === "/manifest.json")?.headers ?? [];
    expect(manifestHeaders).toContainEqual({
      key: "Access-Control-Allow-Origin",
      value: "*",
    });

    const manifest = JSON.parse(readFileSync(`${publicDirectory}/manifest.json`, "utf8")) as {
      name: string;
      iconPath: string;
      safe_apps_permissions: unknown[];
    };
    expect(manifest.name).toBe("Revnet");
    expect(manifest.safe_apps_permissions).toEqual([]);
    expect(() => readFileSync(`${publicDirectory}${manifest.iconPath}`)).not.toThrow();
    expect(readFileSync(`${publicDirectory}${manifest.iconPath}`, "utf8")).toContain(
      'viewBox="0 0 128 128"',
    );
  });
});
