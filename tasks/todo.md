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

## Production audit advisories (2026-10-05)

- [x] Read how Para 3.15.0 uses node-forge. Seven files generate and restore an RSA key pair, unwrap shares with RSA-OAEP, convert keys to and from PEM, and use AES-CBC, SHA-256 and random bytes. No Para code verifies a signature, so GHSA-86w9-cpqp-85rv's code path is never reached.
- [x] Allow GHSA-86w9-cpqp-85rv by advisory id at high severity, only while the source check of Para's node-forge usage matches that audit (jango, 2026-10-05: Para's audit findings don't block merges until Signa replaces Para).
- [x] Move source-map-js to 1.2.2 for GHSA-68fv-2mgg-jv7q with a lockfile-only update; postcss already accepts ^1.2.1.
- [x] Prove an unknown advisory still fails: unit cases, and the live audit on the old lockfile, which names only source-map-js.

### Production audit advisories review

Para's own JavaScript is identical in jbm and revnet, so one audit covers both. The new gate failed live on the old lockfile and named only source-map-js, then passed on 1.2.2.

`npm run check` passed with Node 26.7.0 / npm 12.0.1: dependency, dead-code, environment, deployment, type, lint, formatting, source, protocol (fixture mode), wallet-write (140 call sites), coverage (1,840 tests passed, one skipped), browser build, standalone, bundle (2,627.0 of 2,628 KiB) and browser checks (121 passed, four skipped, inside the shared gate lock). The first coverage run timed out one persist-scope test at 10 s while two browser suites ran; the file passed alone (107 tests) and the full rerun passed. `next build --webpack` passed last.

## The SDK's Safe checks, with the Safe creation proof (2026-10-05, W1-R1)

Spec: sticky-next-port/.superpowers/sdd/2026-09-29-sticky-next-port/safe-adoption-spec.md.

- [x] Authority identity and cross-chain trust from `@bananapus/nana-sdk-core/safe`; the handle authority reads the
      Safe's creation record from the project chain's Safe service (client and server); R90 line for an unproven Safe.
- [x] Same-address Safe deployment from the SDK (`prepareSafeSameAddressDeployment`).
- [x] Safe transactions and the service from `@bananapus/nana-sdk-core/safe-service`: queue card and tray guarded
      by `hasSafeService`, current owners for confirmations, refund transactions refused (R93), execution confirmed
      only by `safeExecutionResult` for the reviewed hash (EOA executions and Safe connector replies).
- [x] Distribution receipts from `@bananapus/nana-sdk-core/v6` (payouts and reserved tokens with their splits).
- [x] Tests ported to the call sites; spec tests added; gate; budget. The controller pushes and opens the PR.

### Review

The local copies are gone: `cross-chain-authority.ts`, `safeDeployment.ts`, `safe-queue.ts`, `safeOwners.ts`,
`payout-receipts.ts` and the MultiSend codec. What stays in revnet is wiring: `handle-authority.ts` (the creation
record for the handle authority, the R90 line) and `safe-transactions.ts` (the proposal origin, the R93 and
no-service lines, and `confirmSafeExecution`). Kept stricter than the SDK: no refund in the reviewed execution's
event, a JSON number nonce in an obsolete proposal's record, and the rejected recipient events of any project.

