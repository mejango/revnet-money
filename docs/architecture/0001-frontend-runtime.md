# ADR 0001: retain Next.js and ship a standalone runtime

- Status: accepted
- Date: 2026-07-22
- Decision owners: Revnet frontend maintainers

## Context

Revnet is pre-production, so this is the least expensive point to challenge its
runtime choices. The production source is roughly 43,500 lines and includes 148
TSX/JSX modules. More importantly, it already uses the framework as a server,
not merely as a client bundler:

- 45 modules import Next APIs;
- 11 page/layout server entry points render project and discovery surfaces;
- 10 modules depend on server-only/cache behavior;
- four API routes provide Bendystraw, IPFS, pinning, and badge boundaries;
- dynamic SEO and Farcaster frame metadata are generated server-side; and
- ten modules use image optimization for local, IPFS, or ENS imagery.

The wallet, Safe, Relayr, contract parity, and transaction-review invariants are
framework-independent and must remain unchanged by an infrastructure upgrade.

## Options considered

### Keep Next 14 and Yarn Classic for the first deployment

This preserves the repository's already resolved and locally verified dependency
graph. Next 14 can still emit the same portable standalone artifact, while a
framework/package-manager upgrade can be reviewed separately from the launch
safety work.

### Upgrade Next in place and emit its standalone server

This remains the preferred modernization direction, but validating it requires
resolving a new registry graph, rebuilding native/optional packages, and running
the complete release suite. Registry access was not authorized during this
predeployment pass, so combining that unverified migration with the initial
release would weaken rather than improve the evidence for the artifact.

Standalone output traces only runtime dependencies, yields one OCI artifact,
keeps server rendering and metadata in the same process, and avoids coupling
deployment to Vercel.

### Vite/React Router plus a separate Hono API

This could produce a smaller static client artifact, but Revnet would still need
a server for metadata, Farcaster frames, image safety, Bendystraw proxying, IPFS
pinning, and shields. It would introduce two release artifacts, cross-origin
configuration, duplicated health/observability policy, and a rewrite of 45
Next-coupled modules. There is no measured user or operational benefit that
justifies that added failure surface.

### Replace React or adopt another full-stack framework

The wallet and protocol SDK ecosystem is React-oriented. A replacement would
rewrite the largest and most safety-sensitive surface while leaving all
external-chain and server integration concerns intact. This is not credible
without a product requirement that the current stack cannot meet.

## Decision

Retain React, Next 14, and the repository's single Yarn Classic lockfile for the
initial deployment. Ship `output: "standalone"` in a digest-pinned, multi-stage,
non-root OCI image. CI, release, and Docker builds use
`yarn install --frozen-lockfile --ignore-scripts`; no second lockfile is
accepted.

Modernizing Next and the package manager is explicitly deferred until registry
resolution is authorized and the resulting lockfile, optional/native binaries,
production build, browser suite, and OCI image all pass as one reviewed change.

Public build configuration is validated before compilation. Runtime secrets are
validated at process start. Per-chain RPC inputs are provider-neutral,
comma-separated fallback lists; no vendor credential is committed. Contract
deployments remain pinned to deploy-all-v6 commit
`316e9d4d3f9e1c5b41a5df7c0ad6183abbeccc7f`.

## Consequences

- One image runs on any OCI-compatible platform and can be rolled back by
  digest.
- Server rendering, Farcaster metadata, health, proxies, and the client remain
  one deployable unit.
- The runtime needs a writable `.next/cache` volume or tmpfs for image
  optimization; the rest of its filesystem can be read-only.
- `NEXT_PUBLIC_*` values are image build inputs and are permanently public.
  Changing them requires a rebuild. Runtime secret rotation only needs a
  restart/redeploy of the same digest.
- React 19 remains deferred until ConnectKit and the Nana SDK publish compatible
  peer ranges and the complete invariant/browser suite passes against it.
- Next/package-manager modernization remains deferred for the validation reason
  above, not because it is out of scope indefinitely.
- A future static-client split should require measured latency, cost, scaling,
  or isolation evidence—not aesthetic preference.

## Upgrade guardrails

Dependabot groups non-major JavaScript, action, and Docker updates weekly. Majors stay
separate for deliberate review. Every upgrade must pass the release-equivalent
gate, standalone check, bundle budgets, zero-egress browser suite, contract
parity, and OCI smoke test. No dependency audit is permitted to auto-fix or
force a breaking graph without the same review.
