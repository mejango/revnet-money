"use client";

import { requireOnchainExecution, useWriteContract } from "@/hooks/useReviewedWriteContract";
import { confirmHeldWriteExit } from "@/lib/flow-choice";
import * as markee from "@/lib/markee";
import { markeeSettlementIsSaved, recoverMarkeeSubmission } from "@/lib/markee-recovery";
import {
  contractTransactionKey,
  recordTransactionActivity,
  refreshTransactionActivities,
  releaseTransactionActivityVerification,
  requireTransactionActivityPersistence,
  settleTransactionActivityFailure,
  transactionActivityForHash,
  updateTransactionActivity,
} from "@/lib/transaction-activity";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import { adoptIntoHold, holdsHash, safeHoldOf, writeHolds } from "@/lib/write-hold";
import {
  browserLocks,
  WRITE_HOLD_HASHED_EXIT_LINE,
  writeHeldMessage,
} from "@bananapus/nana-sdk-core/review";
import { safeExecutionResult, safeExecutionRunsCalls } from "@bananapus/nana-sdk-core/safe-service";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  encodeFunctionData,
  isAddress,
  isHash,
  isHex,
  parseEther,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { useAccount, usePublicClient } from "wagmi";

type Kind = "board" | "message" | "approval" | "start" | "update" | "stop" | "withdraw";
type Pending = {
  kind: Kind;
  id: string;
  target: Address;
  data: Hex;
  value: string;
  hash?: Hex;
  rate?: string;
  allowance?: string;
};
type Recovery = {
  account: Address;
  board?: Address;
  message?: string;
  messageAddress?: Address;
  monthlyInput?: string;
  pending?: Pending;
};
const RECOVERY_KEY = "revnet:markee-rent:recovery:v1";
/** A supplied hash the hold can't tell apart from an earlier identical call. */
const RECOVERED_UNMATCHED =
  "That transaction can't be confirmed as this submission, so it wasn't saved. Check your wallet.";
/** A saved submission the user released after checking their wallet. */
const RELEASED = "Released after you checked your wallet.";
/** A saved submission that went through, whose Markee result still can't be verified. */
const SETTLED_UNVERIFIED =
  "This transaction went through, but its Markee result couldn't be verified. Check the board before sending again.";
const BOARD_KEY = "revnet:markee-rent:board:v1";
function configurationKey(value: unknown) {
  return JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item));
}
function loadRecovery(): Recovery | undefined {
  const raw = window.localStorage.getItem(RECOVERY_KEY);
  if (!raw) return;
  if (raw.length > 32768) throw new Error("Markee recovery storage is too large.");
  const value = JSON.parse(raw) as Recovery;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.account !== "string" ||
    !isAddress(value.account) ||
    (value.message !== undefined &&
      (typeof value.message !== "string" || value.message.length > 8192)) ||
    (value.monthlyInput !== undefined &&
      (typeof value.monthlyInput !== "string" ||
        !/^\d+(?:\.\d{1,18})?$/.test(value.monthlyInput))) ||
    (value.board && !isAddress(value.board)) ||
    (value.messageAddress && !isAddress(value.messageAddress)) ||
    (value.pending &&
      (typeof value.pending.id !== "string" ||
        value.pending.id.length > 16384 ||
        (value.pending.rate !== undefined && !/^\d{1,30}$/.test(value.pending.rate)) ||
        (value.pending.allowance !== undefined && !/^\d{1,78}$/.test(value.pending.allowance)) ||
        !value.pending.id ||
        !isAddress(value.pending.target) ||
        !isHex(value.pending.data) ||
        !/^\d+$/.test(value.pending.value) ||
        (value.pending.hash && !isHash(value.pending.hash)) ||
        !["board", "message", "approval", "start", "update", "stop", "withdraw"].includes(
          value.pending.kind,
        )))
  )
    throw new Error("Markee recovery storage is invalid. Do not submit again until it is checked.");
  return value;
}
function saveRecovery(value: Recovery) {
  requireTransactionActivityPersistence();
  window.localStorage.setItem(RECOVERY_KEY, JSON.stringify(value));
}