Gate: dependencies, dead code, environment, deployment, types, lint, formatting ratchet, source, protocol and
wallet-write checks pass; unit and coverage 1,811 passed, one skipped; browser build, standalone and browser checks
(121 passed, four skipped); the production build passes last. All client JavaScript measures 2,640.0 KiB, so its
budget rises from 2,627 to 2,641 KiB (the SDK's checks are larger than the copies); route budgets are unchanged.

### Fix round 1

- [x] The route server reads the Safe service once, within 4 seconds, and refuses a 429; creation records are cached
      per chain and Safe (24 hours when they prove the Safe's address, 60 seconds otherwise), in the page too.
- [x] The canonical handle counts only when its own route resolves it to the project.
- [x] A Safe proposal settles only when what executed, or what the service records, runs the reviewed calls; the
      approval count uses the current owners and the live threshold.
- [x] A reverted execution or an ExecutionFailure settles failed and may be sent again.
- [x] The Ethereum handles row of an unproven Safe shows the R90 line; the refund refusal is tested in each action.
- [x] The source scans parse once (persisted queries) or get a 60 second timeout (ERC-20 approve).

Gate on the final commit: the same checks pass; unit and coverage 1,833 passed, one skipped; browser checks 121
passed, four skipped; the production build passes last. All client JavaScript measures 2,641.3 KiB, so its budget
rises by 1 KiB to 2,642 KiB. Left closed: the SDK's `multiSendCallsOf` knows MultiSendCallOnly 1.3.0 only, so a
1.4.1 Safe's batch stays unconfirmed.

### Fix round 2

- [x] A Safe proposal whose result can't be confirmed (a 1.4.1 batch, a relayed execution, another call) ends its
      watch in a marked state that reloads leave alone; it still refuses the identical call until its account
      dismisses it from the account's activity. Proposals journaled before the reviewed calls keep the earlier rule.
- [x] A reverted execution's line says only that this execution ran nothing; an ExecutionFailure says the call failed.
- [x] Checks of one Safe that start together share one creation record request.

Gate on the final commit: the same checks pass; unit and coverage 1,839 passed, one skipped; browser checks 121
passed, four skipped; the production build passes last. All client JavaScript measures 2,641.5 KiB, within 2,642 KiB.
SDK 2.20.0 teaches `multiSendCallsOf` MultiSendCallOnly 1.4.1; a follow-up takes it.

### Fix round 3

- [x] An unconfirmed proposal's card, and its Dismiss, stay in the account's activity once its hash is indexed.
- [x] Every proposal the app can't follow ends unconfirmed: a chain without a service after a minute; a proposal the
      service never lists, a record it can't authenticate, one reported executed without its transaction, one whose
      nonce another transaction took, or a receipt that never comes, when the watch gives up or an hour after the
      proposal was made. A proposal awaiting approvals, or behind an outage, is followed on the next load.
- [x] An identical call refused by an unconfirmed proposal says to check it in Safe and dismiss it.
- [x] The reload filter is the only guard against watching a marked entry again, and its test fails without it.
- [x] Every creation record read, the page's too, is one 4 second try with a 429 refused.

Gate on the final commit: the same checks pass; unit and coverage 1,849 passed, one skipped; browser checks 121
passed, four skipped; the production build passes. All client JavaScript measures 2,641.9 KiB; the budget rose by
1 KiB to 2,643 KiB when a build measured 2,642.0 KiB at the old budget.

### Fix round 4

- [x] No Safe proposal ends unconfirmed on one look. With a service, it ends at the first look an hour after it was
      made once 120 looks in a row (ten minutes) could not follow it. Not listed, a record it can't authenticate and
      executed without its transaction count from the watch's first look, so such a proposal ends an hour after it
      was made, or ten minutes into its watch if that is later; the nonce is read only after the hour, so a nonce the
      Safe moved past ends it ten minutes after the hour at the earliest, and the service's report of its own
      execution settles it meanwhile. Without a service, every chain check of the minute must find no transaction;
      a check the node can't answer leaves it live.
- [x] A missing execution receipt's hour counts from when the execution was first seen, not from the proposal.
- [x] The Safe's nonce is read at most once a minute, through the reader the owners and threshold use.
- [x] A refusal by an unconfirmed proposal, a dependent step's too, says to check it in Safe and dismiss it, and every
      flow shows it as an error; the loan permission toast says why the grant failed.
- [x] The no-service, no-client rule and the single call's unconfirmed refusal have tests that fail without them.

Gate on the final commit: the same checks pass; unit and coverage 1,860 passed, one skipped; browser checks 121
passed, four skipped; the production build passes last. All client JavaScript measures 2,642.2 KiB, within 2,643 KiB.

### Fix round 5

- [x] A look that learns nothing (the service down, the nonce unreadable, a chain check the node can't answer)
      neither counts toward ending a proposal nor starts the count over; only a look that shows it live (listed
      unexecuted with its nonce still to come) does. Without a service, the watch keeps checking the chain once a
      minute after its first minute, up to the hour, and twelve checks that find nothing end the proposal.
- [x] The chain is checked on every look of the watch's first minute and then once a minute, and once more before
      the watch ends a proposal on its looks, so an execution sent at once that a node shows late settles.
- [x] The loan dialogs (the permission step, the loan, refinancing and repayment) give a step refused by an
      unconfirmed proposal the title "Safe proposal unconfirmed" and a status line that says to check it in Safe
      and dismiss it, never a denial or a failure.
- [x] The once-a-minute reader says why it keeps one read.

Gate on the final commit: the same checks pass; unit and coverage 1,869 passed, one skipped; the production build
passes last. All client JavaScript measures 2,642.6 KiB, within 2,643 KiB. Browser checks: 120 passed, four skipped,
and one viewport of the handle route test failed with React's "Connection closed" (#412) under a load average of
about 47; rerun alone, two other viewports failed the same way, and rerun alone with one worker, all five passed.

### Fix round 6

- [x] A Safe proposal ends unconfirmed only on the chain's answer: this look's own chain check, or one more, must
      say no execution of the reviewed calls is there. While the node can't answer, the end waits for the next
      once-a-minute chain check, and a watch that gives up while waiting leaves it for the next load. Without a
      service, the twelfth check's own answer ends it, with no other call.
- [x] A service outage and an unreadable nonce are tested not to count toward an end, and a 2xx service page that
      isn't JSON learns nothing too.
- [x] A proposal the service reports executed without its transaction ends with that report in its line.
- [x] The receipt hook reports a proposal whose result can't be confirmed as neither loading nor settled; the loan,
      repayment and pay flows left open over their own such proposal show its line instead of pending.
- [x] A refinance whose permission read fails ends in the error state instead of holding its dialog.

Gate on the final commit: the same checks pass; unit and coverage 1,880 passed, one skipped; browser checks 121
passed, four skipped; the production build passes last. All client JavaScript measures 2,643.0 KiB, under 0.05 KiB
from the 2,643 KiB budget, which rises by the minimum 1 KiB to 2,644 KiB.

### Fix round 7

- [x] Only the chain's answer counts toward a missing execution receipt's hour: a read that finds no receipt, or a
      receipt of another transaction, which never settles the proposal. A node that can't answer leaves it held,
      and an end of an execution the service reported keeps "Safe reports this proposal as executed".
- [x] The bridge, cash out, burn, liquidity removal and split recipient flows show the unconfirmed line over their
      own such proposal; the identical call stays refused until it is dismissed.
- [x] A test pins that the pay card holds the payment while its own proposal is pending.

Gate on the final commit: the same checks pass; unit and coverage 1,891 passed, one skipped; browser checks 121
passed, four skipped; the production build passes last. All client JavaScript measures 2,643.3 KiB, within 2,644 KiB.

### Rebased onto main (2026-10-06)

- [x] Rebased onto origin/main after #65 (Check deployment in Extras) and #66 (production audit advisories); the
      task notes and the client budget comments keep both sides. The budget rises from main's 2,628 KiB to 2,644 KiB.

Gate on the rebased branch: dependencies installed with npm 12.0.1 from main's lockfile; the same checks pass,
including #66's Para source checks; unit and coverage 1,907 passed, one skipped; browser checks 121 passed, four
skipped; `next build --webpack` passes last. All client JavaScript measures 2,643.4 KiB, within 2,644 KiB.
