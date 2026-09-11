import { AgentSkillsNote } from "@/components/guides/AgentSkillsNote";
import { RevnetGuide, RevnetGuideSection } from "@/components/guides/RevnetGuide";
import { Nav } from "@/components/layout/Nav";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Learn revnets",
  description:
    "How revnets share revenue, what their tokens let you do, and which terms to check before taking part.",
  alternates: { canonical: "/learn" },
  openGraph: {
    title: "Learn revnets",
    description:
      "Understand payments, token terms, cash outs, and loans. Learn the basics or prepare your first revnet transaction.",
    url: "/learn",
    type: "website",
    images: [{ url: "/assets/img/revnet-social.png", width: 1428, height: 804, alt: "Revnet" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Learn revnets",
    description:
      "Understand payments, token terms, cash outs, and loans. Learn the basics or prepare your first revnet transaction.",
    images: ["/assets/img/revnet-social.png"],
  },
};

const SECTIONS: readonly RevnetGuideSection[] = [
  {
    id: "what-is-a-revnet",
    aliases: ["start-here"],
    part: "The basics",
    title: "What a revnet is",
    summary:
      "A revnet shares revenue through tokens. Its rules set how people receive tokens and how holders can return them for money or use them to borrow. The schedule is fixed when the revnet launches.",
    paragraphs: [
      "Customers and supporters pay the revnet. Their payment can create new tokens and add to its balance, or buy existing tokens from a market. Some tokens can go to contributors. The payment quote shows how many the payer receives and where the money goes.",
      "A revnet can appoint someone to manage details such as its name, contributor addresses, shop, and market settings. This role is called the operator. The operator cannot rewrite the token schedule or withdraw the balance for themselves. The allowed changes still matter, so check the role's powers.",
      "Revnets suit open source projects and businesses that want contributors and customers to share revenue under rules enforced by software.",
    ],
    links: [
      { href: "/discover", label: "Explore live revnets" },
      { href: "/build#when-to-use-a-revnet", label: "Decide whether a revnet fits your product" },
      { href: "#glossary", label: "Look up a term" },
    ],
  },
  {
    id: "how-money-flows",
    part: "The basics",
    title: "How money flows",
    summary:
      "People pay in, then use their tokens to take money out or borrow. Returning tokens for money is called cashing out. Buying through a market or shop can send funds elsewhere.",
    diagrams: [
      {
        label: "The loop",
        description:
          "A payment can create tokens and fund the balance, or buy existing tokens from a market. Some tokens can go to contributors. Cashing out destroys the returned tokens. Borrowing also destroys the tokens used to secure the loan, but repayment can restore them.",
        lines: [
          "  1. Someone PAYS the revnet",
          "     └─▶ create tokens for the payer and contributors",
          "     └─▶ money used to create tokens enters the balance",
          "     └─▶ or the money buys existing tokens from a market",
          "",
          "  2. Holders CASH OUT",
          "     └─▶ return tokens for money; those tokens are destroyed",
          "     └─▶ the rules decide how much stays for other holders",
          "",
          "  3. Or holders BORROW against tokens instead of cashing out",
          "",
          "  simple backing per token = balance ÷ total number of tokens",
          "  loans and other chains require additional accounting",
        ],
      },
    ],
    paragraphs: [
      "For a revnet on one network with no loans, divide its balance by the total number of tokens, called the supply. This gives a simple measure of the funds behind each token, called its backing. Loans and funds on other networks can change the calculation. Backing is not the amount you can withdraw right now.",
      "Creating tokens is called issuance. A payment that creates tokens adds both money and tokens, so backing per token can rise or fall. Tokens allocated without a payment add to supply without adding money. Cash outs can leave some money for remaining holders. Loans move money out until repayment or expiry changes the accounting.",
      "Contributors receive tokens. To get ETH, USDC, or another asset, they must cash out, borrow, or find a buyer under the same terms as other holders. The team cannot choose to withdraw a separate spending budget.",
    ],
  },
  {
    id: "three-prices",
    part: "The basics",
    title: "The three prices",
    summary:
      "You can buy newly created tokens, return tokens to the revnet, or trade existing tokens with others. Each has its own price. Compare current quotes for your amount and network.",
    points: [
      {
        key: "Issuance price",
        text: "what a newly created token costs. Any share set aside for contributors reduces the tokens the payer receives. When the rules create no new tokens, there is no price at which you can buy newly created ones.",
      },
      {
        key: "Cash out price",
        text: "what you receive by returning a given number of tokens to the revnet. The rules, total supply, backing, costs, and funds available on your network all affect the quote. The amount per token changes with the size of the cash out.",
      },
      {
        key: "Market price",
        text: "what other buyers and sellers offer. Trading can move the price, so a chart may differ from the amount you actually receive.",
      },
    ],
    diagrams: [
      {
        label: "Compare routes, then compare the final quote",
        description:
          "If new tokens cost less than existing ones, a buyer may prefer new tokens. If returning tokens pays more than selling them, a holder may prefer to cash out. Trading costs, limited funds, delays, and price changes can prevent either choice from being worthwhile.",
        lines: [
          "  BUY   compare newly created tokens with existing ones",
          "  SELL  compare returning tokens with selling them",
          "",
          "  compare the amount you receive after all costs",
          "  market prices can move beyond either reference price",
        ],
      },
    ],
    paragraphs: [
      "Charts may call the new-token price a ceiling and the cash out price a floor. Neither guarantees a market limit. Limited funds, costs, waiting periods, and price changes can keep trades outside those reference prices. Use the quote for the amount you intend to trade.",
    ],
  },
  {
    id: "stages",
    part: "The basics",
    title: "Stages",
    summary:
      "The rules can change over time along a schedule fixed at launch. Each period is called a stage. Read the whole schedule to see what applies now and later.",
    paragraphs: [
      "Each stage sets its start and token creation rate. A recurring drop in that rate is an issuance cut. The share for contributors is the split share. The setting that leaves money for remaining holders during a cash out is the cash out tax. Fixed tokens claimable without paying are auto issuance.",
    ],
    diagrams: [
      {
        label: "Example schedule",
        description:
          "Illustrative schedule: stage one starts on day zero, issues 1,000 tokens per ETH before a 30% split, cuts issuance by 10% every 30 days, and has a 20% cash out tax. Stage two starts on day 365, inherits the rate, cuts it by 5% every 90 days, and uses a 10% split and 50% tax. Stage three starts on day 1,825 with no new issuance and a 50% tax. The contracts determine each actual start time.",
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
      {
        key: "Start",
        text: "the earliest time a stage can begin. Check the actual start shown in Terms.",
      },
      { key: "Issuance", text: "new tokens created per unit of the currency used for pricing." },
      {
        key: "Issuance cut",
        text: "a recurring percentage drop in new tokens per payment, so earlier payers get more tokens for the same money.",
      },
      {
        key: "Split share",
        text: "the percentage of newly created tokens set aside for named recipients rather than the payer.",
      },
      {
        key: "Cash out tax",
        text: "a setting that leaves some money for remaining holders. Its effect depends on the share of tokens returned; it is not a flat deduction.",
      },
      {
        key: "Auto issuance",
        text: "a fixed number of tokens set aside for named recipients without a payment. Someone must submit a claim after the stage starts; time alone does not create the tokens.",
      },
    ],
    note: "Read later stages as carefully as the current one. Changes in token creation and cash out terms can affect your decision now.",
  },
  {
    id: "cash-out-tax",
    part: "Going deeper",
    title: "Cash outs and the cash out tax",
    summary:
      "When you return tokens for money from the revnet, those tokens are destroyed, or burned. The rules can leave some of your proportional share for remaining holders. The setting that controls this is called the cash out tax.",
    paragraphs: [
      "In the simplified example below, a 0% tax returns 10% of the balance for 10% of the supply. A 20% tax parameter returns 8.2 ETH, not 8 ETH: the formula also accounts for the share being cashed out. This example excludes fees, loans, remote balances, and market routing.",
    ],
    diagrams: [
      {
        label: "Worked example before fees",
        description:
          "With a balance of 100 ETH and a cash out of 10% of total supply, a 0% tax returns 10 ETH, 20% returns 8.2 ETH, 50% returns 5.5 ETH, and 80% returns 2.8 ETH, before fees. Multiply balance by the share, then by one minus the tax plus the tax times the share. Use 0.1 for a 10% share and 0.2 for a 20% tax.",
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
        key: "Size changes the effective tax",
        text: "for the same starting balance and supply, a larger share receives more per token. Splitting a withdrawal into smaller transactions does not create a discount; each transaction changes the state and adds gas costs.",
      },
      {
        key: "The tax is set per stage",
        text: "so later stages can leave more or less money for remaining holders.",
      },
    ],
    links: [
      {
        href: "https://github.com/Bananapus/nana-core-v6/blob/main/src/libraries/JBCashOuts.sol",
        label: "Cash out formula in the contracts",
      },
      { href: "/build#cash-out", label: "How an app quotes cash outs" },
      { href: "#fees", label: "Costs and where they go" },
    ],
  },
  {
    id: "splits-and-auto-issuance",
    part: "Going deeper",
    title: "Sharing tokens with contributors",
    summary:
      "A revnet can set aside part of each new token creation for contributors, partners, or other revnets. This portion is called the split share.",
    paragraphs: [
      "The split share is a percentage of each issuance, fixed per stage. If the share is 30%, a payment that issues 1,000 tokens sends 700 to the payer and 300 to the split recipients. The recipients get tokens, never the balance itself.",
      "The operator can change recipients once any locked allocations allow it, but cannot raise the share fixed at launch. A separate fixed token allocation, called auto issuance, can be claimed after its stage starts. Anyone can submit the claim; tokens still go to the named recipient.",
    ],
    note: "Both change who holds tokens. Payments that create tokens add money; auto issuance does not. Across networks the split percentage stays the same, but recipients can differ. Count unclaimed allocations when considering how your share of the supply may shrink.",
  },
  {
    id: "markets-and-buybacks",
    part: "Going deeper",
    title: "Markets and buybacks",
    summary:
      "People can put assets into a shared market for others to trade. This is called a liquidity pool. During a payment, a revnet can buy existing tokens there when it offers a better rate, or combine that purchase with newly created tokens.",
    paragraphs: [
      "The buyback hook is a contract called during a payment. Funds spent in the pool buy existing tokens from liquidity providers; they do not all enter the revnet's balance. The standard route applies the split share to the tokens obtained. Some integrations can opt out of splits on the purchased portion; newly minted tokens still follow the stage's split.",
      "Buying directly from a pool skips the revnet's payment path and split share, but it is not always the best deal. Compare the tokens you receive after all costs, including price movement caused by your trade. A shop purchase may require the payment path to receive the item.",
      "Cash outs can also use a configured pool when selling tokens there produces a better result. In that case the market supplies the funds; the treasury-only formula is not the complete quote. The confirmation should identify the route and enforce the minimum amount you accept.",
    ],
    note: "A pool may be absent or have too little liquidity for your amount. A displayed market price is not a promise of an executable trade. Check the live quote and its minimum output before signing.",
  },
  {
    id: "loans",
    part: "Going deeper",
    title: "Loans",
    summary:
      "A loan lets you borrow against your tokens and recover them by repaying. Tokens used to secure a loan are called collateral. They are destroyed while the loan is open, so you cannot also spend or cash them out.",
    diagrams: [
      {
        label: "Loan lifecycle",
        description:
          "Borrowing destroys the collateral tokens and sends you money after costs. You receive a transferable loan record, called a loan NFT, that controls repayment and recovery. Repay the recorded debt, called principal, and any added borrowing cost before the 3,650-day expiry to recover tokens. After expiry anyone can close the record, removing the debt and collateral from accounting. A market price drop cannot force an earlier repayment.",
        lines: [
          "  borrow",
          "     └─▶ your tokens are burned as collateral",
          "     └─▶ the revnet sends you funds, minus fees",
          "     └─▶ you receive a loan NFT as your receipt",
          "",
          "  repay (before the 3,650-day expiry)",
          "     └─▶ return principal plus any additional time-based fee",
          "     └─▶ your collateral tokens are created again for you",
          "",
          "  expiry (after 3,650 days)",
          "     └─▶ the loan is written off, collateral stays burned",
          "     └─▶ closing the expired loan removes debt and collateral from accounting",
        ],
      },
    ],
    paragraphs: [
      "The amount you can borrow uses the current cash out tax and the revnet's effective backing, then is capped by funds available on the selected chain. A loan does not bypass a high cash out tax. Compare net proceeds, repayment cost, and the token rights you want to recover.",
      "You receive less than the recorded debt because borrowing costs are paid up front. Repayment is based on the full debt plus any extra cost for how long you borrow. The Fees section explains each cost and where it goes.",
      "While a loan can be repaid, the calculation of backing includes the debt and the tokens that repayment can restore. After expiry, anyone can close the record to remove both. This does not add money or guarantee more backing per remaining token. Transferring the loan NFT gives its new owner control of the loan and the right to recover collateral.",
    ],
    links: [
      { href: "#fees", label: "Borrowing costs and where they go" },
      {
        href: "https://github.com/rev-net/revnet-core-v6/blob/main/src/REVLoans.sol",
        label: "Loan rules and fee calculation",
      },
      { href: "/build#operate-loans", label: "Integrate loan quotes and repayment" },
    ],
  },
  {
    id: "fees",
    part: "Going deeper",
    title: "Fees and where they go",
    summary:
      "Juicebox and Revnet fees support revnets that share their own tokens with the people paying them. A fee payment can give its named recipient tokens in those networks, under their current rules.",
    paragraphs: [
      "The Juicebox fee goes to the Juicebox Protocol revnet, whose token is JBP6. The Revnet fee goes to the Revnet Network revnet, whose token is REV. These tokens let holders participate under each revnet's terms. They are not a cash refund or a promise of profit.",
      "The cash out tax is different: it leaves money in the revnet you are cashing out of for its remaining holders. Loan borrowing costs can also pay that source revnet. Network transaction costs, market trades, card payments, and bridges can charge separately.",
    ],
    points: [
      {
        key: "Payments and launch",
        text: "a normal payment into a revnet has no standard Juicebox protocol fee. Launching a revnet uses the current project creation fee on each network. Check that live quote: its recipient and payment route determine whether it gives you tokens in a fee-receiving revnet.",
      },
      {
        key: "Cash outs",
        text: "the standard cash out from the revnet's balance with a positive cash out tax has a 2.5% Juicebox fee on the value withdrawn. The Revnet fee is calculated by valuing 2.5% of the tokens being cashed out. These use different bases, so they are not a flat 5% deduction. A market sale or an exempt route can differ. A 0% cash out tax removes the standard Revnet fee, but a Juicebox fee can still apply to funds received earlier through payouts that had not yet paid it.",
      },
      {
        key: "Loans",
        text: "a standard new loan deducts a 2.5% Juicebox fee, a 1% REV fee when that fee payment is available, and a chosen borrowing cost of 2.5–50% paid up front to the lending revnet. Exemptions can change the quote. The amount you receive is smaller than the recorded debt, which is the basis for repayment.",
      },
      {
        key: "Time to repay",
        text: "the prepaid borrowing cost buys a period with no added source-revnet cost: 2.5% covers 182.5 days; 50% covers all 3,650 days. After that period the extra cost rises until expiry. Repay before expiry to recover collateral.",
      },
      {
        key: "Who receives the tokens",
        text: "successful fee payments follow the receiving revnet's current token rules and chosen market route. For cash outs, JBP6 tokens go to the cash out recipient and REV tokens go to the holder returning tokens; those addresses can differ. For loans, fee-payment tokens go to the loan's named recipient. Check each payment's result instead of assuming a fixed number of tokens.",
      },
      {
        key: "What to compare",
        text: "use the live quote for the exact amount you receive, each cost, and the destination of each payment. For a loan, also check the full debt, repayment quote, and expiry. Do not subtract a flat percentage from a chart price.",
      },
    ],
    links: [
      { href: "/eth:1#project-top", label: "Juicebox Protocol revnet" },
      { href: "/eth:3#project-top", label: "Revnet Network revnet" },
      {
        href: "https://github.com/Bananapus/nana-core-v6/blob/main/src/JBMultiTerminal.sol",
        label: "Juicebox fee routing",
      },
      {
        href: "https://github.com/rev-net/revnet-core-v6/blob/main/src/REVOwner.sol",
        label: "Revnet cash out fees",
      },
      {
        href: "https://github.com/rev-net/revnet-core-v6/blob/main/src/REVLoans.sol",
        label: "Loan fees and recipients",
      },
    ],
  },
  {
    id: "shops",
    part: "Going deeper",
    title: "Shops",
    summary:
      "A revnet can sell items through a shop. A qualifying payment can give you revnet tokens plus a unique token recording the item, called an NFT. Check the price, available copies, and purchase terms.",
    paragraphs: [
      "Items are organised into categories and can have supply limits, prices, token splits, discounts, and transfer rules. Some shop configurations route part of an item payment to another recipient, so check the purchase breakdown. The operator may keep powers to change shop settings or mint items.",
      "An NFT is an on-chain record. Any promised physical item, service, access, delivery, or refund depends on the seller's stated terms; the token itself does not fulfil that promise. Read the item description and check the seller before buying.",
    ],
  },
  {
    id: "multichain",
    part: "Under the hood",
    title: "One revnet, many chains",
    summary:
      "A revnet can run on several blockchain networks, or chains, at once. Each has its own balance and tokens, with the same stage schedule.",
    paragraphs: [
      "Payments and cash outs execute on the selected chain once the transaction is included. Ordinary cash out and loan accounting may include remote balances and supply, depending on the launch configuration, but actual withdrawals are limited by local funds.",
      "A cross-chain move uses bridge contracts called suckers. They cash tokens out using the source chain's local backing without the normal cash out tax, move the corresponding funds, and allow tokens to be claimed on the destination. This is a separate registered bridge path, not a tax exemption on a holder's later cash out.",
      "A move between networks takes several steps. The total balance can include funds waiting to move, in transit, or ready to claim on the other side.",
      "Keep the source transaction and destination chain handy until the claim completes. A successful source transaction does not mean destination tokens are ready. Bridge messages, fees, and claim transactions can take additional time.",
    ],
  },
  {
    id: "operator",
    part: "Under the hood",
    title: "The operator",
    summary:
      "A contract called REVOwner owns the revnet and enforces its fixed schedule. A person or another contract can hold the operator role. Its powers are limited, but its choices about payments, recipients, and the shop still affect users.",
    points: [
      {
        key: "Can",
        text: "update names and descriptions; change contributor addresses; choose the payment contract, market pool, and the period used to average its price; manage bridge safety; and add networks if allowed at launch. With a shop, the role can also add items, set discounts, edit item details, and create copies.",
      },
      {
        key: "Cannot",
        text: "change issuance, cuts, cash out taxes, split percentages, or stage timing. Cannot withdraw the balance.",
      },
      { key: "Can hand over", text: "the role to another address, or to nobody." },
    ],
    note: "The zero address is the contract's explicit no-operator setting, and relinquishing to it is permanent. This site's create flow uses a dead address intended to be inaccessible when the operator is off. Inspect the actual address and permissions on every chain; do not infer control from an address label alone.",
  },
  {
    id: "built-on-juicebox",
    part: "Under the hood",
    title: "Built on Juicebox",
    summary:
      "A V6 revnet uses Juicebox's payment and token contracts with REVOwner as its project owner. It selects a constrained set of Juicebox features and removes the ordinary owner's ability to change the committed economic rules.",
    paragraphs: [
      "Juicebox supplies the contracts for payments, tokens, shared allocations, cash outs, and transfers between networks. Revnet adds the fixed stage schedule, its cash out and loan terms, and limited operator powers.",
      "The Juicebox guide explains these shared contracts and how projects use them.",
    ],
    links: [
      { href: "https://juicebox.money/learn", label: "Learn Juicebox" },
      { href: "https://github.com/rev-net/revnet-core-v6", label: "Revnet V6 source" },
      { href: "https://github.com/Bananapus/version-6", label: "Juicebox V6 source" },
    ],
  },
  {
    id: "your-first-transaction",
    aliases: ["verify-before-trusting"],
    part: "Try it",
    title: "Your first transaction",
    summary: "Choose a revnet, read its terms, and review the payment before signing.",
    points: [
      {
        key: "1. Choose the revnet",
        text: "Open Discover and check the revnet's network and project ID. In Terms, read every stage, who receives tokens, accepted assets, and the operator's powers. Check available funds and any open loans as well as the total balance.",
      },
      {
        key: "2. Choose the chain and amount",
        text: "Use an accepted asset on that network and leave enough for transaction costs. Moving money from another network is a separate action and may require a claim.",
      },
      {
        key: "3. Review what you receive",
        text: "Check the receiving address, contributor share, payment path, total cost, and minimum tokens you will accept. For a shop item, read the seller's delivery terms. Giving a contract spending permission is called approval; the payment may be a separate transaction. Check that the wallet request matches what you reviewed.",
      },
      {
        key: "4. Wait for confirmation",
        text: "Wait for the network to confirm the transaction. A proposal to a shared Safe wallet still needs to be executed. Keep the transaction link and check your holdings on that network if tokens do not appear.",
      },
      {
        key: "5. Plan your next action",
        text: "Use the holder controls to quote a cash out or loan. A zero quote can mean no available money, a waiting period after launch, or an unsupported payment path. Refresh the quote and check Terms before retrying. Do not accept less just to bypass an unexplained failure.",
      },
    ],
    note: "Fixed rules do not guarantee token value, revenue, a buyer for your tokens, or delivery of a team's promises. Check the contracts, operator powers, and any markets or bridges your payment depends on.",
    links: [
      { href: "/discover", label: "Find a revnet to explore" },
      { href: "/audit", label: "Review contract and website audits" },
      {
        href: "https://juicebox.money/build/first-payment",
        label: "Try a payment on a test network",
      },
      { href: "/build#draft-files", label: "Save a launch draft before deploying" },
    ],
  },
  {
    id: "glossary",
    part: "Reference",
    title: "Words used in this guide",
    summary: "Start with the idea, then use the name when you need it.",
    points: [
      {
        key: "Token",
        text: "a unit recorded for its holder. Revnet tokens let holders take part under the revnet's rules; they do not automatically mean company ownership.",
      },
      { key: "Balance / treasury", text: "the money held for a revnet by its payment contracts." },
      {
        key: "Chain",
        text: "a blockchain network, such as Ethereum or Base. Each keeps its own transaction records and balances.",
      },
      {
        key: "Supply",
        text: "the total number of tokens. For some calculations, tokens tied to open loans also count.",
      },
      {
        key: "Issuance / mint",
        text: "creating tokens. Mint is the contract term for creating them on a blockchain.",
      },
      {
        key: "Burn",
        text: "destroying tokens. A loan can restore its burned collateral only through the allowed recovery steps.",
      },
      {
        key: "Split share",
        text: "the percentage of newly created tokens set aside for named recipients rather than the payer.",
      },
      {
        key: "Auto issuance",
        text: "a fixed number of tokens set aside for someone without a payment. It can be claimed after a stage starts.",
      },
      {
        key: "Stage / ruleset",
        text: "a scheduled set of token and cash out rules. Juicebox calls the underlying settings a ruleset.",
      },
      {
        key: "Cash out",
        text: "return tokens for money under a revnet's rules. The quote can use its balance or a market sale.",
      },
      {
        key: "Cash out tax",
        text: "the setting that leaves part of a proportional withdrawal for remaining holders. The effect depends on how much of the supply is returned. It is not a government tax.",
      },
      {
        key: "Backing",
        text: "the funds counted behind tokens. Loans and other networks can be included, so backing can differ from money available to withdraw now.",
      },
      {
        key: "Pool / liquidity",
        text: "a shared market holding assets for trades, and the funds available for those trades.",
      },
      {
        key: "Slippage / minimum output",
        text: "the difference between a quoted trade and its actual result, and the smallest amount you agree to receive.",
      },
      {
        key: "Collateral",
        text: "tokens used to secure a loan. They are destroyed while the loan is open and can be restored through repayment.",
      },
      {
        key: "Principal",
        text: "the recorded loan debt before borrowing costs are deducted from the amount you receive.",
      },
      {
        key: "NFT / loan NFT",
        text: "a unique token. A loan NFT is the transferable record that controls a loan and recovery of its collateral.",
      },
      {
        key: "Liquidation",
        text: "closing an expired loan so its debt and collateral no longer count. Revnet loans do not face early liquidation because a market price falls.",
      },
      {
        key: "Operator",
        text: "the person or contract allowed to manage some revnet settings. It cannot rewrite the fixed token schedule or withdraw the balance.",
      },
      {
        key: "Credits / ERC-20",
        text: "two ways to record a token balance. Credits work inside Juicebox. Claiming converts them into the standard tokens that compatible wallets and markets use, called ERC-20 tokens; it does not give you extra tokens.",
      },
      { key: "Terminal", text: "a contract that accepts payments and handles withdrawals." },
      {
        key: "Hook / buyback hook",
        text: "a contract called during another action to change its result. A buyback hook can use a market instead of creating tokens or paying from the revnet's balance.",
      },
      {
        key: "Bridge / sucker",
        text: "a system for moving assets between networks. Juicebox calls its bridge contracts suckers.",
      },
      { key: "Gas", text: "the network cost of processing a transaction." },
      {
        key: "Approval",
        text: "permission for a contract to spend a specified token amount. Approval alone does not pay the revnet.",
      },
      {
        key: "TWAP",
        text: "time-weighted average price: a trading price averaged over a period. It helps compare payment paths. The current buyback hook creates tokens if a swap cannot meet this price floor; previous hooks can revert instead.",
      },
      {
        key: "Router gateway",
        text: "a payment entry selected by the revnet’s router registry on networks that have upgraded. It holds funds before routing them. Some failed protocol fee payments remain held for retry, or return to the source revnet after repeated failures; a held fee is still owed.",
      },
      {
        key: "Beneficiary",
        text: "the address named to receive tokens, money, or recovered collateral.",
      },
      {
        key: "SDK / ABI",
        text: "a software kit for working with the contracts, and the description of a contract's callable functions and data types.",
      },
      {
        key: "Indexer / RPC",
        text: "a service that organizes blockchain records for searching, and a connection an app uses to read a network or send a transaction.",
      },
      {
        key: "Metadata / IPFS",
        text: "details such as a name, description, and logo, and a system for storing those files by their contents.",
      },
    ],
    links: [{ href: "#fees", label: "Fees and where they go" }],
  },
];

export default function LearnPage() {
  return (
    <>
      <Nav />
      <RevnetGuide
        eyebrow="Learn"
        title="How a revnet works"
        introduction="Understand where your money goes, what tokens let you do, and which rules are fixed at launch."
        sections={SECTIONS}
        afterIntroduction={
          <>
            <nav aria-label="Choose a learning path" className="flex flex-wrap gap-3">
              {[
                { href: "#what-is-a-revnet", label: "Learn the basics" },
                { href: "#your-first-transaction", label: "Use a revnet" },
                { href: "#glossary", label: "Look up a term" },
                { href: "/build#launch-from-the-wizard", label: "Launch without code" },
              ].map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="inline-flex min-h-11 items-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 underline decoration-melon-400 underline-offset-4 hover:border-melon-500 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900"
                >
                  {label}
                </Link>
              ))}
            </nav>
            <p className="text-base text-zinc-600">
              Revnets are built on Juicebox. The{" "}
              <Link
                href="https://juicebox.money/learn"
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
          description: "Choose your rules, launch a revnet, or connect an app.",
        }}
      />
    </>
  );
}
