import { withWriteIntent, writeIntentOf } from "@/lib/write-hold";
import { intent, type IntentValue } from "@bananapus/nana-sdk-core/review";
import { describe, expect, it } from "vitest";

/** The intent `params` give a write. */
const intentOf = (params: { [name: string]: IntentValue }) => {
  let seen: unknown;
  withWriteIntent((variables: object) => (seen = variables), "pay", params)({});
  return writeIntentOf(seen as never);
};

describe("write intent keys", () => {
  it("keep free text as typed, and compare tagged addresses case-blind", () => {
    expect(intentOf({ memo: "0xAbC" })).not.toBe(intentOf({ memo: "0xabc" }));
    expect(intentOf({ memo: "Hello" })).not.toBe(intentOf({ memo: "hello" }));
    expect(intentOf({ token: intent.address("0x000000000000000000000000000000000000dEaD") })).toBe(
      intentOf({ token: intent.address("0x000000000000000000000000000000000000dead") }),
    );
  });
});
