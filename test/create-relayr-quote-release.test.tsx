import type { QuotedStageStart } from "@/app/create/helpers/staleQuote";
import type { RevnetFormData } from "@/app/create/types";
import type { RelayrPostBundleResponse } from "@/lib/nana/types";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Address, Hex } from "viem";
import { baseSepolia, sepolia } from "viem/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_ACCOUNT, validRevnetForm } from "./fixtures/revnet";
import { BUNDLE_UUID, HASH, NOW, OTHER_BUNDLE_UUID, payment, relayrApi } from "./relayr-fixtures";

// The Create page with the real Relayr hook, recovery guard and journal: only
// the wallet, the chain reads and Relayr's API are stubbed.
const mocks = vi.hoisted(() => ({
  config: { id: "create-relayr-config" },
  account: {
    address: "" as Address,
    chainId: 84532 as number,
    isConnected: true,
    connector: { id: "injected", name: "Injected" },
  },
  form: {} as RevnetFormData,
  formProps: {} as {
    relayrResponse?: RelayrPostBundleResponse;
    quotedStageStart?: QuotedStageStart;
    rebuildStaleQuote?: (stale: RelayrPostBundleResponse) => Promise<RelayrPostBundleResponse>;
  },
  setSubmitting: vi.fn(),
  toast: vi.fn(),
  switchChain: vi.fn(),
  signTypedData: vi.fn(),
  sendTransaction: vi.fn(),
  call: vi.fn(),
  readContract: vi.fn(),
}));

vi.mock("@/components/layout/Nav", () => ({ Nav: () => null }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: mocks.config }));
vi.mock("wagmi", () => ({
  useAccount: () => mocks.account,
  useConfig: () => mocks.config,
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChain }),
  useSignTypedData: () => ({ signTypedDataAsync: mocks.signTypedData }),
  useSendTransaction: () => ({
    data: undefined,
    error: null,
    isPending: false,
    isSuccess: false,
    sendTransactionAsync: mocks.sendTransaction,
  }),
}));
vi.mock("wagmi/actions", () => ({
  getAccount: () => mocks.account,
  getPublicClient: () => ({
    call: mocks.call,
    readContract: mocks.readContract,
    estimateGas: async () => 21_000n,
    estimateContractGas: async () => 1_000_000n,
  }),
  waitForTransactionReceipt: vi.fn(),
}));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  useWriteContract: () => ({ writeContractAsync: vi.fn() }),
  isSafeConnector: () => false,
  submittedViaSafe: () => false,
}));
vi.mock("@bananapus/nana-sdk-core/v6", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/v6")>()),
  getProjectCreationFee: async (_client: unknown, chainId: number) => BigInt(chainId),
}));
vi.mock("@/app/create/helpers/pinProjectMetaData", () => ({
  pinProjectMetadata: async () => "bafy-metadata",
}));
vi.mock("@/app/create/helpers/feedReachability", () => ({
  assertLaunchFeedsReachable: async () => undefined,
}));
vi.mock("@/app/create/form/DeployRevnetForm", () => ({
  DeployRevnetForm: (props: typeof mocks.formProps) => {
    mocks.formProps = props;
    return null;
  },
}));
vi.mock("@/lib/forms", () => ({
  FormProvider: ({
    children,
    onSubmit,
  }: {
    children: ReactNode;
    onSubmit: (
      values: RevnetFormData,
      helpers: { setSubmitting: (submitting: boolean) => void },
    ) => Promise<void>;
  }) => (
    <>
      <button onClick={() => void onSubmit(mocks.form, { setSubmitting: mocks.setSubmitting })}>
        Submit launch fixture
      </button>
      {children}
    </>
  ),
}));

const FIRST_DEADLINE = NOW + 3_600;
const firstPayment = payment({ chain: sepolia.id }, { deadline: FIRST_DEADLINE });

/** Relayr answers the first launch with BUNDLE_UUID and any later one with OTHER_BUNDLE_UUID. */
function relayrLaunches() {
  const first = relayrApi({ payments: [firstPayment] });
  const next = relayrApi({
    bundleUuid: OTHER_BUNDLE_UUID,
    payments: [
      payment({ chain: sepolia.id }, { bundleUuid: OTHER_BUNDLE_UUID, deadline: NOW + 7_200 }),
    ],
  });
  let posts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/bundle/prepaid")) return (posts++ ? next : first)(input, init);
      return (url.endsWith(OTHER_BUNDLE_UUID) ? next : first)(input, init);
    }),
  );
}

