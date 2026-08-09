import { CopyRevnetBuildPrompt } from "@/components/guides/CopyRevnetBuildPrompt";
import { RevnetGuide, RevnetGuideSection } from "@/components/guides/RevnetGuide";
import { Nav } from "@/components/layout/Nav";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Build with revnets",
  description:
    "Design and implement a safe Revnet V6 product, from immutable stages and issuance through transactions, testing, and launch.",
};

const SECTIONS: readonly RevnetGuideSection[] = [
  {
    id: "choose-the-model",
    title: "Choose the model deliberately",
    summary:
      "Use a revnet when your product benefits from permanent financial commitments more than it benefits from owner-managed rules.",
    paragraphs: [
      "Start with the user promise. Name who pays, what they receive, why the token should have durable backing, how holders exit, and which contributors share in issuance. Then decide whether those terms should be locked from launch or remain configurable in a regular Juicebox project.",
      "Your interface can be a marketplace, game, social product, protocol, community, or business. Users do not need to see every underlying contract, but they must be able to understand the financial deal and review every transaction their wallet signs.",
    ],
    points: [
      "Use a revnet for staged, precommitted issuance and cash-out economics with no owner.",
      "Use a regular Juicebox project when an accountable owner must revise payouts or rules.",
      "Combine them only when the boundary is explicit: which value belongs to immutable backing, and which remains owner-managed.",
    ],
    links: [
      { href: "/learn#what-is-a-revnet", label: "Learn the revnet model" },
      { href: "https://juicebox.money/build", label: "Compare the broader Juicebox toolkit" },
    ],
  },
  {
    id: "design-stages",
    title: "Design the complete stage schedule",
    summary:
      "Treat every stage as production code: once the revnet launches, its core economics cannot be edited away.",
    paragraphs: [
      "Write the schedule in human terms before encoding it. For each stage, specify its start, duration, issuance rate, issuance-cut frequency and percent, cash-out tax, reserved split share, recipients, and auto-issuance. Model the resulting supply and backing under slow, expected, and adversarial adoption.",
      "Later stages are not governance proposals. They are already committed transitions. Display them alongside the current stage and make boundaries, inherited values, and forever stages unmistakable.",
    ],
    points: [
      "Use an explicit future start with enough time to quote, review, fund, and execute every chain deployment.",
      "Keep cross-chain stage configurations byte-consistent where the deployer requires them to match.",
      "Check rounding at protocol precision, not only in human-readable percentages.",
      "Test stage transitions at the exact boundary timestamp and long after the final stage begins.",
    ],
    note: "If a quoted start time has passed, discard the quote and build it again. REVDeployer can lock cash outs and loans for seven days when the first stage timing is stale.",
  },
  {
    id: "model-token-economics",
    title: "Model issuance, backing, and exit together",
    summary:
      "Issuance, splits, cash-out tax, market routing, supply, and balance form one system; tuning any field in isolation is unsafe.",
    paragraphs: [
      "Calculate the payer's net issuance after the reserved share, the tokens issued to recipients, and any auto-issuance at stage start. Then simulate full and partial cash outs across plausible balances and supply. Show values in both atomic contract units and human units.",
      "If the issuance rate is quoted in ETH or USD while the revnet accepts a different accounting token, use the protocol's current currency conversion. Never infer decimals from a symbol, and never encode a base-currency ID as though it were the accounting token's currency ID.",
    ],
    points: [
      "Make the minimum token output explicit on payment.",
      "Make the minimum reclaim amount explicit on cash out.",
      "Include protocol and source fees in previews and confirmations.",
      "Re-read supply, balance, stage, rates, and route immediately before signing.",
    ],
  },
  {
    id: "configure-value-paths",
    title: "Configure value paths",
    summary:
      "Choose accepted accounting tokens, buyback routing, loans, and settlement paths with their failure modes in view.",
    paragraphs: [
      "Each accounting context identifies an actual token and decimals on a specific chain. Decide whether the revnet accepts native currency, USDC, both, or a verified custom token. If you offer broad payment-token acceptance through a router, disclose that the incoming asset will be swapped into an accounting token.",
      "A buyback hook compares issuance with the configured market route. Validate the hook, pool, pair, liquidity, TWAP window, and slippage bounds. Loans need separate collateral, permission, fee, repayment, and liquidation-state handling. None of these paths should silently fall back to a different economic action.",
    ],
    note: "A smooth chart can be the default presentation, but preserve an every-trade view and always quote transactions from live state rather than chart data.",
  },
  {
    id: "configure-multichain",
    title: "Design multichain as a state machine",
    summary:
      "A multichain revnet is a group of local projects connected by asynchronous value movement, not one magically synchronous contract.",
    paragraphs: [
      "Choose supported chains, source and destination sucker deployers, peers, token mappings, gas assumptions, and failure recovery. The deployment salt and encoded configuration must preserve the intended relationship across chains.",
      "Store identity as chain ID plus project ID, and use the sucker-group identity only for grouping. Track each movement through queued, sent, received, failed, and retriable states. Keep chain-specific operators, recipients, balances, stage IDs, tokens, and transaction hashes visible.",
    ],
    points: [
      "Never reuse one chain's project ID, stage ID, address, or decimals on another.",
      "Do not count in-flight value as settled local liquidity.",
      "Make the wallet switch to the target chain before constructing a write.",
      "Test partial deployment and partial settlement, not only the all-chains-success path.",
    ],
  },
  {
    id: "choose-authority",
    title: "Choose the smallest authority surface",
    summary:
      "A revnet has no owner. Give its operator only the permissions the product genuinely needs, or permanently retain no operator.",
    paragraphs: [
      "Useful limited controls can include metadata updates, redirecting the fixed split share, permitted shop operations, buyback configuration, and adding matching chains when the original deployment supports it. These permissions do not allow the operator to rewrite staged issuance or cash-out economics.",
      "Model the operator per chain. Display the exact granted permission IDs and whether the account is an EOA, contract, or multisig. Support transferring the role without describing the operator as an owner.",
    ],
    note: "For no retained authority, encode 0xdead000000000000000000000000000000000000 in the transaction. Do not use an empty field, the zero address, or UI-only wording as a substitute.",
  },
  {
    id: "design-shops",
    title: "Make shop-item policy permanent",
    summary:
      "Revnet products can sell ERC-721 shop items while keeping each item's transfer behavior fixed from creation.",
    paragraphs: [
      "Create each item as transferable or non-transferable according to its product meaning. Keep the collection-level pause mechanism unavailable so later stages cannot switch an item between those policies. Treat prices, supply, reserves, metadata, mint allowances, and operator minting as separate choices.",
      "Quote shop purchases together with any fungible tokens the payment receives. Place optional notes after the complete “you get” summary so the economic result stays coherent.",
    ],
    points: [
      "Simulate tier creation and minting before presenting a signature.",
      "Re-read the live hook, tier supply, price, permissions, and flags before a write.",
      "Do not promise metadata permanence unless the URI and storage policy actually provide it.",
    ],
  },
  {
    id: "map-product-actions",
    title: "Map product actions to exact protocol calls",
    summary:
      "Keep the interface product-native, but make its reads, writes, units, and contracts explicit in the implementation.",
    paragraphs: [
      "Use current V6 ABIs and audited SDK builders where available. A deployment can be built with buildRevnetStageConfig and buildDeployRevnetTx, then sent through the correct REVDeployer.deployFor overload. Keep overloaded tuple shapes unambiguous and ABI-encode the exact request you show in review.",
      "For pay, cash out, borrow, repay, shops, operator actions, market configuration, and settlement, define a pure transaction builder. The builder should accept already-validated state and return the chain, target, function, arguments, and value. Round-trip every request through the ABI in tests.",
    ],
    points: [
      "List every prerequisite read and the block or timestamp assumptions behind it.",
      "Use atomic integers internally and format only at the display boundary.",
      "Keep approvals narrowly scoped and separate from the action they authorize.",
      "Decode the final calldata in the review screen before asking the wallet to sign.",
    ],
    links: [
      { href: "https://github.com/rev-net/revnet-core-v6", label: "Revnet V6 contracts" },
      { href: "https://github.com/Bananapus/version-6", label: "Juicebox V6 contracts" },
      { href: "https://github.com/mejango/revnet-money", label: "Reference client" },
    ],
  },
  {
    id: "load-and-cache",
    title: "Make the client feel immediate without lying",
    summary:
      "Carry known project data across navigation, cache successful reads, and distinguish stale-known values from genuinely unknown values.",
    paragraphs: [
      "When a list or activity row already knows a revnet's name, logo, tagline, chain, and project ID, pass that snapshot into the destination immediately. Render it while authoritative reads refresh. Use a subtle stale-but-loading shimmer on the value, not a ghost card that erases information the user just saw.",
      "Reserve skeletons for shapes and values that have not been determined at all. Key caches by chain and contract identity, invalidate them after confirmed writes, and never let optimistic UI masquerade as final settlement.",
    ],
  },
  {
    id: "test-the-invariants",
    title: "Test invariants and adversarial states",
    summary:
      "The happy path proves the UI works; invariants prove it does not misrepresent or weaken the revnet deal.",
    paragraphs: [
      "Test math against the contracts at boundary values, maximum precision, empty liquidity, extreme supply, stage transitions, stale quotes, changed allowances, changed permissions, and reverted calls. Fork-test the same transaction builders used by the client.",
      "Threat-model malicious tokens, compromised RPCs, lagging indexers, spoofed metadata, MEV, pool manipulation, bridge delay, partial multichain execution, hostile operator accounts, and wallet-chain mismatch. Show recoverable errors beside the action that caused them.",
    ],
    points: [
      "A UI preview must match simulated and executed calldata.",
      "The operator can never alter immutable stage economics.",
      "Cash-out and loan bounds can only become safer between preview and signature.",
      "One chain's state can never be silently applied to another.",
      "Unknown state remains unknown; it is never coerced to zero, empty, or safe.",
    ],
  },
  {
    id: "launch-checklist",
    title: "Review, launch, and keep proving it",
    summary:
      "A launch is complete only when users can independently verify the deployment, not merely when a transaction succeeds.",
    paragraphs: [
      "Before funding deployment, publish a human-readable summary and the full encoded schedule. Review every chain, token, decimal, start time, split, beneficiary, auto-issuance, operator, permission, hook, pool parameter, sucker mapping, salt, creation fee, and transaction value.",
      "After confirmation, derive project IDs from receipts, verify code and configuration on every chain, pin metadata redundantly, exercise small pay and cash-out paths, and monitor indexer and settlement lag. Keep source, audits, contract addresses, and a transaction-to-contract map linked from the product.",
    ],
    note: "Do not ask a user to connect a wallet until the configuration is understandable without one. Do not ask for a signature until the app has refreshed live state and explained exactly what will change.",
    links: [
      { href: "/create", label: "Create a revnet" },
      { href: "/learn#verify-before-trusting", label: "Verification guide" },
    ],
  },
];

export default function BuildPage() {
  return (
    <>
      <Nav />
      <RevnetGuide
        eyebrow="Build"
        title="Put an open deal beneath your product."
        introduction="Start with the experience you want to create. Then use Revnet V6 to make its issuance, backing, cash outs, incentives, and authority boundary understandable and enforceable from day one."
        sections={SECTIONS}
        afterIntroduction={
          <p className="text-base text-zinc-600">
            Building with an agent? <CopyRevnetBuildPrompt />.
          </p>
        }
        afterSections={
          <p className="leading-relaxed text-zinc-700">
            Want a head start? <CopyRevnetBuildPrompt />, then give your agent the product you are
            building and the constraints your users must be able to verify. You can also inspect
            this site&apos;s implementation in the{" "}
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
          label: "Learn how revnets work",
          description:
            "Review the user-facing model, especially the difference between immutable economics and limited operator permissions.",
        }}
      />
    </>
  );
}
