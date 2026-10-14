import { useChosen } from "@/hooks/useChosen";
import { act, renderHook } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";

describe("useChosen", () => {
  it("keys a seeded value as auto, a typed one as itself and a picked option by its name", () => {
    const { result } = renderHook(() => useChosen("", "amount"));
    expect(result.current.key(1n)).toBe("auto:amount");
    act(() => result.current.set("1.0"));
    expect(result.current.key(1n)).toBe(1n);
    act(() => result.current.choose("max", "4.2"));
    expect(result.current.key(4n)).toBe("policy:max");
  });

  it("keeps a picked option through the app's adjustment, and makes a typed value the app's", () => {
    const { result } = renderHook(() => useChosen("", "amount"));
    act(() => result.current.choose("max", "4.2"));
    act(() => result.current.fill("4.1"));
    expect(result.current.key(4n)).toBe("policy:max");
    act(() => result.current.set("3"));
    act(() => result.current.fill("2"));
    expect(result.current.key(2n)).toBe("auto:amount");
  });
});

describe("useChosen in an effect", () => {
  it("settles when an effect seeds it on every render, with no render loop", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      const chosen = useChosen("", "amount");
      // An effect that seeds the value it already holds, each render, as a form's reset does.
      useEffect(() => chosen.seed("5"));
      return chosen;
    });
    expect(result.current.value).toBe("5");
    expect(renders).toBeLessThan(5);
  });
});
