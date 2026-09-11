const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002";

/**
 * llmstxt.org index: the URL grammar and JSON endpoints an agent needs to read this
 * site without scraping rendered markup or guessing route shapes.
 */
const LLMS_TXT = `# Revnet

> A revnet shares revenue through tokens. Its token and cash out rules follow a
> schedule fixed at launch. An operator can manage some details, but cannot rewrite
> that schedule or withdraw the balance. Token value and revenue are not guaranteed.
> This site works with revnets built on Juicebox V6 across Ethereum, Optimism, Base,
> and Arbitrum. It reads contracts and Bendystraw, a service that indexes their records.

## URL grammar

- \`/<chain>:<projectId>\` — a revnet by its chain-scoped id, e.g. \`/base:10\`.
  Chain slugs: \`eth\`, \`op\`, \`base\`, \`arb\`, plus \`sep\`, \`opsep\`, \`basesep\`, \`arbsep\` for testnets.
- \`/@<handle>\` — the same revnet by its verified ENS handle. A handle is only served
  when ENS and the JBProjectHandles registry agree that the revnet's current operator
  claimed it, so it names exactly one revnet.
- Revnet subpages: \`/<slug>/owners\`, \`/<slug>/terms\`, \`/<slug>/shop\`, \`/<slug>/extras\`, \`/<slug>/operator\`.
- \`/account/<address-or-ens>\` — holdings and roles for one account. Not indexed.

Each revnet page carries schema.org Organization JSON-LD with its canonical URL,
identifier, description and logo.

## Pages

- [Home](${siteOrigin}/): how revnets work and where to start.
- [Discover](${siteOrigin}/discover): every indexed revnet.
- [Learn](${siteOrigin}/learn): what a revnet is and the rules it fixes at launch.
- [Build](${siteOrigin}/build): launch a revnet, connect an app, or write a contract.
- [Glossary](${siteOrigin}/learn#glossary): short definitions of the words used across this site.
- [Fees](${siteOrigin}/learn#fees): costs, receiving revnets, and how they share tokens with payers.
- [Payment tutorial](https://juicebox.money/build/first-payment): read a project, preview a payment, then try it on a test network.
- [Model the schedule](${siteOrigin}/build#choosing-the-numbers): compare scenarios before preparing a revnet draft.
- [Three prices](${siteOrigin}/learn#three-prices): compare new tokens, existing tokens, and returning tokens for money.
- [Inspect a project](https://juicebox.center/#apps/juicescan): identify a project by its network and ID; check transaction confirmation and any destination claim.
- [Create](${siteOrigin}/create): the revnet launch flow.
- [Audit](${siteOrigin}/audit): audits and security posture.

## JSON endpoints

Read-only, no key required, cached at the edge.

- \`GET /api/discover-projects\` — every indexed V6 revnet, one entry per sucker group.
- \`GET /api/top-projects\` — revnets ranked by secured reserves.
- \`GET /api/search-projects?q=<text>\` — revnets matching a name, handle or id.
- \`GET /api/project-name?chainId=<id>&projectId=<id>\` — canonical name and sucker group.
- \`GET /api/homepage-activity\` — recent payments and cash outs.
- \`GET /api/project-og/<chainId>/<projectId>\` — 1200x630 PNG link-preview card.

## Source

- Revnet contracts: https://github.com/rev-net/revnet-core-v6
- Protocol contracts: https://github.com/Bananapus/version-6
- This client: https://github.com/mejango/revnet-money
`;

export const revalidate = 3600;

export function GET() {
  return new Response(LLMS_TXT, {
    headers: {
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
