# Sticky home-chain SDK consumer qualification

## Plan refinement

- **Objective:** Qualify Revnet's existing Sticky split editor and reviewed transaction flows against the shared SDK's additive home-chain collector support, then pin the official release without changing same-chain editor semantics.
- **System fit:** The SDK owns collector identity, routing, encoding and review; Revnet keeps its existing distributor editor and reviewed wallet adapters. This package adoption grants no deployment, source-split or merge authority.
- **Reuse and simplicity:** Reuse existing Sticky and transaction-review regression suites and the established type, production-build, source, protocol and bundle gates. Add no local routing/configuration owner; prefer a package-only change when the additive API is compatible.
- **Evidence and unknowns:** Baseline is clean a88a0450 on Node26.7.0/npm12.0.1 with SDK2.25.0. The qualified preview was built from SDK51fb7aaa847d891c421abca6ac8fdd1ab07eebdd; official2.26.0 publication and package equivalence are now verified below. Preview staging touches only ignored node_modules and preserves its physical dependency graph with a backup.
- **Verification:** Run focused Sticky/review regressions, types, required source/protocol/wallet gates and browser production build with bundle/standalone checks. Compare any aggregate growth against the same app/toolchain on SDK2.25.0 before changing only the measured ceiling. Verify official package integrity/payload and manifest/lock scope before final handoff.
- **Resource budget:** One owner serializes dependency staging and builds; a read-only reviewer checks caller compatibility in parallel. Use bounded existing suites, no unrelated contract work, no repeated full suite without a changed dependency/failure, and no commits, pushes, merges or deployments.

## Work

- [x] Inspect SDK caller compatibility and required gates.
- [x] Qualify the frozen preview using existing regression/type/static/build checks; resolve the measured aggregate budget failure.
- [x] Adopt the exact published SDK release after root confirms availability.
- [x] Verify official payload and final package/lock scope; record evidence.

## Preview review

The existing same-chain Sticky distributor/group APIs are unchanged. Revnet preserves unknown collector hooks as raw hook rows; classifying one as the existing Sticky editor option would replace it with the local distributor. The SDK collector registry is empty until verified deployments are published. No new app configuration or encoding rules are needed for this additive upgrade.

Preview integrity is `sha512-Ks0WTW+BSbyI+bHt9S0QJ8Xse5WNAPjeJyAAjcg1Kf9Hg2HQtAK6gP3c/d4rF47V1+b1+qLZcIF/2fTkb9RL1Q==`. The preview changes only24 package files owned by `review/decode`, `v6/sticky` and `v6/tokens` across ESM/CJS and their declarations/maps. Package metadata and SDK-local dependencies are byte-identical to the installed2.25.0 baseline. The entire prior SDK package is backed up at `/private/tmp/revnet-sticky-sdk-2.25-backup-20261009`.

Completed checks:26 focused Sticky/split/review files with612 tests; types; full lint; dependency integrity; dead-code; environment fixtures; source invariants;44 independently pinned protocol artifacts; wallet-write inventory; deployment policy; formatting ratchet; browser production build; standalone artifacts; and50 creation/dialog browser cases across five viewports. Evidence uses `/private/tmp/revnet-sticky-sdk-` log prefixes (`focused`, `typecheck`, `static-results.json`, `lint`, `dead-code`, `env-test`, `preview-build`, `standalone`, `browser`).

The unmodified aggregate bundle gate failed at 2,770,714 B (2705.8 KiB), compared with the same app/dependency/toolchain baseline 2,749,570 B (2685.1 KiB): +21,144 B. Route-referenced JavaScript changed 977,599→997,742 B and the largest route 696.7→700.2 KiB. Route/referenced limits and every wallet lazy-load check pass. Preserve the initial failure in `/private/tmp/revnet-sticky-sdk-preview-bundle.log`; exact per-chunk measurements are in `/private/tmp/revnet-sticky-sdk-bundle-comparison.json`.

Independent import review confirms the route verifier is eliminated and generated ABI modules are unchanged. The collector ABI shares a module with existing Sticky group helpers, leaving 2,558 raw ABI bytes in a 1,341-byte gzip shared chunk; extracting a separate ABI owner could reduce that small initial payload in a future SDK release. Transaction review remains lazy and its chunk shrinks 328 B. Most aggregate movement comes from repartitioning existing modules, so the measured package-update total does not claim per-function attribution. Raise only the aggregate ceiling from 2686 to 2706 KiB, the minimum integer ceiling above the measurement; route, referenced and wallet-lazy gates remain unchanged.

The adjusted bundle gate passes, as do its existing 19 regression cases and scoped ESLint/Prettier checks. This brings focused unit verification to 631 cases. The plan refinement and whitespace checks pass.

## Official package adoption

The user confirmed the SDK release and version PR #197 merged at `4c8646ee08ab41dc3536a00180d9b1a4fef25518`. Root confirmed registry publication, and npm 12.0.1 installed exact SDK 2.26.0 with integrity `sha512-7V9wFoBtteL0Y7jTzTO5qwfYMcBCKZ+W5C8JEXVadqf8iZ+fuAi5jg6qZzBWvrDFHHRRC7K6Ed2ZpevdXV/79g==`.

All 761 non-metadata package files match the qualified preview byte-for-byte. Its sole `package.json` difference is the version. The complete 112,881-file/symlink installed graph differs only in the SDK's version metadata and npm's hidden lock. The tracked lock changes only the root SDK pin and SDK version/resolved URL/integrity; no unrelated dependency moved. Exact comparison evidence is `/private/tmp/revnet-sticky-sdk-official-equivalence.json`.

Final dependency integrity, types, source invariants, 44 pinned protocol artifacts, wallet-write inventory, formatting ratchet, bundle and whitespace checks pass. Official adoption carries forward the 631 focused unit cases, 50 browser cases and production/standalone evidence because all runtime files and physical dependency placement are identical; the production artifact was built with preview version metadata. Final hosted CI can rebuild official metadata from the committed lock. Logs are `/private/tmp/revnet-sticky-sdk-official-static-results.json` and `/private/tmp/revnet-sticky-sdk-official-typecheck.log`.

No app runtime source changed, and the existing same-chain editor semantics remain intact. No commit, push, merge, deployment or live split change occurred in this consumer worktree; root owns review and publication.
