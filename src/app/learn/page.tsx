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
      "A revnet is a capital structure and business model whose core financial terms are committed in advance and enforced by open contracts.",
    paragraphs: [
      "People and products pay into the network. Payments either issue the revnet's tokens or buy them from its open market, whichever route returns more tokens to the payer. Money used for issuance stays in the revnet's balance and forever backs its tokens — holders can cash out or borrow to access the balance.",
      "Revnets are built on Juicebox V6 protocol, with Revnet contracts adding a standard schema for staged issuance, cash-out economics, loans, and permissions. It primarily serves as a business model for open source projects, yet can serve as infrastructure for other types of financial agreements between cooperative or adversarial participants.",
    ],
    note: "The tradeoff is deliberate: a normal project can preserve total owner-managed flexibility; a revnet gives up that full flexibility so users can rely on the published agreement — like Bitcoin.",
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
      { key: "Start", text: "when the stage becomes active." },
      { key: "Issuance", text: "how many tokens a payment receives before any split share." },
      {
        key: "Issuance cut",
        text: "how that rate declines over time, rewarding earlier participation.",
      },
      {
        key: "Cash-out tax",
        text: "how much value stays with remaining holders when someone exits.",
      },
      {
        key: "Splits and auto-issuance",
        text: "who else receives newly created tokens and when.",
      },
    ],
  },
  {
    id: "payments-and-issuance",
    title: "Payments and issuance",
    summary:
      "Issuance is the revnet's posted price for new tokens; it is not the same thing as a market trade — the issuance price effectively serves as a price ceiling for the open market.",
    paragraphs: [
      "When a payment takes the issuance route, the payer receives tokens according to the stage's issuance rate. A precommitted share may be issued to split recipients at the same time. The payment remains in the revnet's balance instead of becoming discretionary revenue for an owner.",
      "Issuance per stage is unlimited, and can decline on a fixed schedule. If it does, the same payment receives fewer tokens later. Always compare the displayed rate in its stated base currency and decimals; the accepted accounting token and the unit used to quote issuance are related, but not necessarily identical.",
    ],
  },
  {
    id: "balance-and-cash-outs",
    title: "Balance, backing, and cash outs",
    summary:
      "Funds used to issue tokens stay in the revnet's balance, adding to the total value backing all the network's tokens.",
    paragraphs: [
      "A holder can cash out by burning tokens for a share of the available balance. A 0% cash-out tax returns the full proportional share. A higher tax returns less and leaves the difference in the balance for everyone who remains.",
      "The cash-out price differs from the issuance price and the open-market price — it serves as a price floor to the open market. Those three prices answer different questions: what new tokens cost, what the contracts return for burning, and what traders currently quote in the AMM.",
    ],
    points: [
      {
        key: "Issuance price",
        text: "describes entry through the revnet — a price ceiling.",
      },
      {
        key: "Cash-out price",
        text: "describes exit against contract-held backing — a price floor.",
      },
      { key: "AMM price", text: "describes the current open-market price." },
    ],
  },
  {
    id: "markets-and-buybacks",
    title: "Markets and buybacks",
    summary:
      "Inbound payments are automatically routed through an open market when buying tokens there is better than issuing new ones. Either way, the current stage's split is honored from the resulting amount.",
    paragraphs: [
      "Users speculating on the token are better off buying from the market directly instead of through the revnet so they don't incur the split. Revnet frontends should automatically route users to the best price.",
    ],
    note: "No pool is guaranteed to be initialized, liquid, or the best route. Inspect the exact chain, token pair, hook, pool state, and minimum output before a swap-backed payment. If there is no pool, the revnet's issuance and cash out are the only sources of liquidity.",
  },
  {
    id: "splits-and-auto-issuance",
    title: "Splits and auto-issuance",
    summary:
      "A fixed share of new tokens can fund builders, contributors, communities, or other projects without giving them the balance itself.",
    paragraphs: [
      "The stage fixes the total percent reserved for splits. The operator may be allowed to redirect that precommitted split limit, but cannot enlarge the total percentage or rewrite the issuance and cash-out deal.",
      "Auto-issuance mints a stated number of tokens to stated recipients when a stage begins, without a payment. Because both mechanisms dilute holders, they belong in any serious assessment of token supply.",
    ],
    note: "On a multichain revnet, inspect recipient addresses and auto-issuance chain by chain. The split limit must be the same on all chains but they can be routed to different destinations.",
  },
  {
    id: "loans",
    title: "Loans keep participation intact",
    summary:
      "Instead of cashing out, holders can borrow against revnet tokens as collateral, giving them access to liquidity while also keeping an option on their tokens.",
    paragraphs: [
      "The revnet locks the collateral and advances value against it. A prepaid fee buys a period during which reclaiming the collateral costs nothing extra; after that period the repayment cost rises over time, and after ten years the collateral is lost.",
      "A loan is not a free withdrawal. The revnet itself offering the loan takes a fee in exchange for the option to one day reclaim the collateral.",
    ],
    note: "Revnet loans work by pre-liquidating the collateral and later reminting to the user depending on when the principal + fees are returned.",
  },
  {
    id: "multichain",
    title: "One revnet across chains",
    summary:
      "A revnet exists across supported Ethereum chains, with local execution and coordinated settlement.",
    paragraphs: [
      "Each chain has its own project ID, balances, and token supply, and matching contracts and agreements unfolding in sync over time. Revnets can take in funds and issue out its tokens atomically on any chain.",
      "Token holders can move their balances across chains, moving a proportional amount of the project's balance alongside. Cross-chain messages are asynchronous.",
      "Cross-chain messages are asynchronous. A displayed group balance can include value that is queued, in transit, or awaiting settlement.",
    ],
  },
  {
    id: "shops",
    title: "Shops",
    summary: "Shop items can be created as transferable or non-transferable.",
    paragraphs: [
      "That policy is fixed per item: revnet stages keep the collection-level pause gate closed, so an item cannot later switch between those behaviors. Minting and burning remain governed by the item's hook and permissions.",
    ],
  },
  {
    id: "operator",
    title: "Operator",
    summary:
      "A revnet has no owner. Its operator can hold only the permissions granted at launch and can pass that role on.",
    paragraphs: [
      "An operator's limited permissions can cover metadata, redirecting the already-precommitted split share, permitted shop management, buyback configuration, or extending the revnet to new chains if allowed by the deployment. The operator cannot rewrite staged issuance or cash-out rules.",
    ],
    note: "A revnet can permanently retain no operator by using 0xdead000000000000000000000000000000000000. Verify the actual permission IDs on every chain; the title “operator” is not a substitute for reading them.",
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
        title="Get to know the engine under the hood"
        introduction="Revnets turn payments, token issuance, cash outs, loans, markets, and multichain settlement into a public agreement that nobody can later amend or rewrite."
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
