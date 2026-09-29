import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// A wallet announces its own icon, so the page cannot trust it. Only an inline image may be
// drawn: any other URL would tell its host that this page was opened.
const RABBY_ICON = "data:image/svg+xml;base64,PHN2Zy8+";
const HOSTILE: Record<string, string | undefined> = {
  Sneaky: "https://tracker.example/icon.png",
  Script: "data:text/html;base64,PHNjcmlwdD48L3NjcmlwdD4=",
  Js: "javascript:alert(1)",
  Plain: undefined,
};

const mocks = vi.hoisted(() => ({
  connectors: [] as { id: string; name: string; icon?: string }[],
}));

vi.mock("wagmi", () => ({
  useConnect: () => ({ connectAsync: vi.fn() }),
  useConnectors: () => mocks.connectors,
}));
vi.mock("@getpara/react-sdk-lite", () => ({
  useAuthenticateWithEmailOrPhone: () => ({
    authenticateWithEmailOrPhoneAsync: vi.fn(),
    error: null,
  }),
  useAuthenticateWithOAuth: () => ({ authenticateWithOAuthAsync: vi.fn(), error: null }),
  useVerifyNewAccount: () => ({
    verifyNewAccountAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
  useResendVerificationCode: () => ({ resendVerificationCodeAsync: vi.fn() }),
}));
vi.mock("@/providers/para-config", () => ({
  getParaClient: () => ({
    onStatePhaseChange: (listener: (snapshot: unknown) => void) => {
      listener({ authPhase: "idle", corePhase: "unauthenticated", authStateInfo: {} });
      return () => {};
    },
    waitForWalletCreation: vi.fn(),
  }),
  PARA_APP: { appName: "Revnet" },
  PARA_PORTAL_THEME: { backgroundColor: "#F6FEF9" },
}));
vi.mock("@/hooks/useMobileWallet", () => ({ useMobileWallet: () => null }));

const { default: ParaAuthSheet } = await import("@/providers/ParaAuthSheet");
const { SignInShell } = await import("@/providers/SignInShell");

const sheets = {
  SignInShell: () => <SignInShell entry="" onEntryChange={() => {}} />,
  ParaAuthSheet: () => <ParaAuthSheet entry="" onEntryChange={() => {}} onClose={() => {}} />,
};

describe.each(Object.keys(sheets) as (keyof typeof sheets)[])("the wallet tiles of %s", (name) => {
  it("draw an inline image icon, and nothing a wallet could point at a remote host", () => {
    mocks.connectors = [
      { id: "io.rabby", name: "Rabby", icon: RABBY_ICON },
      ...Object.entries(HOSTILE).map(([label, icon]) => ({
        id: label.toLowerCase(),
        name: label,
        icon,
      })),
    ];
    const { container } = render(sheets[name]());
    const tile = (label: string) => screen.getByRole("button", { name: label });

    expect(
      [...tile("Rabby").querySelectorAll("img")].map((img) => img.getAttribute("src")),
    ).toEqual([RABBY_ICON]);
    for (const label of Object.keys(HOSTILE)) {
      expect(tile(label).querySelectorAll("img"), label).toHaveLength(0);
      expect(tile(label).querySelectorAll("svg"), label).toHaveLength(1);
    }
    expect(container.innerHTML).not.toContain("tracker.example");
    expect(container.innerHTML).not.toContain("javascript:");
    expect(container.innerHTML).not.toContain("text/html");
  });
});
