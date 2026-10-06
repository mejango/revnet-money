import type { ReviewedRelayrRequest } from "@/hooks/useReviewedRelayr";
import { verifyActionReceipt, verifyCallPreconditions } from "@/lib/multichain-guards";
import type { ChainPayment, JBChainId, RelayrPostBundleResponse } from "@/lib/nana/types";
import { verifyMetadataSource } from "@/lib/project-metadata-write";
import { relayrRecoveryScopeKey, relayrSavedQuote } from "@/lib/relayr-activity";
import { isSafeConnection } from "@/lib/safe-connector";
import { queuedSafeReviewCall } from "@/lib/safe-queue-review";
import {
  dismissTransactionActivity,
  recordTransactionActivity,
  refreshTransactionActivities,
  requireTransactionActivityPersistence,
  type RelayrExpectedTransaction,
  type TransactionActivity,
} from "@/lib/transaction-activity";
import { requireTransactionReview } from "@/lib/transaction-review";
import { requireNoViewAs } from "@/lib/view-as";
import { gasWithHeadroom } from "@bananapus/nana-sdk-core/review";
import {
  RELAYR_NATIVE_TOKEN,
  RELAYR_PAYMENT_GAS,
  relayrPaymentDetails,
  requireRelayrPaymentRuntime,
  sentRelayrPayment,
  simulateRelayrPayment,
  type RelayrQuote,
  type RelayrSentPayment,
} from "@bananapus/nana-sdk-core/review/relayr";
import {
  createSafeRelayrController,
  safeRelayrPreconditions,
  safeRelayrReservationKey,
  type SafeRelayrExecution,
  type SafeRelayrSession,
} from "@bananapus/nana-sdk-core/review/safe-relayr";
import { SAFE_EXEC_ABI } from "@bananapus/nana-sdk-core/safe-service";
import { decodeFunctionData, isHash, maxUint256, type Address, type Hex } from "viem";
import type { Config } from "wagmi";
import { getAccount, getPublicClient, waitForTransactionReceipt } from "wagmi/actions";

type ExecutionContext = {
  expected: RelayrExpectedTransaction;
  review?: ReviewedRelayrRequest["review"];
  recoveryScope?: string;
};
type SessionContext = { activity?: TransactionActivity };
const authorizing = new Set<string>();

/** Existing activity records remain the persistence format; the SDK owns their lifecycle. */
export function safeRelayrSession(activity: TransactionActivity): SafeRelayrSession | undefined {
  const expected = activity.relayrExpectedTransactions;
  const reservationKeys = (activity.relayrCallKeys ?? []).flatMap((key) => {
    const match = key.match(/:relayr-scope:safe-execution:(\d+:0x[0-9a-f]{40}:\d+)$/i);
    return match ? [match[1].toLowerCase()] : [];
  });
  const safeExpected = expected?.filter((row) => row.expectedSafeExecution) ?? [];
  if (activity.kind !== "relayr-bundle" || (!safeExpected.length && !reservationKeys.length))
    return undefined;
  if (!activity.account)
    throw new Error(
      "A saved Safe bundle is missing its account. Keep its recovery record and verify the existing bundle before continuing.",
    );
  const completeIdentity = !!expected?.length && safeExpected.length === expected.length;
  const executions = safeExpected.map((row): SafeRelayrExecution => ({
    entry: { chain: row.chainId, target: row.target, data: row.data, value: row.value },
    ...row.expectedSafeExecution!,
    context: { expected: row } satisfies ExecutionContext,
  }));
  const quote: RelayrQuote | undefined =
    completeIdentity && activity.bundleUuid
      ? {
          bundle_uuid: activity.bundleUuid,
          payment_info: activity.relayrQuote?.payment_info ?? [],
          transactions: safeExpected.map((row) => ({
            tx_uuid: row.transactionUuid,
            request: { chain: row.chainId, target: row.target, data: row.data, value: row.value },
          })),
          expectedTransactions: safeExpected.map((row) => ({
            txUuid: row.transactionUuid,
            chain: row.chainId,
            entry: { chain: row.chainId, target: row.target, data: row.data, value: row.value },
          })),
        }
      : undefined;
  return {
    id: activity.relayrSafeSessionId ?? activity.id,
    account: activity.account,
    executions,
    reservationKeys: [
      ...new Set([...reservationKeys, ...executions.map(safeRelayrReservationKey)]),
    ],
    quote,
    bundleUuid: activity.bundleUuid,
    paymentStatus:
      activity.relayrSafeFundingUnknown ||
      (!activity.relayrSafeSessionId && activity.relayrPaymentStatus === "submitted")
        ? "sending"
        : (activity.relayrPaymentStatus ?? "sending"),
    payments: relayrSavedQuote(activity).payments,
    state:
      activity.relayrPaymentStatus === "expired" ||
      activity.relayrDiscardable === "expired" ||
      activity.relayrDiscardable === "changed"
        ? "released"
        : activity.status === "success" && !activity.manualVerificationRequired
          ? "complete"
          : activity.bundleUuid
            ? "active"
            : "publishing",
    createdAt: activity.createdAt,
    context: { activity } satisfies SessionContext,
  };
}

