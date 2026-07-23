# Production deployment

Revnet ships as a portable Next standalone OCI image. A release publishes an
immutable commit tag (`sha-<40-character commit>`) and, for version tags, the
version tag to GHCR. There is intentionally no `latest` tag. Deploy and roll
back by digest.

## Configuration model

Copy `.env.example` when developing locally. `npm run env:check:build` and
`npm run env:check:runtime` fail before an invalid configuration can start.
Non-loopback service URLs must use HTTPS.

Build-time values are compiled into JavaScript and are public:

- `NEXT_PUBLIC_SITE_URL`: canonical HTTPS origin used for links, metadata,
  and origin validation.
- `NEXT_PUBLIC_BENDYSTRAW_URL` and
  `NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL`: indexed contract-derived views.
- `NEXT_PUBLIC_INFURA_IPFS_HOSTNAME`: hostname only; no scheme or path.
- eight `NEXT_PUBLIC_*_SUBGRAPH_URL` values used by discovery.
- eight `NEXT_PUBLIC_RPC_*_URLS` values. Each accepts comma-separated endpoints;
  configure at least two independently operated providers per chain. Provider
  tokens in public RPC URLs must be domain, origin, method, and quota restricted.

Runtime-only values must never be Docker build arguments:

- `ENABLE_PUBLIC_IPFS_PINNING`, normally `false`;
- `INFURA_IPFS_PROJECT_ID` and `INFURA_IPFS_API_SECRET`, required only when
  pinning is enabled;
- `IPFS_PINNING_INGRESS_TOKEN`, a random 32+ character secret required only
  when pinning is enabled; and
- optional `APP_REVISION`, reported by `/api/healthz`.

The container refuses to start when its runtime contract is invalid. The health
endpoint is dependency-free and returns `cache-control: no-store`; external RPC,
Bendystraw, or IPFS health must be monitored separately so a third-party outage
does not cause an orchestrator restart loop.

## IPFS pinning threat model

The pin route consumes a paid provider quota and is therefore disabled by
default. An `Origin` check is only CSRF defense: a non-browser can forge it. Do
not enable public pinning unless the ingress:

1. strips any client-supplied `x-revnet-pinning-ingress-token` header;
2. authenticates or rate-limits the caller (wallet/session plus IP and global
   quotas are recommended);
3. injects that header with `IPFS_PINNING_INGRESS_TOKEN` only after the policy
   passes;
4. limits `/api/ipfs/pinJson` to POST and caps request bodies at 128 KiB; and
5. alerts on provider usage and enforces a provider-side spending quota.

The application independently uses a constant-time token comparison, exact
canonical-origin check, JSON/content-length validation, 128 KiB parsed-body
limit, a 15-second upstream timeout, and response validation. Rotate the ingress
and provider tokens together if either layer may have leaked. If those ingress
capabilities are unavailable, keep `ENABLE_PUBLIC_IPFS_PINNING=false` and use a
separate scoped upload service.

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
  --build-arg NEXT_PUBLIC_INFURA_IPFS_HOSTNAME \
  --build-arg NEXT_PUBLIC_MAINNET_SUBGRAPH_URL \
  --build-arg NEXT_PUBLIC_OPTIMISM_SUBGRAPH_URL \
  --build-arg NEXT_PUBLIC_BASE_SUBGRAPH_URL \
  --build-arg NEXT_PUBLIC_ARBITRUM_SUBGRAPH_URL \
  --build-arg NEXT_PUBLIC_SEPOLIA_SUBGRAPH_URL \
  --build-arg NEXT_PUBLIC_OPTIMISM_SEPOLIA_SUBGRAPH_URL \
  --build-arg NEXT_PUBLIC_BASE_SEPOLIA_SUBGRAPH_URL \
  --build-arg NEXT_PUBLIC_ARBITRUM_SEPOLIA_SUBGRAPH_URL \
  --build-arg NEXT_PUBLIC_RPC_ETHEREUM_URLS \
  --build-arg NEXT_PUBLIC_RPC_OPTIMISM_URLS \
  --build-arg NEXT_PUBLIC_RPC_BASE_URLS \
  --build-arg NEXT_PUBLIC_RPC_ARBITRUM_URLS \
  --build-arg NEXT_PUBLIC_RPC_ETHEREUM_SEPOLIA_URLS \
  --build-arg NEXT_PUBLIC_RPC_OPTIMISM_SEPOLIA_URLS \
  --build-arg NEXT_PUBLIC_RPC_BASE_SEPOLIA_URLS \
  --build-arg NEXT_PUBLIC_RPC_ARBITRUM_SEPOLIA_URLS \
  --tag revnet-money:local .
```

Run with a read-only root and a writable, bounded image cache:

```sh
docker run --rm \
  --read-only \
  --tmpfs /app/.next/cache:uid=1001,gid=1001,size=256m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --env ENABLE_PUBLIC_IPFS_PINNING=false \
  --env APP_REVISION=local \
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
