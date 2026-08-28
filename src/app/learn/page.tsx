import { AgentSkillsNote } from "@/components/guides/AgentSkillsNote";
import { RevnetGuide, RevnetGuideSection } from "@/components/guides/RevnetGuide";
import { Nav } from "@/components/layout/Nav";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Learn revnets",
  description:
    "What a revnet is, how money and tokens move through one, what stages, cash out taxes, loans, and operators do, and what to check before you trust one.",
};

const SECTIONS: readonly RevnetGuideSection[] = [
  {
    id: "what-is-a-revnet",
    part: "The basics",
    title: "What a revnet is",
    summary:
      "A revnet is a business whose money rules are written down at launch and enforced by open contracts. Nobody, including whoever launched it, can change them afterwards.",
    paragraphs: [
      "Customers and supporters pay the revnet. Every payment issues the revnet's token to the payer, and the money stays in the revnet's balance, where it backs those tokens. Token holders can cash out for a share of the balance, borrow against their tokens, or sell them on an open market.",
      "That is the whole deal. A revnet does not have an owner who can pause it, raise prices in secret, or take the money out. It has a schedule, and the schedule runs.",
      "Revnets are for open source projects, protocols, and any group that wants to share revenue with its contributors and customers without asking anyone to trust a treasury manager.",
    ],
    diagrams: [
      {
        label: "Project vs revnet",
        lines: [
          "  JUICEBOX PROJECT                 REVNET",
          "  ────────────────                 ──────",
          "  owner sets and changes rules     rules fixed at launch",
          "  owner can pay funds out          balance only leaves via cash outs and loans",
          "  good for: teams, DAOs, funds     good for: tokens, protocols, open businesses",
        ],
      },
    ],
    note: "The tradeoff is on purpose. A normal project keeps its flexibility; a revnet gives it up so that everyone can rely on the published terms, the way Bitcoin's supply schedule is relied on.",
    links: [
      { href: "/discover", label: "Explore live revnets" },
      { href: "/build#when-to-use-a-revnet", label: "Decide whether a revnet fits your product" },
    ],
  },
  {
    id: "how-money-flows",
    part: "The basics",
    title: "How money flows",
    summary:
      "There are only two core actions: pay and cash out. Everything else is a rule about how those two behave.",
    diagrams: [
      {
        label: "The loop",
        lines: [
          "  1. Someone PAYS the revnet",
          "     └─▶ they receive tokens at the current issuance rate",
          "     └─▶ a fixed share of new tokens goes to the revnet's splits",
          "     └─▶ the payment stays in the balance",
          "",
          "  2. Holders CASH OUT",
          "     └─▶ burn tokens, take a share of the balance",
          "     └─▶ the cash out tax decides how much stays for everyone else",
          "",
          "  3. Or holders BORROW against tokens instead of cashing out",
          "",
          "  backing per token = balance ÷ token supply",
        ],
      },
    ],
    paragraphs: [
      "Because payments never leave the balance except through cash outs, loans, and the fees on them, the backing per token can only be moved by the rules: new issuance dilutes it, cash out taxes and loan fees add to it.",
      "Contributors get paid from the split share of newly issued tokens, so their upside is the same token everyone else holds. There is no payout budget for anyone to manage.",
    ],
  },
  {
    id: "three-prices",
    part: "The basics",
    title: "The three prices",
    summary:
      "A revnet token always has an issuance price, a cash out price, and, once a pool exists, a market price. They answer different questions.",
    points: [
      {
        key: "Issuance price",
        text: "what one new token costs when you pay the revnet. Set by the current stage. Acts as a ceiling: nobody pays more on the market than they would pay the revnet.",
      },
      {
        key: "Cash out price",
        text: "what the contracts return for burning one token right now. Set by the balance, the supply, and the cash out tax. Acts as a floor: nobody sells below it on the market.",
      },
      {
        key: "Market price",
        text: "what traders in the buyback pool quote right now. It lives between the other two, because stepping outside either bound hands someone an arbitrage.",
      },
    ],
    diagrams: [
      {
        label: "Where the market price can go",
        lines: [
          "  issuance price  ───────────────────────────  ceiling",
          "                     ▲ market price moves here",
          "  cash out price  ───────────────────────────  floor",
          "",
          "  above the ceiling → people pay the revnet instead of the pool",
          "  below the floor   → people cash out instead of selling",
        ],
      },
    ],
    paragraphs: [
      "The price chart on every revnet page draws all three. Read the gap between them: a wide gap means the market has room to move, a narrow one means the revnet's own terms are doing most of the pricing.",
    ],
  },
  {
    id: "stages",
    part: "The basics",
    title: "Stages",
    summary:
      "A revnet's rules change over time, but only along a schedule of stages that was written at launch. The current stage decides what happens now; the full list shows what happens later.",
    paragraphs: [
      "Each stage sets when it starts, how many tokens a payment issues, how fast that rate falls, what share of new tokens goes to splits, the cash out tax, and any tokens issued automatically when the stage begins.",
    ],
    diagrams: [
      {
        label: "Example schedule",
        lines: [
          "  STAGE 1  day 0      1,000 tokens per ETH, cut 10% every 30 days",
          "                      split 30% to contributors, cash out tax 20%",
          "",
          "  STAGE 2  day 365    rate carries over, cut 5% every 90 days",
          "                      split 10%, cash out tax 50%",
          "",
          "  STAGE 3  day 1,825  issuance stops",
          "                      split 0%, cash out tax 50%, forever",
        ],
      },
    ],
    points: [
      { key: "Start", text: "the timestamp the stage takes over from the previous one." },
      { key: "Issuance", text: "tokens issued per unit of the base currency paid." },
      {
        key: "Issuance cut",
        text: "a percentage the rate drops by on a fixed cadence, so earlier payers get more tokens for the same money.",
      },
      {
        key: "Split share",
        text: "the percent of every issuance that goes to the stage's split recipients rather than the payer.",
      },
      { key: "Cash out tax", text: "how much of a cash out stays behind for remaining holders." },
      {
        key: "Auto issuance",
        text: "a fixed number of tokens created for named recipients when the stage begins, without a payment.",
      },
    ],
    note: "Always read the whole schedule, not just today's rate. A generous first stage followed by a harsh second one is a real deal that should be judged as a whole.",
  },
  {
    id: "cash-out-tax",
    part: "Going deeper",
    title: "Cash outs and the cash out tax",
    summary:
      "Cashing out burns tokens for a share of the balance. The tax makes each cash out leave some value behind, which raises the backing of every token that stays.",
    paragraphs: [
      "With a 0% tax, burning 10% of the supply returns 10% of the balance. With a tax, the return curves down: the first tokens out of the door get less than their proportional share, and the difference stays in the revnet.",
    ],
    diagrams: [
      {
        label: "Worked example",
        lines: [
          "  balance 100 ETH, you hold 10% of the supply",
          "",
          "  tax  0%  → cash out returns 10.0 ETH",
          "  tax 20%  → cash out returns  8.2 ETH   (1.8 ETH stays)",
          "  tax 50%  → cash out returns  5.5 ETH   (4.5 ETH stays)",
          "  tax 80%  → cash out returns  2.8 ETH   (7.2 ETH stays)",
          "",
          "  returned = balance × share × ((1 − tax) + tax × share)",
        ],
      },
    ],
    points: [
      {
        key: "Small cash outs are cheaper than big ones",
        text: "the formula rewards leaving in pieces, and rewards everyone who stays.",
      },
      {
        key: "The tax is set per stage",
        text: "so a revnet can start liquid and become stickier as it matures, or the reverse.",
      },
      {
        key: "Fees",
        text: "cash outs from a stage with a tax above 0% pay the Juicebox protocol's 2.5% fee on the value returned, and a revnet fee on the tokens burned. Both fund the fee projects' own revnets, so fee payers receive their tokens.",
      },
    ],
  },
  {
    id: "splits-and-auto-issuance",
    part: "Going deeper",
    title: "Splits and auto issuance",
    summary:
      "A stage can route a fixed share of every issuance to contributors, partners, or other revnets. That share is how a revnet pays the people building it.",
    paragraphs: [
      "The split share is a percentage of each issuance, fixed per stage. If the share is 30%, a payment that issues 1,000 tokens sends 700 to the payer and 300 to the split recipients. The recipients get tokens, never the balance itself.",
      "The operator may be allowed to redirect who receives the split, but can never raise the percentage. Auto issuance is the other way tokens appear without a payment: a stated amount to stated recipients when a stage starts.",
    ],
    note: "Both mechanisms dilute holders, so both belong in any serious look at a revnet's supply. On a multichain revnet the split share is the same on every chain, but the recipients can differ chain by chain.",
  },
  {
    id: "markets-and-buybacks",
    part: "Going deeper",
    title: "Markets and buybacks",
    summary:
      "When a revnet has a pool, payments are routed to whichever is better for the payer: issuing new tokens or buying existing ones from the pool.",
    paragraphs: [
      "This is the buyback hook. If the market price dips below the issuance price, a payment buys from the pool instead of minting, and the split share is still honoured from what comes back. Payers always get at least the issuance rate.",
      "Someone who only wants the token, with no interest in funding the revnet, is better off buying directly from the pool, because a direct swap does not pay the split. Interfaces should route to the best price and say which route they took.",
    ],
    note: "No pool is guaranteed to exist, to have liquidity, or to be the best route. The price chart shows how much liquidity is pooled under the market price. If there is no pool, issuance and cash outs are the only ways in and out.",
  },
  {
    id: "loans",
    part: "Going deeper",
    title: "Loans",
    summary:
      "Holders who need cash can borrow against their tokens instead of cashing out. They keep their position and get liquidity now.",
    diagrams: [
      {
        label: "Loan lifecycle",
        lines: [
          "  borrow",
          "     └─▶ your tokens are burned as collateral",
          "     └─▶ the revnet sends you funds, minus fees",
          "     └─▶ you receive a loan NFT as your receipt",
          "",
          "  repay (any time inside 10 years)",
          "     └─▶ return the funds plus any time-based fee",
          "     └─▶ your collateral is minted back to you",
          "",
          "  expiry (after 10 years)",
          "     └─▶ the loan is written off, collateral stays burned",
          "     └─▶ remaining holders share the same balance with fewer tokens",
        ],
      },
    ],
    paragraphs: [
      "Borrowing costs three fees: the Juicebox protocol's 2.5%, a 1% revnet fee, and a prepaid fee the borrower picks between 2.5% and 50%. The prepaid fee buys a window during which repaying costs nothing extra; after that window the cost rises over time until the ten-year expiry. Because the collateral is burned when the loan opens and minted again when it closes, an unpaid loan simply ends with fewer tokens in circulation.",
      "At high cash out taxes a loan can be cheaper than cashing out, since the fee is smaller than the value the tax would leave behind. The loan is an NFT, so it can be transferred or sold.",
    ],
  },
  {
    id: "shops",
    part: "Going deeper",
    title: "Shops",
    summary:
      "A revnet can sell items. Buying one is a payment like any other: the money enters the balance and the buyer receives tokens alongside the item.",
    paragraphs: [
      "Items are organised into categories and can carry their own supply limits, prices, and transfer rules. They play no part in the revnet's economics beyond bringing in revenue.",
    ],
  },
  {
    id: "multichain",
    part: "Under the hood",
    title: "One revnet, many chains",
    summary:
      "A revnet can run on several Ethereum chains at once. Each chain has its own balance and token supply, running the same stage schedule in sync.",
    paragraphs: [
      "Payments and cash outs settle instantly on whichever chain they happen on. Holders can move tokens to another chain. The move cashes the tokens out of the source chain's own balance at a 0% tax and mints them on the destination, so the value that travels is the source chain's backing for those tokens.",
      "Cross-chain moves are asynchronous. A balance shown for the whole group can include value that is queued, in transit, or waiting to be claimed on the other side.",
    ],
  },
  {
    id: "operator",
    part: "Under the hood",
    title: "The operator",
    summary:
      "A revnet has no owner. It has an operator with a short, fixed list of powers granted at launch, and none of them touch the economics.",
    points: [
      {
        key: "Can",
        text: "update the name, description, and token metadata; redirect the precommitted split share; choose the buyback pool, its TWAP window, and the router terminal; manage sucker safety; and extend the revnet to new chains if the deployment allowed it. A revnet launched with a shop also lets the operator add items, set discounts, update item metadata, and mint.",
      },
      {
        key: "Cannot",
        text: "change issuance, cuts, cash out taxes, split percentages, or stage timing. Cannot withdraw the balance.",
      },
      { key: "Can hand over", text: "the role to another address, or to nobody." },
    ],
    note: "The contracts treat the zero address as no operator: launch with it, or hand the role to it later, and the revnet has no operator for good. This site's create flow uses 0xdead000000000000000000000000000000000000, an address nobody controls, for the same effect. An operator can also differ on each chain.",
  },
  {
    id: "built-on-juicebox",
    part: "Under the hood",
    title: "Built on Juicebox",
    summary:
      "Under the hood a revnet is a Juicebox V6 project owned by a contract that refuses to change the rules. Everything Juicebox can do, a revnet can do, minus the owner's discretion.",
    paragraphs: [
      "Juicebox supplies payments, tokens, rulesets, splits, cash outs, hooks, and cross-chain suckers. The Revnet contracts add the stage schedule, the cash out and loan economics, and the operator's limited permissions on top.",
      "If you want to understand rulesets, terminals, hooks, and fees at the protocol level, the Juicebox guide covers them in the same plain style.",
    ],
    links: [
      { href: "https://juicebox.money/learn", label: "Learn Juicebox" },
      { href: "https://github.com/rev-net/revnet-core-v6", label: "Revnet V6 source" },
      { href: "https://github.com/Bananapus/version-6", label: "Juicebox V6 source" },
    ],
  },
  {
    id: "verify-before-trusting",
    part: "Under the hood",
    title: "What to check before you trust one",
    summary:
      "Revnets follow a known set of rules, but each revnet chooses its own numbers, recipients, chains, and operator. Read them.",
    points: [
      {
        key: "Stages",
        text: "the full schedule, especially the stage after the one you are paying into.",
      },
      {
        key: "Splits and auto issuance",
        text: "who receives tokens without paying, and how much.",
      },
      { key: "Chains", text: "which chains it runs on and whether the numbers match across them." },
      {
        key: "Balance and supply",
        text: "what backs a token today, and how much of the supply is in loans.",
      },
      { key: "Operator", text: "who it is and what they were granted." },
      {
        key: "Pool",
        text: "whether there is one, how deep it is, and how far the market price sits from the floor and ceiling.",
      },
      {
        key: "The transaction",
        text: "that what your wallet is about to sign matches the call this site describes.",
      },
    ],
    paragraphs: [
      "All of it is open source and inspectable. That removes the need to trust an owner; it does not remove contract, market, bridge, oracle, or key-management risk. Those are borne by whoever uses the code.",
    ],
    links: [
      { href: "/audit", label: "Audit the contracts and this site" },
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
        title="How a revnet works"
        introduction="A revnet turns payments, token issuance, cash outs, loans, and markets into one public agreement that runs on a schedule and cannot be rewritten. Start at the top if you are new; jump to a section if you are checking one thing."
        sections={SECTIONS}
        afterIntroduction={
          <>
            <p className="text-base text-zinc-600">
              Revnets are built on Juicebox. The{" "}
              <Link
                href="https://juicebox.money/learn"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-melon-400 underline-offset-4"
              >
                Juicebox guide
              </Link>{" "}
              explains the protocol every revnet runs on.
            </p>
            <AgentSkillsNote skills={["revnet-economics", "revnet-modeler", "jb-revloans"]} />
          </>
        }
        companion={{
          href: "/build",
          label: "Build with revnets",
          description:
            "Turn these concepts into a launch configuration, a transaction map, and a product users can verify.",
        }}
      />
    </>
  );
}
