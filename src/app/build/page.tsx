import { AgentSkillsNote } from "@/components/guides/AgentSkillsNote";
import { CopyRevnetBuildPrompt } from "@/components/guides/CopyRevnetBuildPrompt";
import { RevnetGuide, RevnetGuideSection } from "@/components/guides/RevnetGuide";
import { Nav } from "@/components/layout/Nav";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Build with revnets",
  description:
    "Launch a revnet and connect a product to it: the SDK, the reads, and the exact transactions for payments, cash outs, loans, shops, operator actions, and multichain moves.",
};

const REFERENCE_ROOT = "https://github.com/mejango/revnet-money/blob/main";

const SECTIONS: readonly RevnetGuideSection[] = [
  {
    id: "when-to-use-a-revnet",
    part: "Start here",
    title: "When to use a revnet",
    summary:
      "Use a revnet when your product earns revenue and you want that revenue to back a token nobody has to trust you with. Use a plain Juicebox project when you need an owner who can change course.",
    diagrams: [
      {
        label: "Pick the model",
        lines: [
          "  You need to…                              Use…",
          "  ─────────────                             ────",
          "  pay contributors from revenue, forever    revnet (split share)",
          "  let customers hold a stake they can exit  revnet (cash outs, loans)",
          "  run a token with a published schedule     revnet (stages)",
          "  pay out a budget to a team each month     Juicebox project (payouts)",
          "  change the rules after launch             Juicebox project (rulesets)",
        ],
      },
    ],
    paragraphs: [
      "A revnet is a Juicebox V6 project on each chain plus the Revnet contracts: a deployer that writes the stage schedule, an owner contract that refuses to change it, loans, and a narrowly scoped operator. From your product's side it looks like a project whose rules you can read once and rely on.",
      "Everything below assumes you have read how a revnet works. The concepts are short; the code is what takes care.",
    ],
    links: [
      { href: "/learn", label: "How a revnet works" },
      { href: "https://juicebox.money/build", label: "Juicebox build guide" },
    ],
  },
  {
    id: "operation-map",
    part: "Start here",
    title: "Every operation, in one table",
    summary:
      "Each thing a user can do maps to one contract call. The SDK ships a builder for each; the sections below show how to quote, bound, and sign it.",
    table: {
      label: "User action → contract call",
      rows: [
        ["Launch a revnet", "REVDeployer.deployFor — buildDeployRevnetTx"],
        ["Pay / buy tokens", "JBMultiTerminal.pay — buildPayTx"],
        ["Buy a shop item", "JBMultiTerminal.pay with 721 metadata — build721PayMetadata"],
        ["Add funds, no tokens", "JBMultiTerminal.addToBalanceOf"],
        ["Cash out", "JBMultiTerminal.cashOutTokensOf — prepareHookAwareCashOut"],
        ["Claim credits as ERC-20", "JBController.claimTokensFor — buildClaimTokensTx"],
        ["Borrow", "REVLoans.borrowFrom — buildBorrowTx"],
        ["Repay", "REVLoans.repayLoan — buildRepayLoanTx"],
        ["Move tokens to another chain", "sucker.prepare → toRemote → claim"],
        ["Operator: rename, redirect splits", "JBController.setUriOf / setSplitGroupsOf"],
        ["Operator: manage shop", "JB721TiersHook.adjustTiers / mintFor"],
        ["Operator: hand over", "REVOwner.setOperatorOf"],
      ],
    },
    paragraphs: [
      "Amounts are bigint in the token's own decimals until the display boundary. A revnet's identity is chain ID plus project ID; a sucker group links the chains but never makes their addresses, balances, or stage IDs interchangeable.",
    ],
  },
  {
    id: "set-up",
    part: "Start here",
    title: "Set up the SDK",
    summary:
      "Import the V6 builders and the generated ABIs and addresses. Do not hand-maintain selectors or addresses in product code.",
    paragraphs: [
      "Builders are pure: validated input in, a { chainId, address, abi, functionName, args, value } request out. Keep reads on a public client for the target chain and writes on a wallet client connected to that same chain.",
    ],
    codePoints: [
      {
        title: "Imports",
        details: [
          { key: "SDK", value: "@bananapus/nana-sdk-core/v6" },
          { key: "ABIs + addresses", value: "@bananapus/nana-sdk-core" },
          { key: "Identity", value: "{ chainId: JBChainId, projectId: bigint }" },
        ],
        code: [
          "import {",
          "  build721RulesetMetadata,",
          "  buildBorrowTx,",
          "  buildBridgeClaimTx,",
          "  buildBridgePrepareTx,",
          "  buildCashOutTx,",
          "  buildClaimTokensTx,",
          "  buildDeployRevnetTx,",
          "  buildPayTx,",
          "  buildRepayLoanTx,",
          "  buildRevnetStageConfig,",
          "  buildToRemoteTx,",
          "  getBorrowableAmount,",
          "  prepareHookAwareCashOut,",
          "  previewPay,",
          "  REV_METADATA_ALLOW_SUCKER_DEPLOYMENT,",
          "  slippageFloor,",
          '} from "@bananapus/nana-sdk-core/v6";',
          "",
          "import {",
          "  jbControllerAbi,",
          "  jbMultiTerminalAbi,",
          "  revLoansAbi,",
          "  type JBChainId,",
          '} from "@bananapus/nana-sdk-core";',
        ].join("\n"),
        links: [
          {
            href: "https://www.npmjs.com/package/@bananapus/nana-sdk-core",
            label: "V6 SDK package",
          },
          { href: "https://github.com/rev-net/revnet-core-v6", label: "Revnet V6 source" },
          { href: "https://github.com/Bananapus/version-6", label: "Juicebox V6 source" },
        ],
      },
    ],
  },
  {
    id: "read-the-revnet",
    part: "Start here",
    title: "Read the revnet",
    summary:
      "Use an indexer to find and display revnets. Use the chain for anything a signature depends on, and read it again right before signing.",
    table: {
      label: "What to read, and where",
      rows: [
        ["Controller, terminals", "JBDirectory.controllerOf / terminalsOf / primaryTerminalOf"],
        ["Current and next stage", "JBController.currentRulesetOf / upcomingRulesetOf"],
        ["Full schedule", "JBController.allRulesetsOf(projectId, startingId, size)"],
        ["Accepted tokens", "JBMultiTerminal.accountingContextsOf"],
        ["Supply and balances", "JBTokens.totalSupplyOf / totalBalanceOf / creditBalanceOf"],
        ["Splits", "JBSplits.splitsOf(projectId, rulesetId, groupId)"],
        ["Cash out quote", "JBMultiTerminal.previewCashOutFrom"],
        ["Loan capacity", "REVLoans.borrowableAmountFrom / loanOf"],
        ["Chains", "JBSuckerRegistry.suckerPairsOf"],
      ],
    },
    codePoints: [
      {
        title: "One multicall for the signing-critical state",
        code: [
          "const [controller, terminals, contexts, stage] = await publicClient.multicall({",
          "  allowFailure: false,",
          "  contracts: [",
          "    controllerOf(projectId),",
          "    terminalsOf(projectId),",
          "    accountingContextsOf(projectId),",
          "    currentRulesetOf(projectId),",
          "  ],",
          "});",
          "",
          "// Re-run the reads a quote depends on immediately before simulateContract.",
        ].join("\n"),
        links: [
          { href: `${REFERENCE_ROOT}/src/lib/nana/project.tsx`, label: "Reference project reads" },
          {
            href: `${REFERENCE_ROOT}/src/app/%5Bslug%5D/terms/getRulesets.ts`,
            label: "Stage reads",
          },
        ],
      },
    ],
    note: "Show cached names, logos, and facts while the chain refreshes. Treat state you could not read as unknown, never as zero, empty, or permitted.",
  },
  {
    id: "deploy-a-revnet",
    part: "Life of a revnet",
    title: "Launch",
    summary:
      "One call writes the whole schedule on every chain. Every stage and every chain is encoded up front, so get the configuration right before it is immutable.",
    paragraphs: [
      "Build accounting contexts with token-keyed currency IDs, then each stage with its absolute start, issuance, cut, cash out tax, split share and recipients, auto issuance, and metadata flags. The full auto issuance list is part of the cross-chain configuration even though each chain only mints its own rows.",
    ],
    codePoints: [
      {
        title: "REVDeployer.deployFor",
        details: [
          { key: "Builder", value: "buildRevnetStageConfig → buildDeployRevnetTx" },
          { key: "Value", value: "the project creation fee returned on the request" },
          {
            key: "No operator",
            value:
              "address(0); this site uses 0xdead…0000, which nobody controls, for the same effect",
          },
          {
            key: "Custom decimals",
            value: "use the tiered-721 overload to launch with a 721 hook; it returns the hook",
          },
        ],
        code: [
          "const stage = buildRevnetStageConfig({",
          "  startsAtOrAfter,",
          "  initialIssuance,              // 18-decimal tokens per base-currency unit; 1 = carry over, 0 = stop",
          "  issuanceCutFrequency,         // seconds",
          "  issuanceCutPercent,           // protocol units",
          "  cashOutTaxRate,               // protocol units",
          "  splitPercent,                 // basis points",
          "  splits: encodedSplits,        // row percents sum to SPLITS_TOTAL_PERCENT",
          "  autoIssuances,",
          "  extraMetadata:",
          "    build721RulesetMetadata({ pauseTransfers: true }) |",
          "    REV_METADATA_ALLOW_SUCKER_DEPLOYMENT,",
          "});",
          "",
          "const tx = buildDeployRevnetTx({",
          "  chainId,",
          "  config: {",
          "    description: { name, ticker, uri, salt },",
          "    baseCurrency,",
          "    operator,",
          "    scopeCashOutsToLocalBalances: false,",
          "    stageConfigurations: [stage],",
          "  },",
          "  accountingContexts,",
          "  suckerConfig: { deployerConfigurations, salt },",
          "  creationFee,",
          "});",
        ].join("\n"),
        links: [
          {
            href: `${REFERENCE_ROOT}/src/app/create/helpers/parseDeployData.ts`,
            label: "Complete deploy builder",
          },
          { href: `${REFERENCE_ROOT}/src/app/create/page.tsx`, label: "Deploy execution" },
        ],
      },
    ],
    note: "Rebuild any deployment whose first stage start has already passed. A stale first stage can trigger REVDeployer's seven-day cash out and loan lock.",
  },
  {
    id: "accept-payments",
    part: "Life of a revnet",
    title: "Get paid",
    summary:
      "Quote the terminal, compare any live market route, then sign with a minimum token output. Tell the user which route they are taking.",
    paragraphs: [
      "A terminal payment issues new tokens or, if the buyback hook finds a better price, buys from the pool. A direct pool swap is a different transaction that skips the split share. Compare executable, slippage-protected minimums rather than chart prices.",
      "ERC-20 payments approve only the request's spender for only the required amount. Native payments carry the amount in value. Shop purchases are payments with tier metadata; show every NFT plus the token result in the confirmation.",
    ],
    codePoints: [
      {
        title: "JBMultiTerminal.pay",
        details: [
          { key: "Quote", value: "previewPay → previewPayFor" },
          { key: "Builder", value: "buildPayTx" },
          { key: "Bound", value: "minReturnedTokens" },
          { key: "Shop metadata", value: "build721PayMetadata" },
        ],
        code: [
          "const quote = await previewPay(publicClient, {",
          "  chainId, terminal, projectId, token, amount, beneficiary, metadata,",
          "});",
          "",
          "const tx = buildPayTx({",
          "  chainId, terminal, projectId, token, amount, beneficiary, metadata,",
          "  minReturnedTokens: slippageFloor(quote.beneficiaryTokenCount, 100n),",
          "  memo,",
          "});",
          "",
          "// ERC-20: approve tx.address. Native: tx.value === amount.",
        ].join("\n"),
        links: [
          {
            href: `${REFERENCE_ROOT}/src/app/%5Bslug%5D/components/v6/pay/V6PayCard.tsx`,
            label: "Payment route and approval flow",
          },
          { href: `${REFERENCE_ROOT}/src/lib/v6/pay.ts`, label: "Route preview helpers" },
        ],
      },
      {
        title: "JBMultiTerminal.addToBalanceOf",
        description:
          "Adds funds without issuing tokens. Only for a token the terminal accepts directly.",
      },
    ],
  },
  {
    id: "cash-out",
    part: "Life of a revnet",
    title: "Cash out",
    summary:
      "Quote through the terminal's hook-aware preview. A surplus-only calculation can disagree with the transaction that actually runs.",
    paragraphs: [
      "previewCashOutFrom runs the real data hook and buyback decision. The route decides where the minimum goes: minTokensReclaimed on the treasury path, buyback metadata on the pool path. Re-quote after any stage, supply, balance, pool, or fee change.",
      "Credits and claimed ERC-20 tokens behave differently on the open market. Only compare a direct swap for the claimed balance the router can actually spend.",
    ],
    codePoints: [
      {
        title: "JBMultiTerminal.cashOutTokensOf",
        details: [
          {
            key: "Prepare",
            value: "prepareHookAwareCashOut → previewCashOutFrom + buildCashOutTx",
          },
          { key: "Treasury bound", value: "route.terminalMinimum" },
          { key: "Pool bound", value: "route.metadata" },
          { key: "Token count", value: "18-decimal bigint" },
        ],
        code: [
          "const prepared = await prepareHookAwareCashOut(publicClient, {",
          "  chainId, terminal, holder, projectId, cashOutCount, tokenToReclaim,",
          "  beneficiary,",
          "});",
          "",
          "const { route, transaction: tx } = prepared;",
          "// Pool routes are re-previewed with their slippage metadata before return.",
        ].join("\n"),
        links: [
          {
            href: `${REFERENCE_ROOT}/src/app/%5Bslug%5D/components/Value/RedeemDialog.tsx`,
            label: "Cash out implementation",
          },
          { href: `${REFERENCE_ROOT}/src/hooks/useCashOutRoute.ts`, label: "Hook-aware quote" },
        ],
      },
      {
        title: "Token-account operations",
        details: [
          { key: "Claim credits", value: "buildClaimTokensTx → JBController.claimTokensFor" },
          { key: "Burn", value: "buildBurnTokensTx → JBController.burnTokensOf" },
          { key: "Auto issue", value: "buildAutoIssueTx → REVOwner.autoIssueFor" },
        ],
      },
    ],
    note: "Fees to show: a cash out from a stage with a tax above 0% pays the 2.5% protocol fee on the value returned and a revnet fee on the tokens burned. At 0% tax the protocol fee applies only to the fee-free surplus portion, which is often zero.",
  },
  {
    id: "operate-loans",
    part: "Life of a revnet",
    title: "Loans",
    summary:
      "Derive loan bounds from live collateral capacity, fees, source token, and permissions, never from a cached cash out estimate.",
    paragraphs: [
      "Before borrowing, read borrowableAmountFrom in the chosen accounting context and apply a non-zero minimum. Show all three fees: the 2.5% protocol fee, the 1% revnet fee, and the borrower's prepaid fee. Grant REVLoans only BURN_TOKENS (permission ID 11), never ROOT. Collateral and source token are chain-local.",
      "Before repaying, re-read loanOf and the source fee, compute a conservative ceiling, approve or permit the source token if needed, and simulate the exact collateral being returned. Native repayment sends the ceiling as value; the excess is refunded.",
    ],
    codePoints: [
      {
        title: "REVLoans.borrowFrom",
        details: [
          { key: "Quote", value: "getBorrowableAmount / borrowableAmountFrom" },
          { key: "Builder", value: "buildBorrowTx" },
          { key: "Permission", value: "JBPermissions BURN_TOKENS = 11" },
          { key: "Bound", value: "minBorrowAmount" },
        ],
        code: [
          "const { borrowableNow } = await getBorrowableAmount(publicClient, {",
          "  chainId, revnetId, collateralCount, decimals, currency,",
          "});",
          "",
          "const tx = buildBorrowTx({",
          "  chainId, revnetId, token, collateralCount, beneficiary, holder,",
          "  prepaidFeePercent,            // 25–500 (2.5%–50%, out of 1000)",
          "  minBorrowAmount: slippageFloor(borrowableNow, 100n),",
          "});",
        ].join("\n"),
        links: [
          {
            href: `${REFERENCE_ROOT}/src/lib/loanTransactions.ts`,
            label: "Protected loan builders",
          },
          {
            href: `${REFERENCE_ROOT}/src/app/%5Bslug%5D/components/Value/hooks/useBorrowDialog.tsx`,
            label: "Borrow operation",
          },
        ],
      },
      {
        title: "REVLoans.repayLoan",
        details: [
          { key: "Builder", value: "buildRepayLoanTx" },
          { key: "Bound", value: "maxRepayBorrowAmount; excess is refunded" },
          {
            key: "Partial repay",
            value: "collateralCountToReturn; may mint a replacement loan NFT",
          },
          { key: "ERC-20", value: "Permit2 allowance or prior approval" },
        ],
        links: [
          {
            href: `${REFERENCE_ROOT}/src/app/%5Bslug%5D/components/Value/RepayDialog.tsx`,
            label: "Repayment implementation",
          },
        ],
      },
    ],
  },
  {
    id: "operator-operations",
    part: "Life of a revnet",
    title: "Operator actions",
    summary:
      "Expose only the actions the deployment granted, resolved per chain. An operator is never an owner.",
    paragraphs: [
      "Build each write from freshly resolved contracts, operator address, permission IDs, and project state, and simulate each chain on its own. A multisig proposal is pending until its Safe transaction executes; do not show success or invalidate state at proposal time.",
      "Shop tiers sit outside stage economics. Whether transfers are paused is a per-stage flag fixed at launch (build721RulesetMetadata); whether the operator can add tiers, update metadata, change discounts, or mint depends on the hook's flags and the permissions the 721 overload granted.",
    ],
    table: {
      label: "Operator write map",
      rows: [
        ["Metadata", "JBController.setUriOf"],
        ["Split redirect", "JBController.setSplitGroupsOf"],
        ["Transfer role", "REVOwner.setOperatorOf"],
        ["Add shop tiers", "JB721TiersHook.adjustTiers"],
        ["Operator mint", "JB721TiersHook.mintFor"],
        ["Buyback hook", "JBBuybackHookRegistry.setHookFor"],
        ["Router terminal", "JBRouterTerminalRegistry.setTerminalFor"],
        ["TWAP window", "JBBuybackHook.setTwapWindowOf"],
        ["Initialize pool", "JBBuybackHookRegistry.initializePoolFor"],
        ["Add chains", "REVDeployer.deploySuckersFor"],
      ],
    },
    codePoints: [
      {
        title: "Simulate with the operator, then write",
        code: [
          "const { request } = await publicClient.simulateContract({",
          "  account: operator,",
          "  address: hook,",
          "  abi: jb721TiersHookAbi,",
          '  functionName: "adjustTiers",',
          "  args: [tierConfigurations, tiersToRemove],",
          "});",
          "",
          "const hash = await walletClient.writeContract(request);",
        ].join("\n"),
        links: [
          {
            href: `${REFERENCE_ROOT}/src/app/%5Bslug%5D/components/v6/operator/OperatorAccountCard.tsx`,
            label: "Operator transfer implementation",
          },
          {
            href: `${REFERENCE_ROOT}/src/app/%5Bslug%5D/components/v6/shop/AddItemsModal.tsx`,
            label: "Shop tier writes",
          },
        ],
      },
    ],
    note: "For a revnet with no operator ever, pass address(0): REVOwner treats it as the explicit no-operator value and writes no permissions. An address nobody controls, like the 0xdead one this site uses, has the same effect.",
  },
  {
    id: "move-across-chains",
    part: "Life of a revnet",
    title: "Move across chains",
    summary:
      "A cross-chain move is a state machine with several transactions: prepare, send, prove, claim, and separately sync accounting.",
    diagrams: [
      {
        label: "Sucker sequence",
        lines: [
          "  source chain                          destination chain",
          "  ────────────                          ─────────────────",
          "  1. prepare   burn tokens, queue leaf",
          "  2. toRemote  send the root  ──────▶   (bridge delivers)",
          "                                        3. claim   prove leaf, mint tokens",
          "",
          "  syncAccountingData  push the local balance snapshot to the peer",
        ],
      },
    ],
    paragraphs: [
      "A prepared move is not delivered value. Track its source sucker, peer sucker, token mapping, leaf index, beneficiary, proof, transport, fees, and status. CCIP and native bridges need different value and take different times; discover the payable value by simulating the exact call.",
      "Accounting sync changes the displayed group backing without moving any local balance. Keep queued, in transit, claimable, claimed, failed, and retriable distinct.",
    ],
    codePoints: [
      {
        title: "Builders",
        details: [
          { key: "1. Prepare", value: "buildBridgePrepareTx → sucker.prepare" },
          { key: "2. Send", value: "buildToRemoteTx → sucker.toRemote" },
          { key: "3. Claim", value: "buildBridgeClaimTx → peerSucker.claim" },
          { key: "Accounting", value: "buildSyncAccountingDataTx → sucker.syncAccountingData" },
          { key: "Peers", value: "getV6SuckerPairs" },
        ],
        code: [
          "const prepare = buildBridgePrepareTx({",
          "  chainId, sucker, projectTokenCount, beneficiary,",
          "  minTokensReclaimed, token, metadata,",
          "});",
          "",
          "const send = buildToRemoteTx({ chainId, sucker, token, value: bridgeFee });",
          "const claim = buildBridgeClaimTx({ chainId: peerChainId, sucker: peer, claim: proof });",
          "const sync = buildSyncAccountingDataTx({ chainId, sucker, value: syncFee });",
        ].join("\n"),
        links: [
          {
            href: `${REFERENCE_ROOT}/src/lib/bridgePrepare.ts`,
            label: "Protected prepare builder",
          },
          { href: `${REFERENCE_ROOT}/src/lib/v6/suckerProofs.ts`, label: "Proof and claim flow" },
          {
            href: `${REFERENCE_ROOT}/src/app/%5Bslug%5D/components/v6/owners/settlement/lib.ts`,
            label: "Settlement state machine",
          },
        ],
      },
    ],
  },
  {
    id: "transaction-boundary",
    part: "Ship it safely",
    title: "One transaction boundary",
    summary:
      "The request you quote, simulate, decode, show, and submit must be the same object, not five reconstructions of it.",
    diagrams: [
      {
        label: "Build → simulate → decode → review → write → confirm",
        lines: [
          "  fresh reads ─▶ pure builder ─▶ simulateContract(account)",
          "                                   │",
          "                    encode + decode calldata, show it to the user",
          "                                   │",
          "                          writeContract ─▶ waitForTransactionReceipt",
          "                                   │",
          '            success only on receipt.status === "success"',
        ],
      },
    ],
    paragraphs: [
      "Right before signing, refresh the reads that set bounds and permissions, rebuild, simulate with the real account, then decode the calldata and present it. After submission, keep wallet rejection, Safe proposal, inclusion, revert, and confirmed success as separate states. Only confirmed success invalidates reads.",
    ],
    codePoints: [
      {
        title: "Reference boundary",
        code: [
          "const tx = buildOperation(freshState, userInput);",
          "",
          "const { request } = await publicClient.simulateContract({ ...tx, account });",
          "",
          "const calldata = encodeFunctionData(tx);",
          "const decoded = decodeFunctionData({ abi: tx.abi, data: calldata });",
          "await review({ ...tx, calldata, decoded });",
          "",
          "const hash = await walletClient.writeContract(request);",
          "const receipt = await publicClient.waitForTransactionReceipt({ hash });",
          'if (receipt.status !== "success") throw new Error("Transaction reverted");',
        ].join("\n"),
        links: [
          { href: `${REFERENCE_ROOT}/src/lib/transaction-review.ts`, label: "Review decoder" },
          {
            href: `${REFERENCE_ROOT}/scripts/check-wallet-write-sites.mjs`,
            label: "Write-site inventory check",
          },
        ],
      },
    ],
  },
  {
    id: "test-and-verify",
    part: "Ship it safely",
    title: "Test what can surprise you",
    summary:
      "Test the builders you ship, at the edges where fixed economics, route changes, permissions, and asynchronous settlement bite.",
    points: [
      {
        key: "Launch",
        text: "the encoded configuration round-trips through the ABI on every overload; a stale first-stage start is rejected.",
      },
      {
        key: "Payments",
        text: "the chosen route's executable minimum is no worse than the alternatives shown; an empty pool falls back to issuance.",
      },
      {
        key: "Cash outs",
        text: "the terminal or hook enforces the same minimum the confirmation shows, including at 0% fee-free surplus.",
      },
      {
        key: "Loans",
        text: "only permission ID 11 is granted; repayment ceilings cannot underpay the live obligation; partial repay mints the replacement NFT.",
      },
      {
        key: "Operator",
        text: "no exposed call can change committed issuance, cuts, taxes, or split percentages; a Safe proposal is not success.",
      },
      {
        key: "Multichain",
        text: "one chain's project, token, decimals, operator, or proof is never reused on another; delayed claims stay claimable.",
      },
    ],
    paragraphs: [
      "Fork-test against the current deployments. Then publish the addresses, source, transaction map, and a human-readable stage schedule so users can check your product against the contracts themselves.",
    ],
    links: [
      { href: "/audit", label: "Audit prompts and source index" },
      { href: "/learn#verify-before-trusting", label: "What users will check" },
      { href: "https://github.com/mejango/revnet-money", label: "Reference web client" },
    ],
  },
];

