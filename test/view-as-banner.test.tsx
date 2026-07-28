import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const VIEWED = "0x000000000000000000000000000000000000bEEF" as Address;
const STORAGE_KEY = "revnet:view-as:v1";

vi.mock("@/hooks/ens/useEnsName", () => ({ useEnsName: () => ({ data: "viewed.eth" }) }));

// EthereumAddress renders through EtherscanLink, whose chain fallback reads
// wagmi context. The banner passes an explicit chain; stub the context hooks.
vi.mock("wagmi", () => ({
  useChainId: () => 1,
  useChains: () => [],
  usePublicClient: () => undefined,
  useReadContract: () => ({ data: undefined }),
}));

async function freshModules() {
  vi.resetModules();
  const [viewAsLib, banner] = await Promise.all([
    import("@/lib/view-as"),
    import("@/components/ViewAsBanner"),
  ]);
  return { viewAsLib, banner };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("ViewAsBanner", () => {
  it("renders nothing while view-as is inactive", async () => {
    const { banner } = await freshModules();
    render(<banner.ViewAsBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the impersonated identity while active and exits on the Exit button", async () => {
    const { viewAsLib, banner } = await freshModules();
    render(<banner.ViewAsBanner />);

    act(() => viewAsLib.setViewAs(VIEWED));
    expect(screen.getByRole("status")).toHaveTextContent("Viewing as");
    expect(screen.getByRole("status")).toHaveTextContent("viewed.eth");

    fireEvent.click(screen.getByRole("button", { name: "Exit View as" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(viewAsLib.viewAsSnapshot()).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
