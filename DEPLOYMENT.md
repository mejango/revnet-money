# Production deployment

Revnet ships as a portable Next standalone OCI image. A release publishes an
immutable commit tag (`sha-<40-character commit>`) and, for version tags, the
version tag to GHCR. There is intentionally no `latest` tag. Deploy and roll
back by digest.

## Railway branch environments

Use the repository `railway.json` for both Railway services and keep branch
promotion identical across the webclients:

| Git branch | Railway environment | Public origin |
| --- | --- | --- |
| `staging` | staging | `https://staging.revnet.money` |
| `main` | production | `https://revnet.money` |

Connect the staging service to `staging` and the production service to `main`,
enable automatic deploys only after CI succeeds, and disable overlap so an
older build cannot replace a newer commit. Set `NEXT_PUBLIC_SITE_URL` to the
matching origin. Do not configure `NEXT_PUBLIC_VERSION` in Railway: the
Dockerfile consumes Railway's automatically injected `RAILWAY_GIT_COMMIT_SHA`
and exposes it to the application as `NEXT_PUBLIC_VERSION`. All other public
variables are environment-scoped build values; provider credentials and
ingress tokens are environment-scoped runtime secrets. Promote by merging
`staging` into `main`, never by pointing production at `staging`.

## Configuration model

Copy `.env.example` when developing locally. `npm run env:check:build` and
`npm run env:check:runtime` fail before an invalid configuration can start.
Non-loopback service URLs must use HTTPS.

Build-time values are compiled into JavaScript and are public:

- `NEXT_PUBLIC_SITE_URL`: canonical HTTPS origin used for links, metadata,
  and origin validation.
- `NEXT_PUBLIC_BENDYSTRAW_URL` and
  `NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL`: indexed contract-derived views.
- `NEXT_PUBLIC_PARA_API_KEY`: public Para application key.
- `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID`: optional; a WalletConnect Cloud
  project id. Empty hides the WalletConnect option — the relay rejects
  unregistered ids, so a connector without one always fails.
- `NEXT_PUBLIC_PARA_ONRAMP_PROVIDER`: optional; which Para on-ramp provider the
  headless "Get ETH" call bills through (`STRIPE` default, or `MOONPAY`, `RAMP`,
  `CDP`, `MERCURYO`). It must be enabled in the Para dashboard to work.
- `NEXT_PUBLIC_PARA_ENV`: one of `DEV`, `SANDBOX`, `BETA`, or `PROD`; use
  `PROD` for the production application.
- `NEXT_PUBLIC_DWELLIR_API_KEY`: a dedicated browser-visible Dwellir key used
  to derive the Ethereum, Optimism, Base, Arbitrum, and Sepolia RPC endpoints.
  Apply strict daily/monthly quotas; IP allowlisting is incompatible with
  browser-originated requests.
- `NEXT_PUBLIC_VERSION`: optional non-Railway build override for the immutable
  Git commit SHA reported by `/api/healthz`; Railway derives it automatically.

Runtime-only values must never be Docker build arguments:

- `IPFS_PINNING_ENABLED`, normally `false`;
- `IPFS_PINNING_EDGE_PROTECTED`, `true` when an ingress enforces the quota policy
  and `false` when the app budgets callers itself (see below);
- `FILEBASE_IPFS_RPC_TOKEN` and `PINATA_JWT`, required only when redundant
  pinning is enabled;
- `IPFS_PINNING_INGRESS_TOKEN`, a random 32+ character secret required only in
  edge-protected mode, and rejected at startup in first-party mode.

The container refuses to start when its runtime contract is invalid. The health
endpoint is dependency-free and returns `cache-control: no-store`; external RPC,
Bendystraw, or IPFS health must be monitored separately so a third-party outage
does not cause an orchestrator restart loop.

## IPFS pinning threat model

The pin routes consume a paid provider quota, so they are disabled by default and
support two deployments. `IPFS_PINNING_ENABLED=true` is required for either.

**Edge-protected** (`IPFS_PINNING_EDGE_PROTECTED=true`, `IPFS_PINNING_INGRESS_TOKEN`
set). Something in front — a WAF or proxy — enforces the policy and injects the
token, which is then the authorization. Do not run this mode unless that ingress:

1. strips any client-supplied `x-revnet-pinning-ingress-token` header;
2. authenticates or rate-limits the caller (wallet/session plus IP and global
   quotas are recommended);
3. injects that header with `IPFS_PINNING_INGRESS_TOKEN` only after the policy
   passes;
4. limits every pin route to POST and caps request bodies per route —
   `/api/ipfs/pinJson` at 128 KiB, `/api/ipfs/pinFile` at 1 MiB, and
   `/api/ipfs/pinMedia` at 25 MiB (allow ~256 KiB of multipart envelope on the
   two upload routes); and
5. alerts on provider usage and enforces a provider-side spending quota.

A rule written for `pinJson` alone leaves the upload routes unauthorized: they
share the same gate, so they answer 401 until the ingress injects the header for
them too.

**First-party** (`IPFS_PINNING_EDGE_PROTECTED=false`, no token). The app is reached
directly — the deployment Railway gives you, with no CDN in front. The app then
enforces the budget itself: same-origin only, ten pins per client and two hundred
site-wide per ten minutes, plus the per-route size and media-type limits. Be clear
about what this is and is not:

