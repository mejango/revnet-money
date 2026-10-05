# Deliberate-backlog (D) items — revnet-money — 2026-07-28

Baseline: 66 files / 333 tests green (node 22).

- [x] 5. Small fixes: "Insuffient" typo; delete dead addresses.json; ShieldProject version: 6; getTopProjects survives ETH-price failure (keeps rows that need no price)
- [x] 3. Account subroutes: mainnet bendystraw pin centralized in ACCOUNT_BENDYSTRAW_CHAIN_ID (lib/accountHoldings.ts) — app has no testnet account mode today
- [x] 4. Owners caps: V6AllCard participants limit 1000 (PARTICIPANTS_FETCH_LIMIT) + totalCount + "aggregated from the N largest positions" caption; aggregation extracted to participantsAggregate.ts
- [x] 1a. getTokenConfigForChain returns null when unknown; RepayDialog/useBorrowDialog/LoansDetailsTable/RedeemDialog/V6YouCard/V6AllCard treat null as LOADING
- [x] 1b. RepayDialog native repay sends ceiling loanData.amount unconditionally (excess refunds)
- [x] 1c. Symbol gates replaced with isNativeToken (native-sentinel address) checks
- [x] 6. Timer-driven closes/error-clears removed (RepayDialog success -> explicit Close; useBorrowDialog terminal states persist); V6TokenPanel/PayerDeployForm timers converted to immediate + unmount-safe catch-up refetch
- [x] 7. SelectedLoan interface (useBorrowDialog + ReallocateDialog + V6LoansSubtab); melon-25/melon-300 panels + zinc text in Borrow/Redeem/Repay dialogs
- [x] 2. SuckerExtensionCard in Operator tab: REVDeployer.deploySuckersFor per chain, config-hash verification, accounting-context-derived asset mappings, shared salt, simulate-first sequential writes
- [x] Verify: 69 files / 350 tests green; tsc clean; eslint clean; wallet-writes:check 76 sites

## Review

All 7 backlog items landed without touching unrelated code. Contract facts for item 2
were verified against revnet-core-v6/src/REVDeployer.sol:631-656,900-921: operator-only
(`_checkIfIsOperatorOf`), ruleset metadata bit 2 gate, sucker salt =
keccak(hashedEncodedConfigurationOf, userSalt, caller) — so the client verifies the
target chain's stored config hash matches before building writes, and documents that a
missing/mismatched hash requires a prior byte-identical deployFor (unreconstructable
from chain state — only the hash is stored). New tests: token-config (5),
sucker-extension (6), owners-participants (3), account endpoint pin (1), top-projects
price-failure (1), ShieldProject version pin (in bendystraw-operations).

## Published SDK switch (2026-10-05)

- [x] Inspect the PR branch and existing CI failure in an isolated checkout.
- [x] Pin core 2.19.0 and remove preview archive, provenance and Docker/docs references.
- [x] Regenerate the lockfile and verify dependency integrity.
- [x] Run CI-equivalent checks and assess the inherited production advisory.
- [x] Review the SDK-only dependency diff and prepare the existing PR update.

### Published SDK switch review

Pinned the npm release with a four-line lockfile replacement and removed the preview archive/provenance and Docker/docs references. No other dependency versions or application source changed. All 721 distributed SDK files match the reviewed preview byte-for-byte.

`npm run check` passed: dependency, dead-code, environment, deployment, type, lint, formatting, source, wallet-write, coverage (1,824 tests passed, one skipped), production build, standalone, bundle and browser checks (121 passed, four skipped). All-client JavaScript is 2,626.8 KiB, within the unchanged 2,627 KiB cap. Independently verified 44 contract artifacts at pinned commit a6ab40c5806b52ff4cb21f9eaefe275e621796f9. Local verification used available Node 26.7.0 with pinned npm 12.0.1; CI retains Node 26.5.0.

The separate production audit still fails on inherited node-forge GHSA-86w9-cpqp-85rv and its Para dependency chain. As of 2026-10-05, npm latest is affected 1.4.0 and GitHub lists no patched version. The audit gate remains unchanged.
