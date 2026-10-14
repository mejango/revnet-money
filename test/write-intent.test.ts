import { withWriteIntent, writeIntentOf } from "@/lib/write-intent";
import { describe, expect, it } from "vitest";

/** The intent `params` give a write. */
const intentOf = (params: Record<string, unknown>) => {
  let seen: unknown;
  withWriteIntent((variables: object) => (seen = variables), "pay", params)({});
  return writeIntentOf(seen as never);
};

describe("write intent keys", () => {
  it("keep free text as typed, and normalize only addresses", () => {
    expect(intentOf({ memo: "0xAbC" })).not.toBe(intentOf({ memo: "0xabc" }));
    expect(intentOf({ memo: "Hello" })).not.toBe(intentOf({ memo: "hello" }));
    expect(intentOf({ token: "0x000000000000000000000000000000000000dEaD" })).toBe(
      intentOf({ token: "0x000000000000000000000000000000000000dead" }),
    );
  });
});
