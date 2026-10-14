import { launchIntent, launchSalt, settleLaunchSalt } from "@/app/create/helpers/launchIntent";
import { beforeEach, describe, expect, it } from "vitest";

const ACCOUNT = "0x000000000000000000000000000000000000dEaD";

beforeEach(() => window.localStorage.clear());

describe("a launch's intent and salt", () => {
  it("is the user's config alone, whatever order its fields are in", () => {
    expect(launchIntent({ name: "Rev", stages: [{ price: "1" }] })).toEqual(
      launchIntent({ stages: [{ price: "1" }], name: "Rev" }),
    );
    expect(launchIntent({ name: "Rev" })).not.toEqual(launchIntent({ name: "Rev2" }));
  });

  it("keeps the salt of an unsettled launch across retries and reloads, so the chain refuses a second deploy", () => {
    const salt = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
    const first = launchSalt(ACCOUNT, 1, { name: "Rev" }, () => salt(1));
    expect(launchSalt(ACCOUNT, 1, { name: "Rev" }, () => salt(2))).toBe(first);
    expect(launchSalt(ACCOUNT, 10, { name: "Rev" }, () => salt(2))).toBe(salt(2));
    settleLaunchSalt(ACCOUNT, 1, { name: "Rev" });
    expect(launchSalt(ACCOUNT, 1, { name: "Rev" }, () => salt(3))).toBe(salt(3));
  });
});
