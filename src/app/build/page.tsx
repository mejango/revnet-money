import { CopyRevnetBuildPrompt } from "@/components/guides/CopyRevnetBuildPrompt";
import { RevnetGuide, RevnetGuideSection } from "@/components/guides/RevnetGuide";
import { Nav } from "@/components/layout/Nav";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Build with Revnet V6",
  description:
    "Implement Revnet V6 reads and operations with exact SDK builders, contract calls, safety bounds, and reference source code.",
};

const REFERENCE_ROOT = "https://github.com/mejango/revnet-money/blob/main";

const SECTIONS: readonly RevnetGuideSection[] = [
  {
    id: "wire-the-v6-surface",
    title: "Wire the V6 surface",
    summary:
      "Start from the current SDK, generated ABIs, and deployed-address registry; do not hand-maintain selectors or addresses in product code.",
    paragraphs: [
      "A revnet is a Juicebox V6 project on each chain plus Revnet contracts for deployment, immutable stage ownership, loans, and operator controls. Model its local identity as chain ID plus project ID. A sucker group can connect those local projects, but it does not make their addresses, balances, stage IDs, or writes interchangeable.",
      "Use the V6 SDK builders as pure transaction constructors. Keep reads on a chain-specific public client, writes on a wallet client connected to that same chain, and amounts as bigint atomic units until the display boundary.",
    ],
    codePoints: [
      {
        title: "Import builders and generated contract surfaces",
        details: [
          { key: "SDK", value: "@bananapus/nana-sdk-core/v6" },
          { key: "ABIs + addresses", value: "@bananapus/nana-sdk-core" },
          { key: "Local identity", value: "{ chainId: JBChainId, projectId: bigint }" },
          { key: "Amounts", value: "bigint in the token or protocol field's declared decimals" },
        ],
        code: [
          "import {",
          "  build721RulesetMetadata,",
          "  buildAutoIssueTx,",
          "  buildBorrowTx,",
          "  buildBridgeClaimTx,",
          "  buildBridgePrepareTx,",
          "  buildBurnTokensTx,",
          "  buildCashOutTx,",
          "  buildClaimTokensTx,",
          "  buildDeployRevnetTx,",
          "  buildPayTx,",
          "  buildRepayLoanTx,",
          "  buildRevnetStageConfig,",
          "  buildSyncAccountingDataTx,",
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
          { href: "https://github.com/Bananapus/version-6", label: "Juicebox V6 source" },
          { href: "https://github.com/rev-net/revnet-core-v6", label: "Revnet V6 source" },
        ],
      },
    ],
  },
  {
    id: "read-the-revnet",
    title: "Read the revnet before operating it",
    summary:
      "Discovery data can come from an indexer; anything used to construct a signature must be refreshed from the target chain.",
    paragraphs: [
      "Resolve the controller, terminals, accounting contexts, token, current stage, full committed stage schedule, splits, sucker peers, operator, and relevant permission IDs. Cache successful reads by chain and contract identity, then invalidate the affected keys after a confirmed write.",
      "Render previously known names, logos, and project facts while RPC reads refresh. Treat missing onchain state as unknown—not zero, empty, or permissionless.",
    ],
    codePoints: [
      {
        title: "Signing-critical read map",
        details: [
          { key: "Directory", value: "JBDirectory.controllerOf / terminalsOf / primaryTerminalOf" },
          { key: "Stage", value: "JBController.currentRulesetOf / JBRulesets.getRulesetOf" },
          { key: "Accepted tokens", value: "JBMultiTerminal.accountingContextsOf" },
          { key: "Supply", value: "JBTokens.totalSupplyOf / totalBalanceOf / creditBalanceOf" },
          { key: "Splits", value: "JBSplits.splitsOf(projectId, rulesetId, groupId)" },
          { key: "Cash out", value: "JBMultiTerminal.previewCashOutFrom" },
          { key: "Loans", value: "REVLoans.borrowableAmountFrom / loanOf" },
          { key: "Peers", value: "JBSuckerRegistry.suckerPairsOf" },
        ],
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
          "// Re-run the reads used by a quote immediately before simulateContract.",
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
  },
  {
    id: "deploy-a-revnet",
    title: "Deploy the immutable schedule",
    summary:
      "Encode every stage and every chain deliberately, then simulate the exact REVDeployer.deployFor overload shown in review.",
    paragraphs: [
      "Build accounting contexts with token-keyed currency IDs. Build each stage with its absolute start, issuance, issuance cut, cash-out tax, split bucket, recipients, auto-issuance, and metadata flags. The full auto-issuance list participates in the cross-chain encoded configuration even though each chain only mints its local rows.",
      "Use the explicit tiered-721 overload when a custom reserve token needs non-18 shop-price decimals. Filter overloaded tuple-heavy ABIs to the selected argument count before encoding, simulation, review, and submission so each boundary uses the same selector.",
    ],
    codePoints: [
      {
        title: "REVDeployer.deployFor",
        details: [
          { key: "Builder", value: "buildRevnetStageConfig → buildDeployRevnetTx" },
          { key: "Contract", value: "REVDeployer" },
          { key: "Function", value: "deployFor" },
          { key: "Value", value: "project creation fee returned on the request" },
          { key: "No operator", value: "0xdead000000000000000000000000000000000000" },
        ],
        code: [
          "const stage = buildRevnetStageConfig({",
          "  startsAtOrAfter,",
          "  initialIssuance,              // 18-decimal project-token weight",
          "  issuanceCutFrequency,         // seconds",
          "  issuanceCutPercent,           // protocol units",
          "  cashOutTaxRate,               // protocol units",
          "  splitPercent,                 // basis points",
          "  splits: encodedSplits,          // row percents sum to SPLITS_TOTAL_PERCENT",
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
          { href: `${REFERENCE_ROOT}/src/app/create/page.tsx`, label: "Deploy execution boundary" },
        ],
      },
    ],
    note: "Discard and rebuild a deployment quote whose first-stage start has passed. A stale first stage can activate REVDeployer's seven-day cash-out and loan lock.",
  },
  {
    id: "accept-payments",
    title: "Quote and execute payments",
    summary:
      "Preview the live terminal path, compare any executable market route, then bind the chosen route with a minimum project-token output.",
    paragraphs: [
      "A terminal payment may issue new tokens or route through the configured buyback hook. A direct market swap is a different transaction and bypasses the stage split. Compare executable, slippage-protected minimums—not optimistic chart prices—and explain which route the wallet will sign.",
      "For ERC-20 payments, approve only the request's actual spender and only the required amount. Native-token requests carry the amount in value. Shop purchases are still payments; build tier metadata and include every NFT plus the fungible-token result in the confirmation.",
    ],
    codePoints: [
      {
        title: "JBMultiTerminal.pay",
        details: [
          { key: "Quote", value: "previewPay(publicClient, …) → previewPayFor" },
          { key: "Builder", value: "buildPayTx" },
          { key: "Function", value: "JBMultiTerminal.pay" },
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
        title: "Add funds without issuing tokens",
        details: [
          { key: "Contract", value: "JBMultiTerminal" },
          { key: "Function", value: "addToBalanceOf" },
          { key: "Constraint", value: "only a token accepted directly by that terminal" },
        ],
      },
    ],
  },
  {
    id: "cash-out",
    title: "Cash out through the live route",
    summary:
      "Use the hook-aware terminal preview; a surplus-only calculation can disagree with the transaction that will actually execute.",
    paragraphs: [
      "JBMultiTerminal.previewCashOutFrom runs the real data-hook and buyback decision. Its route determines where the minimum belongs: minTokensReclaimed on the treasury path, or buyback metadata on the AMM path. Re-quote after any stage, supply, balance, pool, hook, or fee change.",
      "Internal credits and claimed ERC-20 tokens have different direct-market capabilities. Only compare a direct swap for the claimed balance that the router can actually spend.",
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
          { key: "AMM bound", value: "route.metadata" },
          { key: "Token count", value: "18-decimal revnet-token bigint" },
        ],
        code: [
          "const prepared = await prepareHookAwareCashOut(publicClient, {",
          "  chainId, terminal, holder, projectId, cashOutCount, tokenToReclaim,",
          "  beneficiary,",
          "});",
          "",
          "const { route, transaction: tx } = prepared;",
          "// AMM routes are re-previewed with their slippage metadata before return.",
        ].join("\n"),
        links: [
          {
            href: `${REFERENCE_ROOT}/src/app/%5Bslug%5D/components/Value/RedeemDialog.tsx`,
            label: "Cash-out implementation",
          },
          { href: `${REFERENCE_ROOT}/src/hooks/useCashOutRoute.ts`, label: "Hook-aware quote" },
        ],
      },
      {
        title: "Token-account operations",
        details: [
          { key: "Claim credits", value: "buildClaimTokensTx → JBController.claimTokensFor" },
          { key: "Burn", value: "buildBurnTokensTx → JBController.burnTokensOf" },
          { key: "Auto-issue", value: "buildAutoIssueTx → REVOwner.autoIssueFor" },
        ],
      },
    ],
  },
  {
    id: "operate-loans",
    title: "Open, repay, and reallocate loans",
    summary:
      "Loan UI must derive its bounds from current collateral capacity, fees, source token, and permission state—not from a cached cash-out estimate.",
    paragraphs: [
      "Before borrowing, read borrowableAmountFrom in the selected accounting context and apply a non-zero minimum. Grant REVLoans only BURN_TOKENS permission ID 11; never grant ROOT. The collateral and source token are chain-local.",
      "Before repayment, re-read loanOf and the source fee, compute a conservative maximum, approve or permit the source token if necessary, and simulate the exact collateral amount being returned. Native-token repayment sends the ceiling as value; excess is refunded.",
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
          "  prepaidFeePercent,",
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
    title: "Implement the limited operator surface",
    summary:
      "Resolve permission per chain and expose only the operations the immutable deployment granted; an operator is never a revnet owner.",
    paragraphs: [
      "Build each operator write from freshly resolved contracts, operator address, permission IDs, and project state. Simulate each chain independently. A multisig proposal is pending until its Safe transaction executes onchain; do not invalidate state or show success at proposal creation.",
      "Shop tiers are separate from stage economics. Tier transferability is fixed at creation, while operator ability to add tiers, update metadata, change discounts, or mint depends on the deployed hook flags and permissions.",
    ],
    codePoints: [
      {
        title: "Operator write map",
        details: [
          { key: "Metadata", value: "JBController.setUriOf" },
          { key: "Split redirect", value: "JBController.setSplitGroupsOf" },
          { key: "Transfer role", value: "REVOwner.setOperatorOf" },
          { key: "Add shop tiers", value: "JB721TiersHook.adjustTiers" },
          { key: "Operator mint", value: "JB721TiersHook.mintFor" },
          { key: "Buyback hook", value: "JBBuybackHookRegistry.setHookFor" },
          { key: "Router terminal", value: "JBRouterTerminalRegistry.setTerminalFor" },
          { key: "TWAP", value: "JBBuybackHook.setTwapWindowOf" },
          { key: "Initialize pool", value: "JBBuybackHookRegistry.initializePoolFor" },
          { key: "Add chains", value: "REVDeployer.deploySuckersFor" },
        ],
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
    note: "For a permanently authority-free revnet, deploy the operator as 0xdead000000000000000000000000000000000000. The zero address and an empty UI field are not equivalent.",
  },
  {
    id: "move-across-chains",
    title: "Move tokens and settle accounting across chains",
    summary:
      "Treat sucker movement as a multi-transaction state machine: prepare, send, prove, claim, and separately sync accounting snapshots.",
    paragraphs: [
      "A prepared movement is not delivered value. Track its source sucker, peer sucker, token mapping, leaf index, beneficiary bytes32, proof, transport, fees, and status. CCIP and native bridge families have different value requirements and delivery times; discover payable value by simulating the exact call rather than guessing.",
      "Accounting gossip can change displayed group backing without moving the local terminal balance. Keep queued, in-transit, claimable, claimed, failed, and retriable states distinct.",
    ],
    codePoints: [
      {
        title: "Sucker transaction sequence",
        details: [
          { key: "1. Prepare", value: "buildBridgePrepareTx → sucker.prepare" },
          { key: "2. Send", value: "buildToRemoteTx → sucker.toRemote" },
          { key: "3. Claim", value: "buildBridgeClaimTx → peerSucker.claim" },
          { key: "Accounting", value: "buildSyncAccountingDataTx → sucker.syncAccountingData" },
          { key: "Peer discovery", value: "getV6SuckerPairs" },
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
    title: "Use one reviewed transaction boundary",
    summary:
      "The request you quote, simulate, decode, review, and submit must be the same request—not five similar reconstructions.",
    paragraphs: [
      "Make every operation builder pure: validated input in; chain ID, address, ABI, function name, arguments, and value out. Immediately before signing, refresh the reads that establish bounds and permissions, rebuild, simulate with the actual account, ABI-encode and decode the calldata, then present it for review.",
      "After submission, distinguish wallet rejection, Safe proposal, onchain inclusion, reverted execution, and confirmed success. Only confirmed execution should invalidate reads and move the UI to its final state.",
    ],
    codePoints: [
      {
        title: "Build → simulate → decode → write → confirm",
        code: [
          "const tx = buildOperation(freshState, userInput);",
          "",
          "const { request } = await publicClient.simulateContract({",
          "  ...tx,",
          "  account,",
          "});",
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
    title: "Test the contract-facing invariants",
    summary:
      "Test the same builders your product ships, at the boundaries where immutable economics, route changes, permissions, and asynchronous settlement can surprise it.",
    paragraphs: [
      "Round-trip every builder through its ABI and fork-test it against current deployments. Cover stale stage starts, exact stage boundaries, split rounding, custom decimals, changed allowance, changed route, empty pool, changed cash-out hook, zero fee-free surplus, partial loan repayment, Safe proposal without execution, partial multichain deployment, and delayed claims.",
      "Publish the contract addresses, source repositories, transaction map, and human-readable stage schedule users need to independently verify your implementation.",
    ],
    points: [
      {
        key: "Deployment",
        text: "the encoded configuration is byte-consistent where required and every overload round-trips",
      },
      {
        key: "Payments",
        text: "the chosen route's executable minimum is no worse than the alternatives shown",
      },
      {
        key: "Cash outs",
        text: "the terminal or hook enforces the same minimum the confirmation displays",
      },
      {
        key: "Loans",
        text: "only permission ID 11 is granted and repayment ceilings cannot underpay the live obligation",
      },
      {
        key: "Operator",
        text: "no exposed call can rewrite committed stage issuance or cash-out economics",
      },
      {
        key: "Multichain",
        text: "one chain's project, token, decimals, operator, or proof is never reused on another",
      },
    ],
    links: [
      { href: "https://github.com/rev-net/revnet-core-v6", label: "Revnet contracts" },
      { href: "https://github.com/Bananapus/version-6", label: "Juicebox contracts" },
      { href: "https://github.com/mejango/revnet-money", label: "Reference web client" },
      { href: "/learn#verify-before-trusting", label: "User-facing verification model" },
    ],
  },
];

export default function BuildPage() {
  return (
    <>
      <Nav />
      <RevnetGuide
        eyebrow="Build"
        title="Implement Revnet V6 operations"
        introduction="Connect your product to revnet deployment, payments, cash outs, loans, shops, operator controls, and multichain settlement with the same code paths users can inspect and verify."
        sections={SECTIONS}
        afterIntroduction={
          <>
            <p className="text-base text-zinc-600">
              Revnets are built on Juicebox, so the protocol-level operations are documented in the{" "}
              <Link
                href="https://juicebox.money/build"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-melon-400 underline-offset-4"
              >
                Juicebox build guide
              </Link>
              .
            </p>
            <p className="text-base text-zinc-600">
              Building with an agent? <CopyRevnetBuildPrompt />.
            </p>
          </>
        }
        afterSections={
          <p className="leading-relaxed text-zinc-700">
            Start from the smallest operation your product needs, copy its reference pattern, and
            keep the live read, pure builder, simulation, review, and confirmation boundaries
            intact. The complete working implementation is in the{" "}
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
          label: "Learn the behavior behind each call",
          description:
            "Review stages, issuance, backing, loans, shops, operator limits, and multichain settlement before turning them into product actions.",
        }}
      />
    </>
  );
}
