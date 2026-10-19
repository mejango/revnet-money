import { AgentSkillsNote } from "@/components/guides/AgentSkillsNote";
import { CopyRevnetBuildPrompt } from "@/components/guides/CopyRevnetBuildPrompt";
import { RevnetGuide, RevnetGuideSection } from "@/components/guides/RevnetGuide";
import { Nav } from "@/components/layout/Nav";
import type { Metadata } from "next";
import Link from "next/link";

const DESCRIPTION =
  "Launch a revnet without code, connect an app, or write a contract integration. Covers stages, splits, loans, and the operator; shared Juicebox topics link to the Juicebox build guide.";

export const metadata: Metadata = {
  title: "Build with revnets",
  description: DESCRIPTION,
  alternates: { canonical: "/build" },
  openGraph: {
    title: "Build with revnets",
    description: DESCRIPTION,
    url: "/build",
    type: "website",
    images: [{ url: "/assets/img/revnet-social.png", width: 1428, height: 804, alt: "Revnet" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Build with revnets",
    description: DESCRIPTION,
    images: ["/assets/img/revnet-social.png"],
  },
};

const REFERENCE_ROOT = "https://github.com/mejango/revnet-money/blob/main";
const REV_CORE = "https://github.com/rev-net/revnet-core-v6/blob/main/src";
const NANA_CORE = "https://github.com/Bananapus/nana-core-v6/blob/main/src";
const SKILLS = "https://github.com/mejango/juicebox-skills/tree/main/plugins/juicebox-v6/skills";
const JB_BUILD = "https://juicebox.money/build";

const SECTIONS: readonly RevnetGuideSection[] = [
  // ------------------------------------------------------------------ Start here
  {
    id: "when-to-use-a-revnet",
    part: "Start here",
    title: "When to use a revnet",
    summary:
      "Use a revnet for tokenized incentives backed by a balance sheet, on a schedule fixed at launch. Use a Juicebox project when a team needs payouts or the power to change the rules later.",
    compare: {
      label: "Pick the model",
      columns: ["You need to", "Use"],
      rows: [
        ["Pay contributors in tokens on a published schedule", "Revnet"],
        ["Let holders cash out or borrow against the balance sheet", "Revnet"],
        ["Commit to terms nobody can change after launch", "Revnet"],
        ["Pay a team a budget each month", "Juicebox project"],
        ["Change the rules after launch", "Juicebox project"],
      ],
    },
    paragraphs: [
      "A contract owns every revnet and enforces its schedule. The operator can change details: contributor addresses, payment routes, names, bridges, and the shop.",
      "Project builders can launch with an AI assistant or the launch form, without code. App builders use the SDK, a TypeScript library, and Bendystraw, an index of onchain records. Contract builders write Solidity.",
    ],
    links: [
      { href: "/learn", label: "How a revnet works" },
      { href: "#launch-with-an-agent", label: "Launch a revnet" },
      { href: "#shared-with-juicebox", label: "Connect an app" },
      { href: "#extension-points", label: "Build a contract integration" },
      { href: "#words-for-builders", label: "Words for builders" },
    ],
  },

  // ------------------------------------------------------------------ Project builders
  {
    id: "launch-with-an-agent",
    aliases: ["draft-files"],
    part: "Project builders",
    audience: ["founders"],
    title: "Launch with an AI assistant",
    summary:
      "Describe the revnet to an assistant and let it do the setup. You review what it prepared and sign.",
    paragraphs: [
      "Connect it to the Juicebox MCP at https://juicebox.center/mcp. It reads revnets, models stages with you, pins the name and logo to IPFS once you approve the upload, and prepares the exact deployFor transaction for each chain. It holds no keys and signs nothing.",
      "Or have it write a .jb draft. A .jb file is JSON: the launch form's fields in the units you see on screen (days, percentages from 0 to 100, whole token amounts). Import it at the top of the launch form, check every section, and launch from there. Every live revnet's Extras tab exports one rebuilt from the chain, the easiest way to compare what launched with what you meant.",
    ],
    points: [
      {
        key: "Limits",
        text: "up to 32 stages, 16 chains, 64 store items, 2 MB. Media cannot travel inside JSON; item images arrive as already-pinned ipfs:// URIs.",
      },
      {
        key: "Skills",
        text: "jb-deploy-ui for launch interfaces; revnet-economics and revnet-modeler for exploring terms. Check a generated draft against the current schema.",
      },
    ],
    links: [
      { href: "https://juicebox.center/mcp", label: "Juicebox MCP" },
      { href: `${REFERENCE_ROOT}/src/lib/revnet-draft.ts`, label: "Draft format" },
      { href: `${REFERENCE_ROOT}/src/app/create/types.ts`, label: "Every field" },
      { href: `${SKILLS}/jb-deploy-ui/SKILL.md`, label: "Launch interface skill" },
    ],
  },
  {
    id: "launch-without-code",
    aliases: ["launch-from-the-wizard"],
    part: "Project builders",
    audience: ["founders"],
    title: "Launch without code",
    summary:
      "The launch form has six sections. Save a draft, review the full schedule, then connect a wallet to launch. Check the launch cost on every selected network before signing.",
    table: {
      label: "The six sections",
      rows: [
        [
          "1. Look",
          "Name (up to 50 characters), token symbol (2–10), logo, description, and optional links. At launch these are pinned to IPFS as one file.",
        ],
        [
          "2. Money and chains",
          "What the revnet holds: ETH, USDC, both, or another token checked on each network. The currency that prices new tokens: ETH or USD. Then the networks.",
        ],
        [
          "3. Terms",
          "Issuance, issuance cuts, the split, the cash out tax, auto issuance, and stage starts. The schedule is fixed at launch; the operator can still change split recipients.",
        ],
        [
          "4. Store",
          "Optional items to sell, a pricing currency, and which shop powers the operator keeps. A shop contract deploys even with no items.",
        ],
        [
          "5. Operator",
          "Off by default: the role goes to an unusable dead address. On: one address for all chains, or one per chain. Confirm you control each address, especially a multisig on a new chain.",
        ],
        [
          "6. Deploy",
          "Refresh the quote, review, then sign. On one network, send a transaction or propose it to a Safe. On several, pay once on one network for a bundle that launches on all of them.",
        ],
      ],
    },
    paragraphs: [
      "Issuance is the tokens created per ETH or USD paid; later stages can inherit it. An issuance cut lowers it on a schedule (default 10% every 30 days). The cash out tax sets how much of a cash out stays behind (the form offers 0–80% in steps of 5, default 20%; contracts allow anything below 100%). The split sends a share of new tokens to contributors. On Juicebox the same idea is called reserved tokens, and the contract field is splitPercent. Auto issuance sets aside fixed amounts to claim without paying.",
    ],
    note: "Stage starts must increase, a split above 0% needs a recipient, and issuance cuts should be at least a day apart. The form sets the first start ten minutes after you prepare the launch; you can pick a later time. If the launch executes after that start, cash outs and loans lock for seven days.",
    links: [
      { href: "/create", label: "Open the launch form" },
      { href: "/learn#stages", label: "Stages in plain language" },
      {
        href: `${REFERENCE_ROOT}/src/app/create/helpers/parseDeployData.ts`,
        label: "How the form becomes a deployFor call",
      },
    ],
  },
  {
    id: "what-deploy-does",
    part: "Project builders",
    audience: ["founders", "frontend"],
    title: "What happens when you deploy",
    summary:
      "The launch form prepares a deployFor call for each selected chain with matching terms and salts. Each chain gets its own project ID and completes on its own, even when the token address matches.",
    points: [
      {
        key: "Creation fee",
        text: "read JBProjects.creationFee() on each chain right before preparing the launch, and show it apart from network and relay costs.",
      },
      {
        key: "Token",
        text: "an ERC-20 named after the revnet, with its ticker. Chains share a token address when the deployer, sender, configuration hash, and salts match; check the address on each chain.",
      },
      {
        key: "Pool",
        text: "a Uniswap V4 pool per accepted token, opened empty at the issuance price with a 1% fee tier and 200 tick spacing. The buyback hook turns the deployer's 172800-second placeholder into a 30-minute TWAP window; twapWindowOf returns the live value.",
      },
      {
        key: "Chains",
        text: "with two or more chains, pay for one bundle. Each chain completes on its own schedule, so track them separately. With one chain, send a wallet transaction or a Safe proposal.",
      },
      {
        key: "Afterwards",
        text: "each chain has its own project ID; the page lives at /<chain>:<id>. The Terms tab shows the schedule as the contracts hold it.",
      },
    ],
    note: "Safe owners: a proposal that executes after the first stage's start triggers the seven-day cash out and loan lock. Leave a buffer, or set a later start.",
  },
  {
    id: "running-a-revnet",
    aliases: ["money-in-and-out"],
    part: "Project builders",
    audience: ["founders"],
    title: "Running it: what the operator can do",
    summary:
      "The operator has nine default permissions plus any granted at launch. The Operator tab shows the available actions; check grants per chain, since routing, recipients, and shop choices affect holders.",
    table: {
      label: "Operator tab",
      rows: [
        [
          "Edits",
          "Name, description, logo, links; an ENS handle; the recipients of the current stage's split (never its size)",
        ],
        [
          "Chains",
          "Extend the revnet to a new chain with the same terms, if the stage allows it (the launch form always allows it)",
        ],
        [
          "Buyback router",
          "Point at a buyback hook, select the router gateway through the registry where deployed, set the TWAP window (5 minutes to 2 days), or initialize a pool by hand if someone front-ran the automatic one",
        ],
        [
          "Shop",
          "Add items (media pinned to IPFS) and mint up to 50 free copies of an item. Removing items and editing discounts are contract powers this site does not expose yet",
        ],
        ["Account", "Hand the role to another address, or to the zero address to end it"],
        [
          "Permissions",
          "A read-only view of what is granted, flagging grants that no longer authorize anything",
        ],
      ],
    },
    paragraphs: [
      "Collect auto issuance from Owners. Holders use the You card to cash out, borrow, move between networks, or claim their tokens as ERC-20s. Card and bank payments buy an accepted token first.",
      "Liquidity lives under Owners → Market. Anyone can add liquidity to the pool through Uniswap V4's position manager, single-sided if they like. The site shows the pool's composition, depth by price band, and every position.",
      "The operator cannot change issuance, cuts, cash out taxes, split percentages, or stage timing, and cannot withdraw the balance. There is no owner key: REVOwner holds the project NFT and never transfers it.",
    ],
    links: [
      { href: `${REV_CORE}/REVOwner.sol`, label: "REVOwner.sol" },
      { href: "/learn#how-money-flows", label: "Where payments and cash outs go" },
      { href: "/learn#fees", label: "Fees" },
    ],
  },
  {
    id: "choosing-the-numbers",
    part: "Project builders",
    audience: ["founders"],
    title: "Choosing the numbers",
    summary:
      "Model the whole schedule before launch. Compare outcomes under realistic revenue, holder concentration, and withdrawal scenarios; no single tax or cut is safe for every revnet.",
    points: [
      {
        key: "Issuance and cuts",
        text: "simulate low and high revenue as issuance falls. Show the tokens a payer receives after the split, and check every stage change. A shorter cadence makes timing matter more; keep cuts at least a day apart.",
      },
      {
        key: "Cash out tax",
        text: "compare exits at several shares of supply. A higher tax keeps more of each cash out for remaining holders. Loans use the same tax, so borrowing does not get around it.",
      },
      {
        key: "Split",
        text: "stepping down across stages (30% → 20% → 10%) pays early contributors more, with no vote needed later.",
      },
      {
        key: "Stages",
        text: "match starts to real product milestones and model payments that land around a stage change. The final stage runs forever, cuts included. Zero issuance stops minting from payments; auto issuance can still be claimed.",
      },
      {
        key: "Concentration",
        text: "test large holders exiting, auto issuance claims, heavy borrowing, and empty local balances. Open loans count in both supply and backing.",
      },
    ],
    links: [
      { href: `${SKILLS}/revnet-economics/SKILL.md`, label: "revnet-economics skill" },
      { href: `${SKILLS}/revnet-modeler/SKILL.md`, label: "revnet-modeler skill" },
      { href: "https://github.com/mejango/rev-sim", label: "rev-sim (simulator)" },
      { href: "/learn#three-prices", label: "First: the three prices" },
    ],
  },

  // ------------------------------------------------------------------ App builders
  {
    id: "shared-with-juicebox",
    aliases: [
      "set-up",
      "indexed-data",
      "accept-payments",
      "cash-out",
      "move-across-chains",
      "wallets-safe-relayr",
      "metadata-and-ipfs",
      "transaction-boundary",
      "run-this-site",
      "hook-interfaces",
      "test-contracts",
    ],
    part: "App builders",
    audience: ["frontend", "contracts"],
    title: "Shared with every Juicebox project",
    summary:
      "Revnets run on Juicebox contracts, so most app work is the same as for any Juicebox project. The Juicebox build guide covers it; this guide covers what only revnets have.",
    paragraphs: [
      "Start with the SDK, reads, and the review flow there, then come back for stages, loans, and the operator. Two revnet differences apply throughout: a direct pool swap pays no split, and a registered bridge contract cashes out without the tax or the launch lock.",
    ],
    links: [
      { href: `${JB_BUILD}/first-payment`, label: "Your first test payment" },
      {
        href: `${JB_BUILD}#apps-juicebox-center`,
        label: "Juicebox Center: RPC, IPFS, and indexed data",
      },
      { href: `${JB_BUILD}#apps-set-up-the-sdk`, label: "Set up the SDK" },
      { href: `${JB_BUILD}#apps-read-a-project`, label: "Read a project" },
      { href: `${JB_BUILD}#apps-indexed-data`, label: "Search indexed data with Bendystraw" },
      { href: `${JB_BUILD}#apps-accept-payments`, label: "Accept payments" },
      { href: `${JB_BUILD}#apps-cash-out`, label: "Quote and send cash outs" },
      { href: `${JB_BUILD}#apps-move-across-chains`, label: "Move tokens across chains" },
      { href: `${JB_BUILD}#apps-wallets-safe-relayr`, label: "Wallets, Safes, and bundles" },
      { href: `${JB_BUILD}#apps-metadata-and-ipfs`, label: "Names, descriptions, and media" },
      { href: `${JB_BUILD}#apps-transaction-boundary`, label: "Review, send, and confirm" },
      { href: `${JB_BUILD}#contracts-hook-mechanics`, label: "Hooks" },
      { href: `${JB_BUILD}#contracts-test`, label: "Test against deployed contracts" },
      { href: `${JB_BUILD}#contracts-sharp-edges`, label: "Behavior every project shares" },
    ],
  },
  {
    id: "operation-map",
    part: "App builders",
    audience: ["frontend", "contracts"],
    title: "Every operation, in one table",
    summary:
      "The contract call and SDK builder behind each action. Some need a token approval, a chosen route, or several transactions.",
    table: {
      label: "User action → contract call",
      rows: [
        ["Launch a revnet", "REVDeployer.deployFor (buildDeployRevnetTx)"],
        ["Pay / buy tokens", "JBMultiTerminal.pay (buildPayTx)"],
        ["Buy a shop item", "JBMultiTerminal.pay with 721 metadata (build721PayMetadata)"],
        ["Add funds, no tokens", "JBMultiTerminal.addToBalanceOf"],
        ["Cash out", "JBMultiTerminal.cashOutTokensOf (prepareHookAwareCashOut)"],
        ["Claim credits as ERC-20", "JBController.claimTokensFor (buildClaimTokensTx)"],
        ["Collect auto issuance", "REVOwner.autoIssueFor (buildAutoIssueTx)"],
        ["Borrow", "REVLoans.borrowFrom (buildBorrowTx)"],
        ["Repay", "REVLoans.repayLoan (buildRepayLoanTx)"],
        [
          "Move a loan's collateral",
          "REVLoans.reallocateCollateralFromLoan (buildReallocateCollateralTx)",
        ],
        ["Move tokens to another chain", "sucker.prepare → toRemote → claim"],
        ["Trade on the pool directly", "Uniswap V4 Universal Router (buildDirectPaySwapTx)"],
        ["Add pool liquidity", "Uniswap V4 PositionManager.modifyLiquidities"],
        ["Operator: rename, redirect splits", "JBController.setUriOf / setSplitGroupsOf"],
        ["Operator: manage shop", "JB721TiersHook.adjustTiers / mintFor"],
        ["Operator: set up the pool", "JBBuybackHookRegistry.initializePoolFor / setHookFor"],
        ["Operator: add a chain", "REVDeployer.deploySuckersFor"],
        ["Operator: hand over", "REVOwner.setOperatorOf"],
      ],
    },
    paragraphs: [
      "Amounts stay bigint in the token's own decimals until display. A revnet is identified by chain ID plus project ID. A sucker group links its chains, but their addresses, balances, and stage IDs are never interchangeable.",
    ],
  },
  {
    id: "the-pieces",
    part: "App builders",
    audience: ["frontend", "contracts"],
    title: "The contracts, and where their addresses live",
    summary:
      "A revnet combines shared Juicebox contracts with its own token, shop, and bridges. Start from the deployment artifacts, then resolve the project's live addresses on each chain.",
    table: {
      label: "Who does what",
      rows: [
        ["REVDeployer", "Writes the stage schedule and the bridges at launch; adds chains later"],
        ["REVOwner", "Owns the project, enforces its rules, and holds the operator's permissions"],
        ["REVLoans", "Lends against revnet tokens; each loan is an NFT"],
        ["JBMultiTerminal", "Takes payments, holds the balance, runs cash outs"],
        ["JBController", "Issues tokens, distributes the split, holds the stage data"],
        [
          "JBBuybackHookRegistry + JBBuybackHook",
          "Buys from the Uniswap V4 pool when it gives more tokens than issuance",
        ],
        ["JB721TiersHook", "The shop: tiers, prices, media"],
        ["JBSucker + JBSuckerRegistry", "Moves tokens and balance between chains"],
        [
          "JBRouterTerminalRegistry",
          "Accepts tokens the revnet does not hold directly and swaps them in",
        ],
      ],
    },
    points: [
      {
        key: "Addresses",
        text: "deploy-all-v6 publishes one artifact per contract per chain (address, ABI, source name) under deployments/<chain>/. The SDK's jbContractAddress map and the skills library's chain-config.json come from it.",
      },
      {
        key: "Chains",
        text: "Ethereum, Optimism, Base, Arbitrum, plus Sepolia and the three L2 Sepolias. The SDK's SUPPORTED_CHAINS and JB_CHAINS carry the list.",
      },
      {
        key: "Source",
        text: "the -v6 repos are current; earlier Juicebox versions are not interchangeable with them.",
      },
    ],
    links: [
      { href: "https://github.com/Bananapus/deploy-all-v6", label: "deploy-all-v6 (addresses)" },
      { href: "https://github.com/rev-net/revnet-core-v6", label: "revnet-core-v6" },
      { href: "https://github.com/Bananapus/nana-core-v6", label: "nana-core-v6" },
      { href: "https://github.com/Bananapus/version-6", label: "Every V6 repo" },
    ],
  },
  {
    id: "read-the-revnet",
    part: "App builders",
    audience: ["frontend"],
    title: "Read the revnet",
    summary:
      "Read a revnet like any Juicebox project, plus its stages, loans, and operator. Use the index to display; read the chain for anything a signature depends on, right before signing.",
    table: {
      label: "Revnet reads",
      rows: [
        ["Current and next stage", "JBController.currentRulesetOf / upcomingRulesetOf"],
        ["Full schedule", "JBController.allRulesetsOf(projectId, startingId, size)"],
        [
          "Supply with loans",
          "JBController.totalTokenSupplyWithReservedTokensOf; REVLoans.totalCollateralOf / totalBorrowedFrom",
        ],
        ["Loan capacity", "REVLoans.borrowableAmountFrom / loanOf"],
        ["Chains", "JBSuckerRegistry.suckerPairsOf"],
        [
          "Operator",
          "A JBPermissions grant scoped to (REVOwner, revnetId): JBPermissions.hasPermissions, or the SDK's isRevnetOperator",
        ],
      ],
    },
    paragraphs: [
      "Stages are Juicebox rulesets. Backing counts open loans: while a loan can be repaid, its debt and the collateral repayment would restore both count. After 3,650 days anyone can liquidate it, which removes both.",
    ],
    links: [
      {
        href: `${REFERENCE_ROOT}/src/app/%5Bslug%5D/terms/getRulesets.ts`,
        label: "Stage reads",
      },
      { href: `${JB_BUILD}#apps-read-a-project`, label: "Read any Juicebox project" },
    ],
    note: "Treat state you could not read as unknown, never as zero, empty, or permitted.",
  },
  {
    id: "operate-loans",
    part: "App builders",
    audience: ["frontend"],
    title: "Loans",
    summary:
      "Calculate loan limits from current funds, collateral, costs, the borrowed asset, and permissions. A saved cash out estimate is not enough.",
    paragraphs: [
      "Before borrowing, read borrowableAmountFrom for the selected asset. borrowableNow limits the debt to available funds; borrowableCapacity measures what the collateral supports and can be larger. minBorrowAmount protects the debt before costs, not the money received. Show both the debt and the amount the borrower receives, with each cost.",
      "A holder borrowing for themselves needs no permission. A contract or operator borrowing for a holder needs OPEN_LOAN (37) from that holder. Collateral and source token are chain-local. Loan permissions can redirect funds or recovered collateral, so explain the exact authority before asking for a grant.",
      "Before repaying, re-read loanOf and the source fee, compute a ceiling with margin, approve or permit the source token if needed, and simulate the exact collateral returned. Native repayment sends the ceiling as value; the excess is refunded.",
    ],
    codePoints: [
      {
        title: "REVLoans.borrowFrom",
        details: [
          { key: "Quote", value: "getBorrowableAmount / borrowableAmountFrom" },
          { key: "Builder", value: "buildBorrowTx" },
          {
            key: "Permission",
            value: "OPEN_LOAN = 37 (REPAY_LOAN = 39, REALLOCATE_LOAN = 38 for the other calls)",
          },
          {
            key: "Bound",
            value: "minBorrowAmount protects the debt; calculate the amount received separately",
          },
        ],
        code: [
          "const { borrowableNow } = await getBorrowableAmount(publicClient, {",
          "  chainId, revnetId, collateralCount, decimals, currency,",
          "});",
          'if (borrowableNow <= 0n) throw new Error("No funds available to borrow for this collateral");',
          "",
          "const tx = buildBorrowTx({",
          "  chainId, revnetId, token, collateralCount, beneficiary, holder,",
          "  prepaidFeePercent,            // 25–500 (2.5%–50%, out of 1000)",
          "  minBorrowAmount: slippageFloor(borrowableNow, 100n), // debt, 1% tolerance",
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
            value: "collateralCountToReturn; mints a replacement loan NFT",
          },
          { key: "ERC-20", value: "prior approval, or a Permit2 allowance passed in the call" },
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
    part: "App builders",
    audience: ["frontend"],
    title: "Operator actions",
    summary:
      "Expose only the actions the launch granted, resolved per chain. An operator is never an owner.",
    paragraphs: [
      "Build each write from freshly resolved contracts, operator address, permission IDs, and project state, and simulate each chain on its own. A Safe proposal is pending until it executes; do not show success at proposal time.",
      "Shop tiers sit outside the stage schedule. Whether NFT transfers are paused is a per-stage flag fixed at launch (build721RulesetMetadata). Whether the operator can add tiers, update metadata, change discounts, or mint depends on the hook's flags and the permissions granted at launch.",
    ],
    table: {
      label: "Operator write map",
      rows: [
        ["Metadata", "JBController.setUriOf"],
        ["Split recipients", "JBController.setSplitGroupsOf"],
        ["Transfer role", "REVOwner.setOperatorOf"],
        ["Add shop tiers", "JB721TiersHook.adjustTiers"],
        ["Operator mint", "JB721TiersHook.mintFor"],
        ["Buyback hook", "JBBuybackHookRegistry.setHookFor"],
        ["Router gateway / terminal", "JBRouterTerminalRegistry.setTerminalFor"],
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
      },
    ],
    note: "To give up the role, pass address(0); that is permanent. The launch form's off setting uses a dead address instead, which nobody controls but is not the zero address. Show the actual value and read permissions rather than trusting a label.",
  },

  // ------------------------------------------------------------------ Contract builders
  {
    id: "extension-points",
    part: "Contract builders",
    audience: ["contracts"],
    title: "What you can plug in, and what you cannot",
    summary:
      "REVOwner fixes a revnet's pay and cash out paths. You extend a revnet around those paths, not inside them.",
    paragraphs: [
      "REVOwner is hard-wired as the project's ruleset data hook. On a payment it asks the revnet's 721 hook for its one tier split, then asks the buyback hook whether the pool is the better route, and returns at most those two specifications. On a cash out it returns the buyback specification, if any, and its own fee specification. deployFor has no field for a third-party hook, and hasMintPermissionFor answers yes only to REVLoans, the buyback hook, and registered suckers.",
    ],
    compare: {
      label: "Extension points",
      columns: ["You can", "You cannot"],
      rows: [
        [
          "Route the split to a split hook contract (IJBSplitHook)",
          "Install a custom data hook, pay hook, or cash out hook",
        ],
        [
          "Ship shop tiers with a custom IJB721TokenUriResolver",
          "Mint revnet tokens from your own contract",
        ],
        [
          "Allow Croptop posting categories at launch (allowedPosts)",
          "Add ruleset flags beyond the extraMetadata bits",
        ],
        ["Choose which sucker deployers link the chains", "Change the schedule after launch"],
        [
          "Build anything that pays into, reads, or wraps the revnet: project payers, routers, terminal wrappers, keepers",
          "Take the project NFT back from REVOwner",
        ],
      ],
    },
    links: [
      { href: `${REV_CORE}/REVOwner.sol`, label: "REVOwner.sol" },
      { href: `${REV_CORE}/REVDeployer.sol`, label: "REVDeployer.sol" },
    ],
  },
  {
    id: "split-hooks",
    part: "Contract builders",
    audience: ["contracts"],
    title: "Split hooks: the main extension point",
    summary:
      "A stage's split recipients can be contracts. When the split is distributed, the controller hands your contract its tokens and calls processSplitWith. The LP split hook uses this to seed pool liquidity.",
    paragraphs: [
      "Split recipients live in group 1 (RESERVED_TOKENS). Set the split's hook field to your contract's address. For an ERC-20, the controller grants an allowance: pull the tokens during the callback, or the rest is revoked and burned. For credits, it transfers them to the hook before the callback. A reverting callback emits SplitHookReverted without blocking distribution; unpulled ERC-20 tokens are burned, while transferred credits stay at the hook.",
    ],
    codePoints: [
      {
        title: "IJBSplitHook",
        details: [
          {
            key: "Function",
            value: "processSplitWith(JBSplitHookContext calldata) external payable",
          },
          {
            key: "Context",
            value:
              "token, amount, decimals (18), projectId, groupId, split (percent, projectId, beneficiary, preferAddToBalance, lockedUntil, hook)",
          },
          {
            key: "Caller",
            value: "JBController; this path does not check ERC-165, but implement it anyway",
          },
        ],
        code: [
          "// ERC-20-only fragment. Define CONTROLLER, PROJECT_ID, and PROJECT_TOKEN",
          "// in your contract; inherit ReentrancyGuard and implement IERC165.",
          "using SafeERC20 for IERC20;",
          "",
          "function processSplitWith(JBSplitHookContext calldata context) external payable nonReentrant {",
          "    if (msg.sender != address(CONTROLLER)) revert Unauthorized();",
          "    if (context.projectId != PROJECT_ID) revert BadProject();",
          "    if (context.groupId != 1 || address(context.split.hook) != address(this)) revert BadSplit();",
          "    if (context.token == address(0) || context.token != PROJECT_TOKEN) revert BadToken();",
          "",
          "    // ERC-20: pull it now; the allowance is revoked (and the remainder burned) after this call.",
          "    IERC20(context.token).safeTransferFrom(msg.sender, address(this), context.amount);",
          "    // ... do the thing: LP, vest, distribute, forward to another project.",
          "}",
        ].join("\n"),
        links: [
          { href: `${NANA_CORE}/interfaces/IJBSplitHook.sol`, label: "IJBSplitHook.sol" },
          { href: `${NANA_CORE}/structs/JBSplitHookContext.sol`, label: "JBSplitHookContext.sol" },
          {
            href: "https://github.com/Bananapus/nana-univ4-lp-split-hook-v6",
            label: "LP split hook (worked example)",
          },
          { href: `${SKILLS}/jb-split-hook/SKILL.md`, label: "jb-split-hook skill" },
        ],
      },
    ],
    note: "sendReservedTokensToSplitsOf has no reentrancy guard, so add nonReentrant. A hook that pulls less than its amount loses the rest for good: the controller burns it.",
  },
  {
    id: "install-and-deploy-from-solidity",
    part: "Contract builders",
    audience: ["contracts"],
    title: "Install the code and deploy from Solidity",
    summary:
      "The V6 repos ship as npm packages and import by package path. deployFor takes the whole revnet as structs; every field is listed here with its unit.",
    table: {
      label: "Packages (Solidity 0.8.28)",
      rows: [
        ["@rev-net/core-v6", "REVDeployer, REVOwner, REVLoans"],
        [
          "@bananapus/core-v6",
          "Terminals, controller, tokens, splits, permissions, the hook interfaces",
        ],
        ["@bananapus/721-hook-v6", "Shop tiers"],
        ["@bananapus/buyback-hook-v6", "Pool routing"],
        ["@bananapus/suckers-v6", "Cross-chain"],
        ["@bananapus/router-terminal-v6", "Token routing"],
        ["@croptop/core-v6, @bananapus/permission-ids-v6", "Posting, permission constants"],
      ],
    },
    paragraphs: [
      'npm i the packages you need and import by path (import "@rev-net/core-v6/src/REVDeployer.sol"). remappings.txt in every repo only maps forge-std; node_modules resolves the rest, which is also how the deploy artifacts record source names.',
    ],
    codePoints: [
      {
        title: "REVDeployer.deployFor, field by field",
        details: [
          {
            key: "Signature",
            value:
              "deployFor(uint256 revnetId, REVConfig, JBAccountingContext[], REVSuckerDeploymentConfig, REVDeploy721TiersHookConfig, REVCroptopAllowedPost[]) payable → (revnetId, IJB721TiersHook)",
          },
          {
            key: "Short form",
            value:
              "the 4-argument overload deploys an empty shop with the base currency and 18 decimals",
          },
          {
            key: "revnetId",
            value:
              "0 creates a project; msg.value must equal JBProjects.creationFee(). A non-zero id must be owned by the caller, sends no value, and hands the NFT to REVOwner for good",
          },
          {
            key: "REVConfig",
            value:
              "description { name, ticker, uri, salt }, baseCurrency (uint32), operator, scopeCashOutsToLocalBalances, stageConfigurations[]",
          },
          {
            key: "REVStageConfig",
            value:
              "startsAtOrAfter (uint48, strictly increasing; 0 = now for the first), autoIssuances[] { chainId, count (uint104), beneficiary }, splitPercent (uint16, of 10,000), splits[] (JBSplit), initialIssuance (uint112, 18-dec tokens per base unit; 1 = inherit), issuanceCutFrequency (uint32 seconds), issuanceCutPercent (uint32, of 1e9), cashOutTaxRate (uint16, of 10,000, below 10,000), extraMetadata (uint16; bit 2 allows adding chains)",
          },
          {
            key: "JBAccountingContext",
            value:
              "token, decimals (uint8), currency (uint32; by convention uint32(uint160(token)))",
          },
          {
            key: "REVSuckerDeploymentConfig",
            value: "deployerConfigurations[], salt (0 skips sucker deployment)",
          },
          {
            key: "REVDeploy721TiersHookConfig",
            value:
              "baseline721HookConfiguration { name, symbol, baseUri, tokenUriResolver, contractUri, tiersConfig, flags }, salt, preventOperatorAdjustingTiers / UpdatingMetadata / Minting / IncreasingDiscountPercent",
          },
          {
            key: "REVCroptopAllowedPost",
            value:
              "category (uint24), minimumPrice (uint104), minimumTotalSupply, maximumTotalSupply, maximumSplitPercent (uint32), allowedAddresses[]",
          },
        ],
        code: [
          "// Resolve the deployed contracts and construct the structs before this fragment.",
          "// For matching chains, use the same explicit first-stage start and configuration hash.",
          "(uint256 revnetId, IJB721TiersHook hook) = REV_DEPLOYER.deployFor{value: PROJECTS.creationFee()}({",
          "    revnetId: 0,",
          "    configuration: config,",
          "    accountingContextsToAccept: contexts,",
          "    suckerDeploymentConfiguration: suckers,",
          "    tiered721HookConfiguration: shop,",
          "    allowedPosts: new REVCroptopAllowedPost[](0)",
          "});",
        ].join("\n"),
        links: [
          { href: `${REV_CORE}/REVDeployer.sol`, label: "REVDeployer.sol" },
          { href: `${REV_CORE}/structs/REVStageConfig.sol`, label: "REVStageConfig.sol" },
          { href: `${SKILLS}/jb-deploy-ui/SKILL.md`, label: "Launch interface skill" },
        ],
      },
    ],
    note: "The configuration hash covers the name, ticker, and salt; base currency; balance scope; and each stage's effective start, split percent, issuance, cuts, tax, extraMetadata, and auto issuances. It excludes split recipients. A first-stage start of 0 becomes the execution time, so sending 0 separately on several chains can produce different hashes. When adding a chain, reuse the original effective configuration, sender, salts, and deployment addresses, then check every resulting token and bridge pair.",
  },
  {
    id: "loans-from-contracts",
    part: "Contract builders",
    audience: ["contracts"],
    title: "Loans from a contract",
    summary:
      "Any contract holding the right permission from a token holder can call REVLoans. Liquidation is permissionless, which makes it a keeper job.",
    table: {
      label: "REVLoans surface",
      rows: [
        [
          "borrowFrom(revnetId, token, minBorrowAmount, collateralCount, beneficiary, prepaidFeePercent, holder)",
          "OPEN_LOAN (37) from holder; returns (loanId, REVLoan)",
        ],
        [
          "repayLoan(loanId, maxRepayBorrowAmount, collateralCountToReturn, beneficiary, allowance) payable",
          "REPAY_LOAN (39) from the loan NFT owner; excess value refunded",
        ],
        [
          "reallocateCollateralFromLoan(loanId, collateralCountToTransfer, token, minBorrowAmount, collateralCountToAdd, beneficiary, prepaidFeePercent)",
          "REALLOCATE_LOAN (38), plus OPEN_LOAN when adding collateral",
        ],
        [
          "liquidateExpiredLoansFrom(revnetId, startingLoanId, count)",
          "Anyone, after the 3,650-day expiry",
        ],
        [
          "borrowableAmountFrom, loanOf, loanSourceTokensOf, determineSourceFeeAmount",
          "Views for quoting",
        ],
      ],
    },
    paragraphs: [
      "A holder acting for themselves needs no grant. A contract acting for a holder needs JBPermissions.setPermissionsFor from that holder, scoped to the revnet (ROOT works but is far too broad). Every state-changing call runs under a loan-specific reentrancy guard. Collateral is burned when the loan opens and minted again when it closes.",
      "A standard loan deducts a 2.5% Juicebox fee, a 1% REV fee when available, and a prepaid borrowing cost of 2.5–50% paid to the revnet. 2.5% prepays 182.5 days; 50% prepays all 3,650. After the prepaid period the cost rises until expiry.",
    ],
    links: [
      { href: `${REV_CORE}/REVLoans.sol`, label: "REVLoans.sol" },
      { href: `${SKILLS}/jb-revloans/SKILL.md`, label: "jb-revloans skill" },
    ],
  },
  {
    id: "sharp-edges",
    part: "Contract builders",
    audience: ["contracts", "frontend"],
    title: "Revnet sharp edges",
    summary:
      "Revnet details that change the meaning of an otherwise valid call. The Juicebox build guide lists the ones every project shares.",
    points: [
      {
        key: "The 7-day lock",
        text: "a first stage whose start has passed when the launch executes locks cash outs and loans for seven days on that chain. Watch for it with Safe proposals and scripted multichain launches.",
      },
      {
        key: "Splits on the pool route",
        text: "a terminal payment the buyback hook fills from the pool still pays the split: the bought tokens are burned and reissued. The payer can opt out with the third buyback metadata word, skipSplits. A direct swap on the Universal Router pays no split.",
      },
      {
        key: "Bridge cash outs",
        text: "a registered sucker cashes out on the source chain with no tax and no launch lock, against local backing only, so bridge accounting works. A holder who receives the tokens on the destination gets neither exemption.",
      },
      {
        key: "Fees at 0% tax",
        text: "a 0% cash out tax removes the Revnet fee, but a Juicebox fee can still apply to balance that arrived through payouts that had not paid one.",
      },
      {
        key: "The configuration hash",
        text: "it decides whether chains share a token address. Recipients are excluded, but a first-stage start of 0 is replaced by each chain's execution time.",
      },
    ],
    links: [
      { href: `${JB_BUILD}#contracts-sharp-edges`, label: "Behavior every project shares" },
      { href: `${SKILLS}/jb-suckers/SKILL.md`, label: "jb-suckers skill" },
    ],
  },

  // ------------------------------------------------------------------ Ship it safely
  {
    id: "test-and-verify",
    part: "Ship it safely",
    title: "Test what can surprise you",
    summary:
      "Test the builders you ship where a fixed schedule, route changes, permissions, and cross-chain timing meet.",
    points: [
      {
        key: "Launch",
        text: "the configuration round-trips through every ABI overload; a past first-stage start produces the seven-day lock; matching configuration, sender, salts, and deployment addresses produce the intended token address on every chain.",
      },
      {
        key: "Payments",
        text: "the chosen route's executable minimum is no worse than the alternatives shown; an empty pool falls back to issuance; a router route is probed, not assumed.",
      },
      {
        key: "Cash outs",
        text: "the terminal or hook enforces the same minimum the confirmation shows, including at 0% tax.",
      },
      {
        key: "Loans",
        text: "only the loan permissions (37, 38, 39) are granted, scoped to the revnet; repayment ceilings cannot underpay the live debt; partial repay mints the replacement NFT.",
      },
      {
        key: "Operator",
        text: "no exposed call can change issuance, cuts, taxes, or split percentages; a Safe proposal is not success.",
      },
      {
        key: "Multichain",
        text: "one chain's project, token, decimals, operator, or proof is never reused on another; delayed claims stay claimable.",
      },
    ],
    paragraphs: [
      "Foundry tests can extend TestBaseWorkflow for logic and revnet-core-v6's ForkTestBase against the deployed contracts. Then publish the addresses, source, transaction map, and a readable stage schedule so users can check your product against the contracts. The audit page has prompts for a whole-system review and for a single transaction.",
    ],
    links: [
      { href: "/audit", label: "Audit prompts and source index" },
      {
        href: "https://github.com/rev-net/revnet-core-v6/tree/main/test",
        label: "revnet-core-v6 tests",
      },
      { href: `${JB_BUILD}#ship-test-what-can-surprise-you`, label: "Tests every project needs" },
    ],
  },

  // ------------------------------------------------------------------ Reference
  {
    id: "words-for-builders",
    part: "Reference",
    title: "Words for builders",
    summary:
      "The technical terms this guide uses. Learn's glossary covers the plain-language ones.",
    points: [
      { key: "Stage", text: "a revnet ruleset: one period of the schedule, fixed at launch." },
      {
        key: "Split / reserved tokens",
        text: "the share of new tokens sent to contributors. Revnets call it the split (splitPercent); Juicebox calls it reserved tokens (reservedPercent). Same mechanism.",
      },
      {
        key: "Terminal",
        text: "the contract that accepts payments, holds the balance, and runs cash outs.",
      },
      {
        key: "Hook",
        text: "a contract called during a payment, cash out, or split to change its result. The buyback hook buys from the pool when that beats issuance.",
      },
      {
        key: "Sucker",
        text: "a bridge contract pair that moves tokens and balance between chains.",
      },
      {
        key: "Credits / ERC-20",
        text: "two ways to hold a balance. Credits live inside Juicebox; claiming turns them into ERC-20 tokens one for one.",
      },
      {
        key: "TWAP",
        text: "time-weighted average price. The buyback hook uses it as a floor and issues tokens when a swap cannot meet it.",
      },
      {
        key: "Router gateway",
        text: "the payment entry the router registry selects on upgraded chains. It holds funds before routing; failed fee payments stay held for retry.",
      },
      {
        key: "SDK",
        text: "@bananapus/nana-sdk-core, the TypeScript library for reads and builders.",
      },
      { key: "ABI", text: "a contract's callable functions and data types." },
      { key: "RPC", text: "the connection an app uses to read a chain and send transactions." },
      {
        key: "Bendystraw",
        text: "the indexer: onchain events organized into searchable GraphQL data.",
      },
      { key: "IPFS", text: "file storage addressed by content; holds names, logos, and media." },
      {
        key: "Bundle",
        text: "a set of signed calls for several chains, paid once on one chain and executed on each.",
      },
    ],
    links: [{ href: "/learn#glossary", label: "Plain-language glossary" }],
  },
];

export default function BuildPage() {
  return (
    <>
      <Nav />
      <RevnetGuide
        eyebrow="Build"
        title="Build with revnets"
        introduction="Launch a revnet, connect an app, or write a contract. Start with your task and open technical details as you need them."
        sections={SECTIONS}
        afterIntroduction={
          <>
            <nav aria-label="Choose a building path" className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  href: "#launch-with-an-agent",
                  title: "Launch a revnet",
                  description: "With an AI assistant or the launch form. No code needed.",
                },
                {
                  href: "#shared-with-juicebox",
                  title: "Connect an app",
                  description: "Read a revnet, accept payments, and add loans and operator tools.",
                },
                {
                  href: "#extension-points",
                  title: "Write a contract",
                  description: "Add behavior and test it against the V6 contracts.",
                },
              ].map(({ href, title, description }) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded-lg border border-zinc-300 bg-white p-4 text-zinc-900 hover:border-melon-500 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900"
                >
                  <span className="block font-semibold">{title}</span>
                  <span className="mt-2 block text-sm leading-relaxed text-zinc-700">
                    {description}
                  </span>
                </Link>
              ))}
            </nav>
            <p className="text-base text-zinc-600">
              Revnets are built on Juicebox. The{" "}
              <Link href={JB_BUILD} className="underline decoration-melon-400 underline-offset-4">
                Juicebox build guide
              </Link>{" "}
              covers what every project shares; this guide covers stages, splits, loans, and the
              operator.
            </p>
            <AgentSkillsNote
              skills={[
                "jb-deploy-ui",
                "revnet-economics",
                "jb-revloans",
                "jb-suckers",
                "jb-bendystraw",
                "jb-interact-ui",
              ]}
              prompt={<CopyRevnetBuildPrompt />}
            />
          </>
        }
        afterSections={
          <p className="leading-relaxed text-zinc-700">
            Start from the smallest operation your product needs and keep the fresh read, builder,
            simulation, review, and confirmation on one path. The complete working client is the{" "}
            <Link
              href="https://github.com/mejango/revnet-money"
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
            "Stages, the three prices, cash out taxes, loans, the operator, and multichain, in plain language.",
        }}
      />
    </>
  );
}
