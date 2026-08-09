import { RevnetGuide, RevnetGuideSection } from "@/components/guides/RevnetGuide";
import { Nav } from "@/components/layout/Nav";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Learn revnets",
  description:
    "Understand revnet stages, issuance, cash outs, backing, loans, operators, markets, and multichain settlement.",
};

const SECTIONS: readonly RevnetGuideSection[] = [
  {
    id: "what-is-a-revnet",
    title: "What a revnet is",
    summary:
      "A revnet is an investible network whose core financial terms are committed in advance and enforced by open contracts.",
    paragraphs: [
      "People and products pay into the network. Payments either issue the revnet's tokens or buy them from its open market, whichever route returns more tokens under the configured protections. Money used for issuance stays in the revnet's balance and backs its tokens.",
      "A revnet is built on Juicebox V6, with Revnet contracts adding staged issuance, cash-out economics, loans, and a constrained operator model. It can power a company, protocol, community, marketplace, game, or another interface without putting its financial rules behind a private backend.",
    ],
    note: "The trade is deliberate: a normal project can preserve owner-managed flexibility; a revnet gives up that flexibility so users can rely on the published deal.",
    links: [
      { href: "/discover", label: "Explore live revnets" },
      { href: "/build#choose-the-model", label: "Decide whether the model fits" },
    ],
  },
  {
    id: "stages",
    title: "Stages make the future legible",
    summary:
      "A revnet's economics unfold through stages fixed at launch, rather than through rules an owner can rewrite later.",
    paragraphs: [
      "Each stage has a start, issuance terms, a share of issuance routed to predefined recipients, cash-out terms, and optional auto-issuance. A later stage can lower issuance or change other economics, but only because that later stage was already included in the original deployment.",
      "The current stage controls activity now. The complete sequence shows what will change later. Read both before deciding whether to participate; a good interface should never present only today's favorable number while hiding the committed future.",
    ],
    points: [
      "Start: when the stage becomes active.",
      "Issuance: how many tokens a payment receives before any split share.",
      "Issuance cut: how that rate declines over time, rewarding earlier participation.",
      "Cash-out tax: how much value stays with remaining holders when someone exits.",
      "Splits and auto-issuance: who else receives newly created tokens and when.",
    ],
    links: [{ href: "/build#design-stages", label: "Design stages" }],
  },
  {
    id: "payments-and-issuance",
    title: "Payments and issuance",
    summary:
      "Issuance is the revnet's posted price for new tokens; it is not the same thing as a market trade.",
    paragraphs: [
      "When a payment takes the issuance route, the payer receives tokens according to the stage's issuance rate. A precommitted share may be issued to split recipients at the same time. The payment remains in the revnet's balance instead of becoming discretionary revenue for an owner.",
      "Issuance can decline on a fixed schedule. If it does, the same payment receives fewer tokens later. Always compare the displayed rate in its stated base currency and decimals; the accepted accounting token and the unit used to quote issuance are related, but not necessarily identical.",
    ],
    note: "A payment quote is a preview, not a promise. The app should re-read the active stage, exchange rates, route, and minimum token output immediately before signing.",
  },
  {
    id: "balance-and-cash-outs",
    title: "Balance, backing, and cash outs",
    summary:
      "Funds used to issue tokens stay in the revnet's balance, adding to the total value backing all the network's tokens.",
    paragraphs: [
      "A holder can cash out by burning tokens for a share of the available balance. A 0% cash-out tax returns the full proportional share. A higher tax returns less and leaves the difference in the balance for everyone who remains.",
      "The cash-out price can therefore differ from the issuance price and the open-market price. Those three prices answer different questions: what new tokens cost, what the contracts return for burning, and what traders currently quote in the AMM.",
    ],
    points: [
      "Issuance price describes entry through the revnet.",
      "Cash-out price describes exit against contract-held backing.",
      "AMM price describes the current open-market route.",
    ],
  },
  {
    id: "markets-and-buybacks",
    title: "Markets and buybacks",
    summary:
      "A configured buyback hook can route payments through an open market when buying tokens there is better than issuing new ones.",
    paragraphs: [
      "The router compares the routes under its configured price protections. A time-weighted average price helps resist short-lived manipulation; the permitted window ranges from five minutes to two days. A pool can improve liquidity, but it introduces market, liquidity, slippage, oracle, and smart-contract risk.",
      "Price charts are easier to read when routine trades are smoothed, but an interface should also let users inspect every trade. Smoothing is a presentation choice only; it must never alter the underlying history or transaction quote.",
    ],
    note: "No pool is guaranteed to be initialized, liquid, or the best route. Inspect the exact chain, token pair, hook, pool state, and minimum output before a swap-backed payment.",
  },
  {
    id: "splits-and-auto-issuance",
    title: "Splits and auto-issuance",
    summary:
      "A fixed share of new tokens can fund builders, contributors, communities, or other projects without giving them the balance itself.",
    paragraphs: [
      "The stage fixes the total share reserved for splits. The operator may be allowed to redirect that precommitted bucket among recipients, but cannot enlarge the bucket or rewrite the issuance and cash-out deal.",
      "Auto-issuance mints a stated number of tokens to stated recipients when a stage begins, without a payment. Because both mechanisms dilute holders, they belong in any serious assessment of token supply.",
    ],
    note: "On a multichain revnet, inspect recipient addresses and auto-issuance chain by chain. One stage has a corresponding configuration on each deployed chain.",
  },
  {
    id: "loans",
    title: "Loans keep participation intact",
    summary:
      "Eligible holders can borrow against revnet tokens as collateral instead of immediately cashing them out.",
    paragraphs: [
      "REVLoans locks the collateral and advances value against it. A prepaid fee buys a period during which reclaiming the collateral costs nothing extra; after that period the repayment cost rises over time, and sufficiently old collateral can be lost.",
      "A loan is not a free withdrawal. Read the principal, collateral, prepaid fee, source fees, repayment curve, approvals, and deadline as one position before signing.",
    ],
    note: "Loan transactions may require a narrowly scoped token-burn permission. A trustworthy client should request only the required permission, never a broad root permission.",
  },
  {
    id: "multichain",
    title: "One revnet across chains",
    summary:
      "Matching projects can form one revnet across supported Ethereum chains, with local execution and coordinated settlement.",
    paragraphs: [
      "Each chain has its own project ID, contracts, balances, accounting contexts, and stage IDs. Suckers connect the corresponding projects and move value according to the configured topology. Interfaces group those projects as one revnet, but every read and write still happens on a specific chain.",
      "Cross-chain messages are asynchronous. A displayed group balance can include value that is queued, in transit, or awaiting settlement, so applications should expose that state instead of implying every chain is instantly synchronized.",
    ],
    points: [
      "Confirm the active chain before every signature.",
      "Do not assume the same project or stage ID across chains.",
      "Track queued, sent, received, failed, and retriable movements explicitly.",
      "Treat bridge and messaging dependencies as additional protocol risk.",
    ],
  },
  {
    id: "operator-and-shops",
    title: "Operators and shops",
    summary:
      "A revnet has no owner. Its operator can hold only the permissions granted at launch and can pass that role on.",
    paragraphs: [
      "Common limited permissions can cover metadata, redirecting the already-precommitted split share, permitted shop management, buyback configuration, or adding matching chains when the deployment allows it. The operator cannot rewrite staged issuance or cash-out rules.",
      "Shop items can be created as transferable or non-transferable. That policy is fixed per item: revnet stages keep the collection-level pause gate closed, so an item cannot later switch between those behaviors. Minting and burning remain governed by the item's hook and permissions.",
    ],
    note: "A revnet can permanently retain no operator by using 0xdead000000000000000000000000000000000000. Verify the actual permission IDs on every chain; the title “operator” is not a substitute for reading them.",
    links: [{ href: "/build#choose-authority", label: "Choose an authority model" }],
  },
  {
    id: "verify-before-trusting",
    title: "Verify before trusting",
    summary:
      "The interface is a lens on public contracts, not a guarantee that a revnet, market, token, operator, or integration is safe.",
    paragraphs: [
      "Review the complete stage schedule, accepted tokens, chain deployments, balances, supply, split recipients, auto-issuance, operator permissions, hooks, pools, loans, and recent activity. Check that the website's proposed transaction matches the contract call you expect.",
      "Revnets and their surrounding protocols are open source. That makes inspection possible; it does not remove contract, economic, liquidity, bridge, token, oracle, interface, or key-management risk. Risks are borne entirely by users of the open-source code.",
    ],
    links: [
      { href: "https://github.com/rev-net/revnet-core-v6", label: "Revnet V6 source" },
      { href: "https://github.com/Bananapus/version-6", label: "Juicebox V6 source" },
      { href: "https://github.com/mejango/revnet-money", label: "Website source" },
    ],
  },
];

export default function LearnPage() {
  return (
    <>
      <Nav />
      <RevnetGuide
        eyebrow="Learn"
        title="Understand the deal before you join it."
        introduction="Revnets turn payments, token issuance, cash outs, loans, markets, and multichain settlement into a public deal that nobody can later rewrite. This guide explains what is fixed, what can still change, and what to verify."
        sections={SECTIONS}
        companion={{
          href: "/build",
          label: "Build with revnets",
          description:
            "Turn these concepts into a product architecture, launch configuration, transaction flow, and verification checklist.",
        }}
      />
    </>
  );
}
