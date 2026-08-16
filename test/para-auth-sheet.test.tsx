import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const para = vi.hoisted(() => ({
  verifyNewAccountAsync: vi.fn(),
  waitForWalletCreation: vi.fn(async () => ({ walletIds: {} })),
  authPhase: "awaiting_account_verification" as string,
  openedUrls: [] as string[],
}));

vi.mock("@getpara/react-sdk-lite", () => ({
  useAuthenticateWithEmailOrPhone: () => ({
    authenticateWithEmailOrPhoneAsync: vi.fn(),
    error: null,
  }),
  useAuthenticateWithOAuth: () => ({ authenticateWithOAuthAsync: vi.fn(), error: null }),
  useVerifyNewAccount: () => ({
    verifyNewAccountAsync: para.verifyNewAccountAsync,
    isPending: false,
    error: null,
  }),
  useResendVerificationCode: () => ({ resendVerificationCodeAsync: vi.fn() }),
}));

vi.mock("@/providers/para-config", () => ({
  getParaClient: () => ({
    onStatePhaseChange: (listener: (snapshot: unknown) => void) => {
      listener({
        authPhase: para.authPhase,
        corePhase: "unauthenticated",
        authStateInfo: {},
      });
      return () => {};
    },
    waitForWalletCreation: para.waitForWalletCreation,
  }),
  PARA_APP: { appName: "Revnet" },
}));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({ connectors: [], connectWith: vi.fn() }),
}));
vi.mock("@/hooks/useMobileWallet", () => ({ useMobileWallet: () => null }));
vi.mock("wagmi", () => ({
  useConnect: () => ({ connectAsync: vi.fn() }),
  useConnectors: () => [],
}));

const { default: ParaAuthSheet } = await import("@/providers/ParaAuthSheet");

describe("ParaAuthSheet verification", () => {
  it("opens the key-creation window the verify call answers with, then waits for it", async () => {
    // The URL comes back in this promise, NOT in the state stream the popup effect watches.
    // Nothing else advances a signup, so missing it leaves the sheet at "Verifying…" forever.
    para.verifyNewAccountAsync.mockResolvedValue({
      passkeyUrl: "https://app.getpara.com/v2/signup/passkey",
    });
    const open = vi.spyOn(window, "open").mockImplementation((url) => {
      para.openedUrls.push(String(url));
      return null;
    });

    render(<ParaAuthSheet entry="me@example.com" onEntryChange={() => {}} onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: "089262" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify/i }));

    await waitFor(() =>
      expect(para.openedUrls).toContain("https://app.getpara.com/v2/signup/passkey"),
    );
    await waitFor(() => expect(para.waitForWalletCreation).toHaveBeenCalled());
    open.mockRestore();
  });
});