/** Reviewed wallet writes and durable, receipt-qualified recovery for the homepage Rent board. */
export function useMarkee(initialBoardAddress?: Address) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: markee.MARKEE_CHAIN_ID });
  const ensClient = usePublicClient({ chainId: 1 });
  const [boardAddress, setBoardAddress] = useState<Address | undefined>(initialBoardAddress);
  const [board, setBoard] = useState<markee.BoardState>();
  const [wallet, setWallet] = useState<markee.WalletState>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const active = useRef<
    { recovery: Recovery; pending: Pending; guard: () => Promise<void> } | undefined
  >(undefined);
  const running = useRef(false);
  const readGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++readGeneration.current;
    setBoard(undefined);
    setWallet(undefined);
    if (!client) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let selected: Address | undefined = initialBoardAddress ?? boardAddress;
    try {
      const saved = loadRecovery();
      setPending(!!saved?.pending);
      const localBoard = window.localStorage.getItem(BOARD_KEY);
      selected =
        initialBoardAddress ??
        boardAddress ??
        (localBoard && isAddress(localBoard) ? localBoard : undefined);
      if (localBoard && !isAddress(localBoard))
        throw new Error("The saved Markee board address is invalid.");
      if (!selected) {
        setBoard(undefined);
        setWallet(undefined);
        return;
      }
      const next = await markee.readMarkeeBoard(client, selected);
      const nextWallet = address ? await markee.readMarkeeWallet(client, next, address) : undefined;
      if (readGeneration.current !== generation) return;
      setBoardAddress(selected);
      setBoard(next);
      setWallet(nextWallet);
      setError(undefined);
    } catch (cause) {
      if (readGeneration.current === generation) {
        setBoard(undefined);
        setWallet(undefined);
        setError(cause instanceof Error ? cause.message : String(cause));
        // Exit rights survive mutable advertising/payment policy changes.
        if (selected && address) {
          try {
            const source = await markee.readMarkeeExitBoard(client, selected);
            const exitWallet = await markee.readMarkeeWallet(client, source, address);
            if (readGeneration.current === generation) setWallet(exitWallet);
          } catch {
            /* Unsupported source identity remains unavailable. */
          }
        }
      }
    } finally {
      if (readGeneration.current === generation) setLoading(false);
    }
  }, [address, client, boardAddress, initialBoardAddress]);
  useEffect(() => {
    const generationRef = readGeneration;
    void refresh();
    return () => {
      generationRef.current++;
    };
  }, [refresh]);

  const { writeContractAsync } = useWriteContract({
    // The SDK's write hold holds each exact call, as for any wallet write; Markee's journal adds
    // the exact result it verifies.
    manualReceiptVerification: () => true,
    allowSafeManualReceiptVerification: true,
    reverify: async () => {
      if (!active.current) throw new Error("Markee action is unavailable.");
      await active.current.guard();
    },
    beforeSubmission: async () => {
      const current = active.current;
      if (!current) throw new Error("Markee action is unavailable.");
      if (loadRecovery()?.pending)
        throw new Error("Another Markee submission is already held. Check it before proceeding.");
      current.recovery.pending = current.pending;
      saveRecovery(current.recovery);
      recordTransactionActivity({
        id: current.pending.id,
        hash: undefined,
        executionHash: undefined,
        createdAt: Date.now(),
        kind: "direct",
        account: current.recovery.account,
        chainId: markee.MARKEE_CHAIN_ID,
        title: "Markee Rent",
        status: "pending",
        manualVerificationRequired: true,
        message: "Wallet submission may be in progress. Check its result before sending again.",
      });
      requireTransactionActivityPersistence();
      setPending(true);
    },
    onSubmissionRejected: async () => {
      const current = active.current;
      if (!current) return;
      const saved = loadRecovery();
      if (saved?.pending?.id !== current.pending.id || saved.pending.hash) return;
      delete saved.pending;
      saveRecovery(saved);
      updateTransactionActivity(current.pending.id, {
        status: "failed",
        manualVerificationRequired: false,
        message: "The wallet definitively refused before broadcasting.",
      });
      setPending(false);
    },
    onBeforeSubmissionAborted: async () => {
      const current = active.current;
      if (!current) return;
      if (loadRecovery()?.pending?.id !== current.pending.id) return;
      delete current.recovery.pending;
      saveRecovery(current.recovery);
      updateTransactionActivity(current.pending.id, {
        status: "failed",
        manualVerificationRequired: false,
        message: "The final wallet gate refused before submission.",
      });
      setPending(false);
    },
  });

  const verifyPending = async (recovery: Recovery) => {
    if (!client || !recovery.pending) throw new Error("No saved transaction to verify.");
    const step = recovery.pending;
    // A missing wallet reply is not proof that no transaction was broadcast.
    if (!step.hash)
      throw new Error(
        "The wallet submission result is unknown. Check wallet and account activity; do not submit again.",
      );
    const activity = transactionActivityForHash(step.hash);
    if (activity?.kind === "safe" && !activity.executionHash) {
      requireOnchainExecution(step.hash);
      throw new Error("The Safe proposal has no verified execution receipt yet.");
    }
    const receipt = await waitForReceiptWithRetry(client, activity?.executionHash ?? step.hash);
    const transaction = await client.getTransaction({ hash: receipt.transactionHash });
    if (transaction.hash.toLowerCase() !== receipt.transactionHash.toLowerCase())
      throw new Error("The transaction hash does not match the verified receipt.");
    if (activity?.kind === "safe") {
      if (
        !activity.safeProposal ||
        activity.safeProposal.calls.length !== 1 ||
        activity.safeProposal.calls[0].to.toLowerCase() !== step.target.toLowerCase() ||
        activity.safeProposal.calls[0].data.toLowerCase() !== step.data.toLowerCase() ||
        BigInt(activity.safeProposal.calls[0].value) !== BigInt(step.value) ||
        !safeExecutionRunsCalls(
          transaction,
          recovery.account,
          activity.safeProposal.calls,
          activity.safeProposal.batch,
        ) ||
        safeExecutionResult(receipt, recovery.account, step.hash).status !== "success"
      )
        throw new Error("The exact reviewed Safe execution could not be verified.");
    } else if (
      transaction.from.toLowerCase() !== recovery.account.toLowerCase() ||
      transaction.to?.toLowerCase() !== step.target.toLowerCase() ||
      transaction.input.toLowerCase() !== step.data.toLowerCase() ||
      transaction.value !== BigInt(step.value)
    )
      throw new Error("The transaction does not match the reviewed Markee call.");
    if (
      receipt.transactionHash.toLowerCase() !== (activity?.executionHash ?? step.hash).toLowerCase()
    )
      throw new Error("The receipt does not match the submitted transaction.");
    if (receipt.status !== "success") {
      updateTransactionActivity(step.id, {
        status: "failed",
        manualVerificationRequired: false,
        message: "Markee transaction reverted.",
      });
      if (activity)
        updateTransactionActivity(activity.id, {
          status: "failed",
          manualVerificationRequired: false,
          message: "Markee transaction reverted.",
        });
      delete recovery.pending;
      saveRecovery(recovery);
      setPending(false);
      throw new Error("The Markee transaction reverted. It can be reviewed again.");
    }
    if (step.kind === "board") {
      const created = markee.decodeBoardCreated(receipt.logs);
      await markee.readMarkeeBoard(client, created.board);
      recovery.board = created.board;
    } else {
      if (!recovery.board) throw new Error("Saved board is missing.");
      const verifiedBoard = await markee.readMarkeeExitBoard(client, recovery.board);
      if (step.kind === "message") {
        recovery.messageAddress = markee.decodeMarkeeCreated(
          receipt.logs,
          recovery.board,
          recovery.account,
          recovery.message ?? "",
          "",
        );
      } else {
        const state = await markee.readMarkeeWallet(client, verifiedBoard, recovery.account);
        if (step.kind === "approval" && state.allowance < BigInt(step.allowance ?? "0"))
          throw new Error("ETHx approval could not be verified.");
        if (
          (step.kind === "start" || step.kind === "update") &&
          (state.flowRate !== BigInt(step.rate ?? "0") ||
            state.backerMarkee.toLowerCase() !== recovery.messageAddress?.toLowerCase())
        )
          throw new Error("The exact Markee stream could not be verified.");
        if (step.kind === "stop" && state.flowRate !== 0n)
          throw new Error("Stream cancellation could not be verified.");
        if (step.kind === "withdraw" && state.deposit !== 0n)
          throw new Error("Deposit withdrawal could not be verified.");
      }
    }
    const stillSaved = loadRecovery();
    const stillPending = stillSaved?.pending;
    if (
      !stillPending ||
      configurationKey(stillPending) !== configurationKey(step) ||
      stillSaved?.account.toLowerCase() !== recovery.account.toLowerCase()
    )
      throw new Error("The saved Markee submission changed during verification.");
    if (step.kind === "board" && recovery.board) {
      window.localStorage.setItem(BOARD_KEY, recovery.board);
      setBoardAddress(recovery.board);
    }
    // Persist the creation result before releasing the submission lock or taking a later step.
    delete recovery.pending;
    saveRecovery(recovery);
    releaseTransactionActivityVerification(step.hash, "Markee onchain result verified.");
    updateTransactionActivity(step.id, {
      status: "success",
      manualVerificationRequired: false,
      message: "Markee onchain result verified.",
    });
    setPending(false);
  };

  type Call = {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
  };
  const send = async (
    recovery: Recovery,
    kind: Kind,
    call: Call,
    guard: () => Promise<void>,
    expected: Partial<Pending> = {},
  ) => {
    if (loadRecovery()?.pending)
      throw new Error("Verify the saved Markee transaction before taking another action.");
    const data = encodeFunctionData({
      abi: call.abi,
      functionName: call.functionName,
      args: call.args,
    });
    const key = contractTransactionKey(recovery.account, markee.MARKEE_CHAIN_ID, { ...call, data });
    const step: Pending = {
      kind,
      id: `markee:${key}`,
      target: call.address,
      data,
      value: String(call.value ?? 0n),
      ...expected,
    };
    active.current = { recovery, pending: step, guard };
    setStatus(`Review ${kind === "start" ? "Take over" : kind}`);
    const hash = await writeContractAsync({
      ...call,
      chainId: markee.MARKEE_CHAIN_ID,
      account: recovery.account,
    } as Parameters<typeof writeContractAsync>[0]);
    step.hash = hash;
    recovery.pending = step;
    saveRecovery(recovery);
    updateTransactionActivity(step.id, {
      message: "Submitted. Verifying the exact Markee result.",
    });
    setStatus("Verifying onchain result");
    await verifyPending(recovery);
  };
  const act = async (run: () => Promise<string | void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await browserLocks().request(RECOVERY_KEY, { ifAvailable: true }, async (lock) => {
        if (!lock)
          throw new Error(
            "Another tab is handling a Markee action. Finish or check that action first.",
          );
        setStatus((await run()) ?? "Verified");
        await refresh();
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("Action needs attention");
    } finally {
      running.current = false;
      active.current = undefined;
      setBusy(false);
    }
  };
  const context = () => {
    if (!client || !address) throw new Error("Connect a wallet to continue.");
    const saved = loadRecovery();
    if (saved?.pending)
      throw new Error(
        "A saved Markee transaction needs verification. Use Check transaction first.",
      );
    return { client, account: address };
  };
  const guardBoard = async (selected: Address) => {
    if (!client) throw new Error("Base RPC unavailable.");
    await markee.readMarkeeExitBoard(client, selected);
  };

  const createBoard = () =>
    act(async () => {
      const { client, account } = context();
      if (account.toLowerCase() !== markee.MARKEE_ADMIN.toLowerCase())
        throw new Error("Connect the selected Markee admin to create the board.");
      if (boardAddress || window.localStorage.getItem(BOARD_KEY))
        throw new Error(
          "The Markee board is already configured. Refresh to use the existing board.",
        );
      const verifyBeneficiary = async () => {
        if (!ensClient) throw new Error("Ethereum ENS verification is unavailable.");
        const resolved = await ensClient.getEnsAddress({ name: "team.rev.eth" });
        if (resolved?.toLowerCase() !== markee.MARKEE_BENEFICIARY.toLowerCase())
          throw new Error(
            "team.rev.eth no longer resolves to the reviewed beneficiary. Review setup again.",
          );
        const code = await client.getCode({ address: markee.MARKEE_BENEFICIARY });
        if (!code || code === "0x")
          throw new Error("The team beneficiary contract is unavailable on Base.");
      };
      await verifyBeneficiary();
      const factory = await markee.readMarkeeFactory(client);
      await send(
        { account },
        "board",
        {
          address: markee.MARKEE_FACTORY,
          abi: markee.factoryAbi,
          functionName: "createLeaderboard",
          args: [markee.MARKEE_BENEFICIARY, "revnet.money", "website", "revnet.money"],
        },
        async () => {
          await verifyBeneficiary();
          const current = await markee.readMarkeeFactory(client);
          if (configurationKey(current) !== configurationKey(factory))
            throw new Error("Markee factory settings changed. Review again.");
        },
      );
    });
  const takeover = (message: string, monthlyInput: string) =>
    act(async () => {
      const { client, account } = context();
      if (!boardAddress) throw new Error("Create the Markee board first.");
      const selected = boardAddress;
      const currentBoard = await markee.readMarkeeBoard(client, selected);
      if (!message.trim()) throw new Error("Enter an advertisement message.");
      markee.validateMarkeeText(message, currentBoard.maxMessageLength);
      const rate = markee.parseMonthlyRate(monthlyInput, currentBoard.minimumMonthlyRate);
      if (rate <= currentBoard.effectiveTopRate)
        throw new Error("Enter a rate higher than the current leading advertisement.");
      let state = await markee.readMarkeeWallet(
        client,
        await markee.readMarkeeBoard(client, selected),
        account,
      );
      if (state.flowRate !== 0n)
        throw new Error("Stop your current backing before taking over a new message.");
      if (state.deposit !== 0n)
        throw new Error("Withdraw your previous buffer before starting new backing.");
      const saved = loadRecovery();
      const recovery: Recovery =
        saved?.account.toLowerCase() === account.toLowerCase() &&
        saved.board?.toLowerCase() === selected.toLowerCase() &&
        saved.message === message
          ? { ...saved, monthlyInput }
          : { account, board: selected, message, monthlyInput };
      const guard = async () => {
        const fresh = await markee.readMarkeeBoard(client, selected);
        markee.validateMarkeeText(message, fresh.maxMessageLength);
        markee.parseMonthlyRate(monthlyInput, fresh.minimumMonthlyRate);
        if (rate <= fresh.effectiveTopRate)
          throw new Error("The leading advertisement rate changed. Review Take over again.");
        if (
          fresh.beneficiaryBps !== currentBoard.beneficiaryBps ||
          configurationKey(fresh.factoryConfig) !== configurationKey(currentBoard.factoryConfig)
        )
          throw new Error("Markee revenue split changed. Review again.");
        if (recovery.messageAddress) {
          const storedMessage = await markee.readMarkeeMessage(
            client,
            fresh,
            recovery.messageAddress,
          );
          if (
            storedMessage.owner.toLowerCase() !== account.toLowerCase() ||
            storedMessage.message !== message ||
            storedMessage.name !== ""
          )
            throw new Error(
              "The saved advertisement ownership or text changed. Review a new advertisement.",
            );
        }
      };
      if (!recovery.messageAddress)
        await send(
          recovery,
          "message",
          {
            address: selected,
            abi: markee.boardAbi,
            functionName: "createMarkee",
            args: [message, ""],
          },
          guard,
        );
      state = await markee.readMarkeeWallet(
        client,
        await markee.readMarkeeBoard(client, selected),
        account,
      );
      const pool = await client.readContract({
        address: selected,
        abi: markee.boardAbi,
        functionName: "poolOf",
        args: [recovery.messageAddress!],
      });
      if (pool === zeroAddress)
        throw new Error(
          "The message refund pool is not ready. Your message is saved; retry after the pool is initialized.",
        );
      const funding = markee.getRequiredWrap(
        state.ethxBalance,
        rate,
        state.deposit,
        parseEther(monthlyInput),
      );
      if (state.ethBalance < funding.wrapValue)
        throw new Error(
          "Not enough ETH for the stream buffer. Add ETH and retry; your message is saved.",
        );
      if (state.allowance < funding.buffer)
        await send(
          recovery,
          "approval",
          {
            address: markee.STREAMING_BASE.ethx,
            abi: markee.ethxAbi,
            functionName: "approve",
            args: [selected, funding.buffer],
          },
          guard,
          { allowance: funding.buffer.toString() },
        );
      const latest = await markee.readMarkeeWallet(
        client,
        await markee.readMarkeeBoard(client, selected),
        account,
      );
      const required = markee.getRequiredWrap(
        latest.ethxBalance,
        rate,
        latest.deposit,
        parseEther(monthlyInput),
      );
      const operations = markee.buildOpenStreamOps({
        ethx: markee.STREAMING_BASE.ethx,
        board: selected,
        markee: recovery.messageAddress!,
        backer: account,
        ratePerSec: rate,
        buffer: required.buffer,
        cfaAgreement: latest.cfaAgreement,
        gdaAgreement: latest.gdaAgreement,
        pool,
        wrapValue: required.wrapValue,
      });
      await send(
        recovery,
        "start",
        {
          address: markee.STREAMING_BASE.host,
          abi: markee.hostAbi,
          functionName: "batchCall",
          args: [operations],
          value: required.wrapValue,
        },
        async () => {
          await guard();
          const currentPool = await client.readContract({
            address: selected,
            abi: markee.boardAbi,
            functionName: "poolOf",
            args: [recovery.messageAddress!],
          });
          if (currentPool !== pool) throw new Error("The refund pool changed. Review again.");
          const now = await markee.readMarkeeWallet(
            client,
            await markee.readMarkeeBoard(client, selected),
            account,
          );
          if (
            now.flowRate !== 0n ||
            now.cfaAgreement !== latest.cfaAgreement ||
            now.gdaAgreement !== latest.gdaAgreement ||
            now.ethBalance < required.wrapValue ||
            now.deposit !== latest.deposit ||
            now.ethxBalance < latest.ethxBalance ||
            now.allowance < required.buffer
          )
            throw new Error("Stream funding changed. Review Take over again.");
        },
        { rate: rate.toString() },
      );
    });
  const updateStream = (monthlyInput: string) =>
    act(async () => {
      const { client, account } = context();
      if (!boardAddress) throw new Error("No Markee board configured.");
      const selected = boardAddress;
      const reviewed = await markee.readMarkeeBoard(client, selected);
      const state = await markee.readMarkeeWallet(client, reviewed, account);
      if (state.flowRate <= 0n || state.backerMarkee === zeroAddress)
        throw new Error("No active backing to update.");
      const rate = markee.parseMonthlyRate(monthlyInput, reviewed.minimumMonthlyRate);
      const recovery: Recovery = {
        account,
        board: selected,
        messageAddress: state.backerMarkee,
        monthlyInput,
      };
      const guard = async () => {
        const boardNow = await markee.readMarkeeBoard(client, selected);
        markee.parseMonthlyRate(monthlyInput, boardNow.minimumMonthlyRate);
        if (
          boardNow.beneficiaryBps !== reviewed.beneficiaryBps ||
          configurationKey(boardNow.factoryConfig) !== configurationKey(reviewed.factoryConfig)
        )
          throw new Error("Markee settings changed. Review the stream update again.");
        const current = await markee.readMarkeeWallet(client, boardNow, account);
        if (
          current.flowRate !== state.flowRate ||
          current.backerMarkee.toLowerCase() !== state.backerMarkee.toLowerCase() ||
          current.deposit !== state.deposit
        )
          throw new Error("Your backing changed. Review the stream update again.");
      };
      const funding = markee.getRequiredWrap(
        state.ethxBalance,
        rate,
        state.deposit,
        parseEther(monthlyInput),
      );
      if (state.ethBalance < funding.wrapValue)
        throw new Error("Not enough ETH to fund the stream update.");
      if (funding.depositTopUp > 0n && state.allowance < funding.depositTopUp)
        await send(
          recovery,
          "approval",
          {
            address: markee.STREAMING_BASE.ethx,
            abi: markee.ethxAbi,
            functionName: "approve",
            args: [selected, funding.depositTopUp],
          },
          guard,
          { allowance: funding.depositTopUp.toString() },
        );
      const latest = await markee.readMarkeeWallet(
        client,
        await markee.readMarkeeBoard(client, selected),
        account,
      );
      const required = markee.getRequiredWrap(
        latest.ethxBalance,
        rate,
        latest.deposit,
        parseEther(monthlyInput),
      );
      const operations = markee.buildUpdateStreamOps({
        ethx: markee.STREAMING_BASE.ethx,
        board: selected,
        backer: account,
        ratePerSec: rate,
        depositTopUp: required.depositTopUp,
        wrapValue: required.wrapValue,
        cfaAgreement: latest.cfaAgreement,
      });
      await send(
        recovery,
        "update",
        {
          address: markee.STREAMING_BASE.host,
          abi: markee.hostAbi,
          functionName: "batchCall",
          args: [operations],
          value: required.wrapValue,
        },
        async () => {
          await guard();
          const now = await markee.readMarkeeWallet(
            client,
            await markee.readMarkeeBoard(client, selected),
            account,
          );
          if (
            now.cfaAgreement !== latest.cfaAgreement ||
            now.ethBalance < required.wrapValue ||
            markee.getRequiredWrap(now.ethxBalance, rate, now.deposit, 0n).wrapValue >
              required.wrapValue ||
            now.allowance < required.depositTopUp
          )
            throw new Error("Stream funding changed. Review the update again.");
        },
        { rate: rate.toString() },
      );
    });
  const stop = () =>
    act(async () => {
      const { client, account } = context();
      if (!boardAddress) throw new Error("No Markee board configured.");
      const state = await markee.readMarkeeWallet(
        client,
        await markee.readMarkeeExitBoard(client, boardAddress),
        account,
      );
      if (!state.flowRate) throw new Error("No active stream to stop.");
      await send(
        { account, board: boardAddress },
        "stop",
        {
          address: markee.STREAMING_BASE.host,
          abi: markee.hostAbi,
          functionName: "batchCall",
          args: [
            markee.buildStopStreamOps({
              ethx: markee.STREAMING_BASE.ethx,
              board: boardAddress,
              backer: account,
              cfaAgreement: state.cfaAgreement,
            }),
          ],
        },
        async () => {
          await guardBoard(boardAddress);
          const now = await markee.readMarkeeWallet(client, { address: boardAddress }, account);
          if (
            now.flowRate !== state.flowRate ||
            now.backerMarkee !== state.backerMarkee ||
            now.cfaAgreement !== state.cfaAgreement
          )
            throw new Error("Your backing changed. Review stopping it again.");
        },
      );
    });
  const withdraw = () =>
    act(async () => {
      const { client, account } = context();
      if (!boardAddress) throw new Error("No Markee board configured.");
      const state = await markee.readMarkeeWallet(
        client,
        await markee.readMarkeeExitBoard(client, boardAddress),
        account,
      );
      if (state.flowRate || !state.deposit)
        throw new Error("Stop backing before withdrawing an available deposit.");
      await send(
        { account, board: boardAddress },
        "withdraw",
        { address: boardAddress, abi: markee.boardAbi, functionName: "withdrawDeposit", args: [] },
        async () => {
          await guardBoard(boardAddress);
          const now = await markee.readMarkeeWallet(client, { address: boardAddress }, account);
          if (now.flowRate !== 0n || now.deposit !== state.deposit)
            throw new Error("Your deposit or stream changed. Review withdrawal again.");
        },
      );
    });
  /** The SDK's write hold of a saved submission's exact call, a Safe's when it went to one. */
  const holdOfStep = (account: Address, step: Pending, safe: boolean) => {
    const call = { to: step.target, data: step.data, value: step.value };
    return safe
      ? safeHoldOf(markee.MARKEE_CHAIN_ID, { safe: account, calls: [call], batch: false })
      : writeHolds.open({
          chainId: markee.MARKEE_CHAIN_ID,
          account,
          safe: false,
          call: { ...call, value: BigInt(call.value) },
        });
  };
  /**
   * A saved submission whose result can't be verified: its saved hash moves into the write hold
   * for its exact call (one saved before the hold held it), and the hold says whether its exit is
   * due. It is taken only on the user's explicit, warned choice. One saved with no hash before the
   * hold held it gets the hold's hashless exit, and one the hold saw settle whose Markee result
   * still can't be verified gets the journal's own. True once released.
   */
  const exitSaved = async (recovery: Recovery): Promise<boolean> => {
    const step = recovery.pending;
    if (!client || !step) return false;
    const call = { to: step.target, data: step.data, value: step.value };
    const hold = holdOfStep(
      recovery.account,
      step,
      !!step.hash && transactionActivityForHash(step.hash)?.kind === "safe",
    );
    if (step.hash) await adoptIntoHold(hold, client, step.hash);
    const state = await hold.state(client).catch(() => null);
    if (!state) return false;
    let shown: Parameters<typeof confirmHeldWriteExit>[0];
    if (state.status !== "clear") {
      if (!state.exit) return false;
      shown = state;
    } else if (!step.hash) {
      shown = { line: writeHeldMessage(), record: { call } };
    } else if (
      markeeSettlementIsSaved(state.settled, step.hash, transactionActivityForHash(step.hash))
    ) {
      shown = { line: SETTLED_UNVERIFIED, warning: WRITE_HOLD_HASHED_EXIT_LINE, record: { call } };
    } else return false;
    if (!(await confirmHeldWriteExit(shown))) return false;
    if (
      state.status !== "clear" &&
      !(await hold.exit(state, { checkedWallet: true }, client)).released
    )
      return false;
    const current = loadRecovery();
    if (!current?.pending || configurationKey(current.pending) !== configurationKey(step))
      return false;
    delete current.pending;
    saveRecovery(current);
    updateTransactionActivity(step.id, {
      status: "failed",
      manualVerificationRequired: false,
      message: RELEASED,
    });
    // Its own transaction row stops waiting for verification too.
    if (step.hash) settleTransactionActivityFailure(step.hash, RELEASED);
    setPending(false);
    return true;
  };
  const recover = (providedHash?: string) =>
    act(async () => {
      const saved = loadRecovery();
      if (!saved?.pending) throw new Error("No saved transaction to check.");
      if (!address || address.toLowerCase() !== saved.account.toLowerCase())
        throw new Error("Reconnect the wallet that submitted this transaction.");
      if (!client) throw new Error("Base RPC unavailable.");
      if (providedHash && !saved.pending.hash) {
        if (!isHash(providedHash)) throw new Error("Enter a complete transaction hash.");
        const original = saved.pending;
        const associated = await recoverMarkeeSubmission(
          client,
          saved.account,
          original,
          providedHash,
        );
        const current = loadRecovery();
        if (
          !current?.pending ||
          configurationKey(current.pending) !== configurationKey(original) ||
          current.account.toLowerCase() !== saved.account.toLowerCase()
        )
          throw new Error("The saved submission changed during hash verification.");
        // The hold takes the hash first, once the chain shows it is this attempt: a pending one
        // keeps no exit. One it can't tell from an earlier identical call is never saved, and
        // the hashless recovery keeps its exit.
        const hold = holdOfStep(saved.account, original, associated.kind === "safe");
        await adoptIntoHold(hold, client, providedHash);
        if (!holdsHash(hold, providedHash)) {
          if (await exitSaved(saved)) return "Released. Check your wallet before sending again.";
          throw new Error(RECOVERED_UNMATCHED);
        }
        saved.pending.hash = providedHash;
        saveRecovery(saved);
        updateTransactionActivity(original.id, {
          ...associated,
          hash: providedHash,
          message: "Exact submitted transaction found. Verifying the onchain result.",
        });
      }
      refreshTransactionActivities();
      try {
        await verifyPending(saved);
      } catch (cause) {
        if (!(await exitSaved(saved))) throw cause;
        return "Released. Check your wallet before sending again.";
      }
    });
  const quoteFunding = (monthlyInput: string) => {
    if (!wallet || !board) return undefined;
    try {
      return markee.getRequiredWrap(
        wallet.ethxBalance,
        markee.parseMonthlyRate(monthlyInput, board.minimumMonthlyRate),
        wallet.deposit,
        parseEther(monthlyInput),
      );
    } catch {
      return undefined;
    }
  };
  return {
    quoteFunding,
    boardAddress,
    board,
    wallet,
    loading,
    busy,
    status,
    error,
    pending,
    canCreateBoard: !boardAddress && address?.toLowerCase() === markee.MARKEE_ADMIN.toLowerCase(),
    createBoard,
    takeover,
    updateStream,
    stop,
    withdraw,
    recover,
    refresh,
  };
}