async function createPage() {
  vi.resetModules();
  const [{ default: Page }, review, activity, relayr, staleQuote] = await Promise.all([
    import("@/app/create/page"),
    import("@/lib/transaction-review"),
    import("@/lib/transaction-activity"),
    import("@/hooks/useReviewedRelayr"),
    import("@/app/create/helpers/staleQuote"),
  ]);
  review.registerTransactionReviewHandler(async () => true);
  render(<Page />);
  return { activity, relayr, staleQuote };
}

async function submitLaunch() {
  mocks.setSubmitting.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Submit launch fixture" }));
  await waitFor(() => expect(mocks.setSubmitting).toHaveBeenLastCalledWith(false));
}

beforeEach(() => {
  window.localStorage.clear();
  vi.setSystemTime(new Date(NOW * 1_000));
  mocks.account = {
    address: TEST_ACCOUNT,
    chainId: baseSepolia.id,
    isConnected: true,
    connector: { id: "injected", name: "Injected" },
  };
  mocks.form = { ...validRevnetForm(), chainIds: [sepolia.id, baseSepolia.id] };
  mocks.formProps = {};
  mocks.switchChain.mockImplementation(async ({ chainId }: { chainId: number }) => {
    mocks.account.chainId = chainId;
  });
  mocks.call.mockResolvedValue({ data: "0x" });
  mocks.readContract.mockImplementation(
    async ({ functionName, address }: { functionName: string; address: Address }) =>
      functionName === "isTrustedForwarder"
        ? true
        : functionName === "eip712Domain"
          ? ["0x0f", "Juicebox", "1", BigInt(mocks.account.chainId), address, HASH, []]
          : 4n,
  );
  mocks.signTypedData.mockResolvedValue(`0x${"12".repeat(65)}` as Hex);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  relayrLaunches();
});

describe("wallet-action:create-revnet — unpaid Relayr launch quotes", () => {
  it("rebuilds a stale-start quote through the real launch guard and never pays the stale one", async () => {
    const { activity, relayr, staleQuote } = await createPage();
    await submitLaunch();
    const stale = mocks.formProps.relayrResponse!;
    expect(stale.bundle_uuid).toBe(BUNDLE_UUID);

    // While the quote can be paid, a second launch is refused.
    await submitLaunch();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining(
          "A previous Relayr launch still requires reconciliation",
        ),
      }),
    );

    // The default start (quote time + 600 s) is now within 120 s, though the
    // quote itself is payable for another 50 minutes.
    vi.setSystemTime(new Date((NOW + 500) * 1_000));
    let fresh: Awaited<ReturnType<typeof staleQuote.ensureFreshQuote>> | undefined;
    await act(async () => {
      fresh = await staleQuote.ensureFreshQuote({
        bundle: stale,
        payment: stale.payment_info[0],
        quotedStageStart: mocks.formProps.quotedStageStart,
        rebuildStaleQuote: mocks.formProps.rebuildStaleQuote,
      });
    });
    expect(fresh?.bundle.bundle_uuid).toBe(OTHER_BUNDLE_UUID);
    expect(mocks.signTypedData).toHaveBeenCalledTimes(4);
    const rows = activity.transactionActivitySnapshot();
    expect(rows.find((row) => row.bundleUuid === BUNDLE_UUID)).toMatchObject({
      status: "failed",
      relayrPaymentStatus: "expired",
    });
    expect(rows.find((row) => row.bundleUuid === OTHER_BUNDLE_UUID)).toMatchObject({
      status: "pending",
      relayrPaymentStatus: "unfunded",
    });

    const payer = renderHook(() => relayr.useSendRelayrTx());
    await expect(payer.result.current.sendRelayrTx(stale.payment_info[0])).rejects.toThrow(
      /does not belong/,
    );
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("lets the next launch through once an unpaid launch quote expires", async () => {
    await createPage();
    await submitLaunch();
    expect(mocks.formProps.relayrResponse?.bundle_uuid).toBe(BUNDLE_UUID);

    vi.setSystemTime(new Date((FIRST_DEADLINE - 15) * 1_000));
    await submitLaunch();
    expect(mocks.toast).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mocks.formProps.relayrResponse?.bundle_uuid).toBe(OTHER_BUNDLE_UUID),
    );
    expect(mocks.signTypedData).toHaveBeenCalledTimes(4);
  });
});