- the origin check is CSRF defense; a non-browser can forge it;
- the client key comes from `x-forwarded-for`, which without a trusted proxy is
  client-supplied, so a determined caller can rotate it;
- the budget lives in process memory, so it resets on redeploy and counts per
  instance.

It stops a script from draining the provider quota in a minute, which is the
realistic threat for a site published straight from the platform. It is not a WAF.
Set a provider-side spending cap on Filebase and Pinata regardless — that is the
backstop that does not depend on this code being right.

The application independently uses a constant-time token comparison, exact
canonical-origin check, content-length validation before the body is buffered,
per-route size and media-type limits, a 15-second upstream timeout, and response
validation. Rotate the ingress and provider tokens together if either layer may
have leaked.

The read-only Bendystraw and IPFS proxy routes have fixed configured upstreams,
bounded bodies/paths, and no server credential. IPFS upstream fetches explicitly
bypass Next's persistent data cache so attacker-selected 25 MiB CIDs cannot grow
local storage without bound; validated CID responses remain immutable in the
browser and CDN. Configure bounded CDN eviction/quota policy. Apply ordinary
edge per-IP and global rate limits to `/api/**` anyway to constrain bandwidth
and upstream load.

## Build locally

Install and verify first:

```sh
nvm use
npm ci
npm run audit:production
npm run check
```

The production audit is the one registry-backed gate: an unreachable registry
fails the audit and must never be reported as a clean result. `npm run check`
remains deterministic and offline once the lockfile and Chromium are present.

Export all build-time variables from `.env.example`, then build by forwarding
their names (the values come from the current environment):

```sh
docker build \
  --build-arg NEXT_PUBLIC_SITE_URL \
  --build-arg NEXT_PUBLIC_BENDYSTRAW_URL \
  --build-arg NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL \
  --build-arg NEXT_PUBLIC_PARA_API_KEY \
  --build-arg NEXT_PUBLIC_PARA_ENV \
  --build-arg NEXT_PUBLIC_PARA_ONRAMP_PROVIDER \
  --build-arg NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID \
  --build-arg NEXT_PUBLIC_DWELLIR_API_KEY \
  --build-arg NEXT_PUBLIC_VERSION \
  --tag revnet-money:local .
```

Run with a read-only root and a writable, bounded image cache:

```sh
docker run --rm \
  --read-only \
  --tmpfs /app/.next/cache:uid=1001,gid=1001,size=256m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --env IPFS_PINNING_ENABLED=false \
  --publish 127.0.0.1:3000:3000 \
  revnet-money:local
```

Verify both the liveness path and the only intended writable runtime path:

```sh
curl --fail http://127.0.0.1:3000/api/healthz
curl --fail --output /dev/null \
  'http://127.0.0.1:3000/_next/image?url=%2Fassets%2Fimg%2Ficon-64x64.png&w=64&q=75'
```

The base is the official Node 22.23.1 Bookworm slim image pinned to Docker Hub
index digest
`sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3`.
Dependabot proposes digest/version updates; never replace it with a mutable-only
tag.

## Publish to GHCR

Create a protected GitHub environment named `production`. Populate every
build-time `NEXT_PUBLIC_*` entry above as an environment variable. Runtime
secrets belong in the deployment platform, not GitHub’s image-build workflow.

Push an annotated `v*` tag or manually dispatch `Release container`. Before
publishing, the workflow re-runs the complete release-equivalent gate, including
contract parity, transaction coverage, production build, bundle budget, and
Chromium. It then builds `linux/amd64` and `linux/arm64`, publishes an OCI SBOM,
maximal build provenance, and a GitHub artifact attestation.

Record the resulting digest in the release and deployment change. Verify the
attestation before promotion:

```sh
gh attestation verify oci://ghcr.io/OWNER/revnet-money@sha256:DIGEST \
  --repo OWNER/revnet-money
```

Publishing does not deploy or mutate a runtime environment.

## Runtime and rollout

- Run as UID/GID 1001 with a read-only root, all Linux capabilities dropped,
  and `no-new-privileges`.
- Mount `/app/.next/cache` as a 256 MiB tmpfs or bounded writable volume. It is
  safe to discard; a shared/persistent cache only improves image response cost.
- Set `HOSTNAME=0.0.0.0` and `PORT=3000` (the image defaults to both).
- Terminate TLS at a trusted ingress and add HSTS there after the production
  domain is final. Preserve the application's CSP `frame-ancestors 'none'` and
  `X-Frame-Options: DENY` anti-framing headers.
- Route liveness/readiness to `/api/healthz`; use a 20-second startup grace and
  avoid restarts based on third-party dependency health.
- Start one canary by digest, check health, image optimization, logs, the create
  page, a representative project page, and a reviewed wallet preview without
  submitting. Then increase traffic gradually.
- Emit container stdout/stderr to centralized logs. Alert on 5xx rate, latency,
  restarts, RPC/Bendystraw failures, IPFS quota, and image-cache saturation.

## Rollback

Keep the prior working digest and its build-time configuration in deployment
history. Roll back by changing only the image digest, preserving compatible
runtime secrets, and re-running the health and representative-route checks. No
database migration or contract change is performed by this frontend image.
Never rebuild an old commit and call it a rollback: use the previously attested
digest so the artifact is byte-for-byte identical.