export function safeRelayrActivity(session: SafeRelayrSession): TransactionActivity | undefined {
  return refreshTransactionActivities().find(
    (activity) => (activity.relayrSafeSessionId ?? activity.id) === session.id,
  );
}

export function safeRelayrQuote(session: SafeRelayrSession): RelayrPostBundleResponse {
  if (!session.quote) throw new Error("The saved Safe quote is unavailable.");
  return {
    bundle_uuid: session.quote.bundle_uuid,
    payment_info: session.quote.payment_info.map((payment) => ({
      ...payment,
      token: payment.token ?? RELAYR_NATIVE_TOKEN,
    })) as ChainPayment[],
  };
}

export function safeRelayrExecution(request: ReviewedRelayrRequest): SafeRelayrExecution {
  if (!request.expectedSafeExecution) throw new Error("The reviewed Safe identity is missing.");
  const execution: SafeRelayrExecution = {
    entry: {
      chain: request.chainId,
      target: request.data.to,
      data: request.data.data,
      value: request.data.value.toString(),
    },
    ...request.expectedSafeExecution,
  };
  execution.context = {
    review: request.review,
    recoveryScope: request.recoveryScope,
    expected: {
      chainId: request.chainId,
      target: request.data.to,
      data: request.data.data,
      value: request.data.value.toString(),
      gas: gasWithHeadroom(request.data.gas + 100_000n).toString(),
      transactionUuid: "",
      expectedSafeExecution: request.expectedSafeExecution,
      metadataSource: request.metadataSource,
      expectedDeployment: request.expectedDeployment,
      rejectEvents: request.rejectEvents,
      reservedReceipt: request.reservedReceipt,
      expectedPayout: request.expectedPayout,
      expectedRouterPending: request.expectedRouterPending,
      preconditions: [...(request.preconditions ?? []), ...safeRelayrPreconditions(execution)],
    },
  } satisfies ExecutionContext;
  return execution;
}

type Wallet = {
  switchChain(chainId: JBChainId): Promise<unknown>;
  sendTransaction(request: {
    account: Address;
    chainId: JBChainId;
    to: Address;
    value: bigint;
    data: Hex;
    gas: bigint;
  }): Promise<Hex>;
};