export default function BuildPage() {
  return (
    <>
      <Nav />
      <RevnetGuide
        eyebrow="Build"
        title="Build with revnets"
        introduction="Start from the experience you want to ship. This guide maps each user action to the exact V6 read and transaction, shows the reference implementation for each, and keeps the quote, simulation, review, and confirmation on one path."
        sections={SECTIONS}
        afterIntroduction={
          <>
            <p className="text-base text-zinc-600">
              Revnets are built on Juicebox. The{" "}
              <Link
                href="https://juicebox.money/build"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-melon-400 underline-offset-4"
              >
                Juicebox build guide
              </Link>{" "}
              covers the protocol-level calls, hooks, and permissions.
            </p>
            <p className="text-base text-zinc-600">
              Building with an agent? <CopyRevnetBuildPrompt />.
            </p>
            <AgentSkillsNote
              skills={[
                "jb-revnet-deploy",
                "revnet-economics",
                "jb-revloans",
                "jb-suckers",
                "jb-tx-safety",
              ]}
            />
          </>
        }
        afterSections={
          <p className="leading-relaxed text-zinc-700">
            Start from the smallest operation your product needs, copy its reference pattern, and
            keep the live read, pure builder, simulation, review, and confirmation on one path. The
            complete working implementation is the{" "}
            <Link
              href="https://github.com/mejango/revnet-money"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-melon-400 underline-offset-4"
            >
              Revnet Money repository
            </Link>
            .
          </p>
        }
        companion={{
          href: "/learn",
          label: "How a revnet works",
          description:
            "Stages, the three prices, cash out taxes, loans, operators, and multichain, in plain language, before you turn them into product actions.",
        }}
      />
    </>
  );
}