/** Translate storage, review and wallet effects. All Safe session decisions live in the SDK. */
export function safeRelayrController(config: Config, wallet?: Wallet) {
  const clientFor = (chainId: number) => getPublicClient(config, { chainId: chainId as JBChainId });
  const requireAccount = (account: Address, chainId?: number) => {
    requireNoViewAs();
    const current = getAccount(config);
    if (
      current.address?.toLowerCase() !== account.toLowerCase() ||
      (chainId !== undefined && current.chainId !== chainId) ||
      isSafeConnection(config)
    )
      throw new Error("Connected account or chain changed. Review the Relayr payment again.");
  };
  return createSafeRelayrController({
    clientFor,
    currentAccount: () => getAccount(config).address,
    store: {
      async list() {
        requireTransactionActivityPersistence();
        return refreshTransactionActivities().flatMap((activity) => {
          const session = safeRelayrSession(activity);
          return session ? [session] : [];
        });
      },
      async save(session) {
        requireTransactionActivityPersistence();
        const previous =
          safeRelayrActivity(session) ?? (session.context as SessionContext | undefined)?.activity;
        const id = session.bundleUuid ? `relayr:${session.bundleUuid}` : session.id;
        const expected = session.executions.map((execution, index): RelayrExpectedTransaction => ({
          ...(execution.context as ExecutionContext).expected,
          chainId: execution.entry.chain,
          target: execution.entry.target,
          data: execution.entry.data,
          value: execution.entry.value,
          transactionUuid: session.quote?.expectedTransactions[index]?.txUuid ?? "",
          expectedSafeExecution: {
            safe: execution.safe,
            safeTxHash: execution.safeTxHash,
            nonce: execution.nonce,
          },
        }));
        const latest = session.payments.at(-1);
        recordTransactionActivity({
          ...previous,
          id,
          relayrSafeSessionId: session.id,
          relayrSafeFundingUnknown: session.paymentStatus === "sending",
          kind: "relayr-bundle",
          title: "Safe execution bundle",
          account: session.account,
          status:
            session.state === "complete"
              ? "success"
              : session.state === "released"
                ? "failed"
                : session.paymentStatus === "sending" || session.paymentStatus === "submitted"
                  ? "submitted"
                  : "pending",
          message:
            session.state === "complete"
              ? "All saved destination transactions confirmed. Refresh the Safe queue."
              : session.state === "released"
                ? "This unpaid Relayr quote expired. Review the action again for a new quote."
                : session.paymentStatus === "sending" || session.paymentStatus === "submitted"
                  ? "Relayr funding is being submitted. Do not pay again while the wallet result is uncertain."
                  : session.paymentStatus === "confirmed"
                    ? "Relayr payment confirmed. Destination transactions are pending."
                    : "The saved Safe quote remains reserved. Review its original complete selection or check the existing bundle.",
          createdAt: session.createdAt,
          bundleUuid: session.bundleUuid,
          relayrExpectedTransactions: expected,
          relayrCallKeys: [
            ...new Set([
              ...(previous?.relayrCallKeys ?? []),
              ...session.executions.flatMap((execution) => {
                const scope = (execution.context as ExecutionContext).recoveryScope;
                return [
                  relayrRecoveryScopeKey(
                    session.account,
                    `safe-execution:${safeRelayrReservationKey(execution)}`,
                  ),
                  ...(scope ? [relayrRecoveryScopeKey(session.account, scope)] : []),
                ];
              }),
            ]),
          ],
          chainStates: session.records?.map((record) => ({
            chainId: Number(record.request?.chain ?? record.chain),
            status: record.status?.state ?? "Pending",
            hash: record.status?.data?.hash ?? record.status?.data?.transaction?.hash,
          })),
          relayrQuote: session.quote ? safeRelayrQuote(session) : undefined,
          relayrPaymentStatus:
            session.paymentStatus === "sending" ? "submitted" : session.paymentStatus,
          relayrPayments: session.payments.map((payment) => ({
            hash: payment.hash,
            chainId: payment.chainId,
            target: payment.target,
            data: payment.calldata,
            value: payment.amount,
          })),
          ...(latest
            ? {
                hash: latest.hash,
                chainId: latest.chainId,
                relayrPayment: {
                  target: latest.target,
                  data: latest.calldata,
                  value: latest.amount,
                },
              }
            : {}),
          manualVerificationRequired:
            session.state === "complete" ? false : previous?.manualVerificationRequired,
        });
        requireTransactionActivityPersistence();
        if (previous && previous.id !== id) dismissTransactionActivity(previous.id);
      },
      async withLock(account, run) {
        const key = "safe-relayr";
        if (authorizing.has(key))
          throw new Error("Another Safe Relayr action is already in progress.");
        authorizing.add(key);
        try {
          return await (typeof navigator !== "undefined" && navigator.locks
            ? navigator.locks.request(
                `revnet:safe-relayr-lifecycle`,
                { ifAvailable: true },
                (lock) => {
                  if (!lock)
                    throw new Error(
                      "Another browser tab is preparing Relayr authorizations for this account.",
                    );
                  return navigator.locks.request(
                    `revnet:relayr-authorizations:${account.toLowerCase()}`,
                    { ifAvailable: true },
                    (accountLock) => {
                      if (!accountLock)
                        throw new Error(
                          "Another Relayr authorization is being prepared for this account.",
                        );
                      return run();
                    },
                  );
                },
              )
            : run());
        } finally {
          authorizing.delete(key);
        }
      },
    },
    async revalidate(execution, account) {
      requireAccount(account);
      const client = clientFor(execution.entry.chain);
      const expected = (execution.context as ExecutionContext).expected;
      if (!client || !expected.gas)
        throw new Error(
          "The signed destination call cannot be revalidated. Do not pay this quote.",
        );
      if (expected.metadataSource)
        await verifyMetadataSource(client, expected.metadataSource, account);
      await verifyCallPreconditions(client, [
        ...(expected.preconditions ?? []),
        ...safeRelayrPreconditions(execution),
      ]);
      await client.call({
        account,
        to: execution.entry.target,
        data: execution.entry.data,
        value: BigInt(execution.entry.value),
        gas: BigInt(expected.gas),
        stateOverride: [{ address: account, balance: maxUint256 }],
      });
    },
    async afterVerified(execution, verified) {
      const client = clientFor(execution.entry.chain);
      if (!client) throw new Error("The destination RPC is unavailable.");
      const expected = (execution.context as ExecutionContext).expected;
      await verifyActionReceipt(
        client,
        verified.receipt,
        expected.target,
        expected.expectedDeployment,
        expected.rejectEvents,
        expected.reservedReceipt,
        expected.expectedPayout,
        expected.expectedRouterPending,
      );
    },
    async review(executions, { resumed }) {
      const account = getAccount(config).address;
      if (!account) throw new Error("Connect a wallet first.");
      requireAccount(account);
      await requireTransactionReview({
        kind: "transaction",
        title: resumed
          ? "Resume saved Safe execution quote"
          : `Review ${executions.length} Safe executions`,
        description: resumed
          ? "These are the original signed calls in the existing unpaid Relayr quote. Additional Safe confirmations do not change the saved execution. No new bundle will be created."
          : "Relayr submits each fully signed Safe transaction below from its own account; the Safe signatures authorize it. A separate payment funds the bundle.",
        confirmLabel: resumed ? "Use saved quote" : "Agree & request Relayr quote",
        calls: executions.map((execution) => {
          const decoded = decodeFunctionData({ abi: SAFE_EXEC_ABI, data: execution.entry.data });
          if (decoded.functionName !== "execTransaction")
            throw new Error("The saved Safe call is not execTransaction.");
          const args = decoded.args;
          return {
            chainId: execution.entry.chain,
            from: account,
            to: execution.entry.target,
            value: BigInt(execution.entry.value),
            data: execution.entry.data,
            abi: SAFE_EXEC_ABI,
            functionName: "execTransaction",
            args,
            contractName: "Safe",
            calls: [
              queuedSafeReviewCall(execution.entry.chain, {
                to: args[0],
                value: args[1],
                data: args[2],
                operation: args[3],
              }),
            ],
          };
        }),
      });
    },
    async sendPayment({ session, payment, beforeSend, onSending, onSent }) {
      if (!wallet) throw new Error("A wallet payment must be explicitly requested.");
      const chainId = payment.chain as JBChainId;
      const details = relayrPaymentDetails(payment, {
        bundleUuid: session.bundleUuid!,
        destinationChainIds: session.executions.map((execution) => execution.entry.chain),
      });
      await wallet.switchChain(chainId);
      requireAccount(session.account, chainId);
      await requireTransactionReview({
        kind: "transaction",
        title: "Review Relayr payment",
        description:
          "This one payment funds the signed calls on every selected chain. Destination transactions confirm separately.",
        confirmLabel: "Agree & pay Relayr",
        calls: [
          {
            chainId,
            from: session.account,
            to: details.target,
            value: details.amount,
            gas: RELAYR_PAYMENT_GAS,
            data: details.calldata,
            label: "Pay Relayr bundle fee",
          },
        ],
      });
      requireAccount(session.account, chainId);
      const client = clientFor(chainId);
      if (!client) throw new Error("Relayr payment network is unavailable.");
      await requireRelayrPaymentRuntime(client);
      await simulateRelayrPayment(client, { from: session.account, payment: details });
      await beforeSend();
      requireAccount(session.account, chainId);
      relayrPaymentDetails(payment, {
        bundleUuid: session.bundleUuid!,
        destinationChainIds: session.executions.map((execution) => execution.entry.chain),
      });
      await onSending();
      requireAccount(session.account, chainId);
      const hash = await wallet.sendTransaction({
        account: session.account,
        chainId,
        to: details.target,
        value: details.amount,
        data: details.calldata,
        gas: RELAYR_PAYMENT_GAS,
      });
      const sentAs = (hash: Hex): RelayrSentPayment[] => [
        ...session.payments,
        sentRelayrPayment(details, hash),
      ];
      let payments = sentAs(hash);
      await onSent(payments);
      const receipt = await waitForTransactionReceipt(config, { chainId, hash });
      if (!isHash(receipt.transactionHash))
        throw new Error("The payment receipt names no transaction hash.");
      if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) {
        payments = [...payments, sentRelayrPayment(details, receipt.transactionHash)];
        await onSent(payments);
      }
      return { hash: receipt.transactionHash, payments };
    },
  });
}
