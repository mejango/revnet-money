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

## Relayr sessions decided from the chain, through the SDK rules (2026-10-06, W2-RVR)

Reference: jbm 98c9409d src/lib/relayr.ts (executeRelayrCalls, savedRequestsVerdict, liveSessionVerdict,
holdUnprovenSession, discardableSession, relayrHeldMessage, RelayrDiscardError, revertedRelayrQuote),
src/lib/forwarder-authorization.ts, src/lib/launch-relayr.ts. Rulings R104, R114 (a-f), R117, R118.

- [x] Take SDK 2.22.0 (lockfile: only the package's version, resolved and integrity).
- [x] Tests first, red on the current code: a device-clock release never signs at the live nonce; a request that
      ran gives the "ran" Discard and no signature; every request dead and unused runs the recheck and signs again
      at the saved nonces; an unreachable recheck holds; a sped-up payment proves.
- [x] The SDK's payment details and payment proof replace paymentDetails and verifyPaymentReceipt; a payment proves
      on the hash it was mined under.
- [x] Each session saves the nonce each request was signed with. Its action classifies it (relayrSignedRequests,
      relayrRequestStates, relayrRequestsVerdict) before its recheck, and relayrSessionOutcome decides: reuse or
      re-quote the saved signatures, hold, sign again at the saved nonces, or Discard. No device clock releases a
      session; another session reserves a forwarder nonce, a call or a recovery scope while a request is live.
- [x] A replacement in the same recovery scope (the stale-start launch rebuild) signs at the replaced session's
      saved nonces, so only one of them can run.
- [x] A quote whose payment reverted is released only as jbm does (R104): payments proven reverted, deadlines passed
      at a canonical block, and Relayr read unpaid right before; Relayr reporting it funded holds it and proves what
      ran. A declined retry of such a quote stays on the retry rule.
- [x] A paid bundle that can't be proven holds while a request is live and is marked for Discard once all are dead.
- [x] The account view checks an unpaid session's signatures and offers Discard for a session marked for it.
- [x] Gate: lint, typecheck, wallet-writes:check, knip, test:ci, browser suite, build:browser.

### Relayr session rules review

Every session decision goes through the SDK: relayrSignedRequests, relayrRequestStates and relayrRequestsVerdict
classify a session at a canonical finalized block before its action's recheck, relayrSessionOutcome decides, and
relayrRequestsDead decides whether a session that shares only a forwarder nonce still reserves it. Nothing is
released by the device clock, and a new signature for saved calls goes only to a saved nonce. 29 behavior tests failed
on the code before these commits (the five the brief names among them) and pass after them; 5 more changed only in
shape, since the scope check is async and the relayed launch passes its chains to it.

Gate on the final commit: lint, typecheck, knip, wallet-writes (140 sites), format ratchet and source checks pass;
unit and coverage 2,094 passed, one skipped; build:browser, standalone and bundle checks pass; browser checks 126
passed, four skipped, inside the shared gate lock. All client JavaScript measures 2,644.2 KiB against 2,641.7 KiB for
origin/main's sources on the same SDK; the aggregate budget rises by the minimum 1 KiB to 2,645 KiB.

### Relayr session rules fix round 1 (ruling R114 (g))

- [x] Different calls never sign at an old session's nonces while one of its requests can run: no refresh by
      recovery scope, no `replaces`, no device clock. A live session holds another action, saying until when.
- [x] The stale-start launch rebuild and a resubmitted launch wait until every request of the earlier launch is dead
      at a finalized block, then build and sign the new one (jbm's abandonable rule).
- [x] A raw or Safe quote is released only after Relayr reads it unpaid (jbm payer-relayr.ts:457-463).
- [x] A "ran" Discard abandons a pending batch by its round's scope as well as its bundle.
- [x] A paid bundle Relayr leaves pending is classified once every request is dead; completion clears a Discard mark,
      and a completed card offers no Discard.

Gate on the final commit: lint, typecheck, knip, wallet-writes (140 sites) and the format ratchet pass; unit and
coverage 2,106 passed, one skipped; build:browser, standalone and bundle checks pass (2,644.1 of 2,645 KiB);
browser checks 126 passed, four skipped, inside the shared gate lock. 20 tests failed on the code before the round.

### Relayr session rules fix round 2

- [x] A replaced session keeps no Discard mark, and a replaced quote's card offers no Discard.
- [x] A Discard matches a batch round by the session's bundle, and by recovery scope only when Relayr named no bundle.

Gate on the final commit: lint, typecheck, knip, wallet-writes (140 sites) and the format ratchet pass; unit and
coverage 2,109 passed, one skipped; build:browser, standalone and bundle checks pass (2,644.1 of 2,645 KiB); browser
checks 126 passed, four skipped, inside the shared gate lock. 3 tests failed on the code before the round.

## The SDK's reverted-quote rules (2026-10-06, W3-REL2-RVN)

Reference: SDK 2.23.0 `review/relayr` ("Quotes whose payment reverted"), jbm 27c40e98 src/lib/relayr.ts
(requireRelayrRetry, relayrRetryOption, proveSavedRelayrPayment, relayrPaymentAttemptOutcome, revertedRelayrQuote).
Ruling R104; R89 (nothing loosens silently).

- [x] Take SDK 2.23.0 (lockfile: only the package's version, resolved and integrity).
- [x] `sentPayments` moves beside `relayrSessionRequests` in src/lib/relayr-activity.ts (no behavior change).
- [x] revertedRelayrQuote, quoteUnfundable, quotedOptions, deadlinesPassed, requirePaymentRetry, the declined
      payment's catch and provePayment's proof are the SDK's. A saved payment `{ hash, chainId, target, data, value }`
      is read into the SDK's `RelayrSentPayment` once, in `relayrSavedQuote`; its deadline is the calldata's
      deadline word.
- [x] provePayment keeps revnet's outcomes over `proveSavedRelayrPayment` (which resolves false where it threw):
      no recorded payment is a manual verification, an unprovable one throws so the poll keeps checking, a revert
      marks the quote reverted.
- [x] A quote paid sixteen times is never paid again (the SDK's journal limit; revnet had none).

### Review

Behavior changes, each pinned by a test that failed on the code before: a quote is payable by its latest payment's own
deadline (jbm's rule) instead of the quoted option it matches, so a quote that no longer lists the paid option is
released once its deadlines pass at a finalized block, and held with "cannot be paid again from its saved record"
while payable; a bundle read that reports a payment without listing calls is not funded (the retry check still
refuses it); a wallet rejection is read as the SDK reads one (viem's name counts, eight causes deep at most); a saved
payment is read strictly (decimal amount, strict address); a missing RPC for a sent payment's chain refuses the retry
with the SDK's line. The SDK changeset's other differences cannot arise: revnet's payments are saved from the SDK's
own authenticated details, its bundle IDs come from a bound quote, and the deadline is derived from the calldata.

SDK gaps, kept local until it exports them: `relayrBundleFunded` (the poll of a quote whose own payment reverted
reads the bundle it just fetched) and the release of an unpaid raw or Safe quote at finalized blocks (the SDK's
`revertedRelayrQuote` needs a sent payment).

Gate on the final commit: lint, typecheck, knip, wallet-writes (140 sites), format ratchet, source and deployment
checks pass; unit and coverage 2,128 passed, one skipped; build:browser, standalone and bundle checks pass; browser
checks 126 passed, four skipped, inside the shared gate lock. All client JavaScript measures 2,645.0 KiB against
2,644.2 KiB for origin/main's sources on SDK 2.22.0 (2 bytes over the old 2,645 KiB budget); the aggregate budget
rises by the minimum 1 KiB to 2,646 KiB. 15 tests failed on the code before these commits.

## 2026-10-06 — Pretty queued Safe confirmations
- [x] Extract the existing canonical protocol decoder without changing queue labels.
- [x] Reuse decoded queued calldata for nested review cards in single execution, Relayr execution, and queued signing.
- [x] Verify known actions, unknown/malformed fallback, and confirmation rendering; run focused tests and typecheck.

Review: 135 focused tests pass, including four-chain queued calldata and rendered consent/order regressions. Typecheck, changed-source lint, and wallet boundary checks pass. Cleared a stale generated Next route type after route-type regeneration. Independent review found no substantive issue. Changes are local; not deployed.

## 2026-10-06 — Paced Safe checks, final verification
- [x] Overlap independent checks with a two-worker limit in queue preparation, Safe Relayr quoting, and payment rechecks.
- [x] Preserve request order, sequential wallet signatures, and failure gating; drain pending checks before retry.
- [x] Test concurrency limit, overlap, stable ordering, and payment blocking.

Final review: 1,567 tests passed in the full run; three live-schema tests initially failed due sandbox DNS, then all three passed in narrowly approved network reruns after inspecting their read-only payloads. One pre-existing test remains skipped. Typecheck, changed-file ESLint and wallet boundary checks pass. Both clients now have readable queued confirmations and paced overlapping checks. No deployment performed.

Rebase verification: integrated origin/main c668b8ed and SDK 2.23.0, keeping SDK-owned canonical MultiSend decoding and the newer Relayr recovery checks. Readable actions now live in the shared TransactionReviewDialog. 2,138 local tests passed; three loopback RPC tests blocked by sandbox permissions passed on a permitted rerun. Typecheck, changed-file ESLint, and wallet boundary checks pass. Confirmed queued signing retains its readable metadata after conflict resolution.

## 2026-10-06 — Pending routing belongs to the destination
- [x] Query and validate retained payments by destination project, preserving source metadata in retry calldata.
- [x] Cover source 6 → destination 1, unrelated destinations, and multi-source incoming payments.
- [x] Verify reader/component/operation tests, typecheck, and matching JBM correction.
Plan review: correct the existing query owner and boundary validation; no contract behavior change.

Destination-routing review: 30 reader/component/operation tests passed; typecheck, changed-file ESLint, fixture syntax and diff checks pass. Query and validation use destination projectId; sourceProjectId remains unchanged in commitments and calldata. Query cache key distinguishes destination-scoped results. Browser fixture now uses source 6 / destination 1; browser scenario updated, not run.

## 2026-10-06 — One Relayr bundle for pending payments
- [x] Preserve permissionless gateway retries as independent raw entries; allow repeated destination chains only for authenticated pending-routing calls.
- [x] Quote and fund all eligible retries in one bundle, binding records by quote transaction ID rather than chain.
- [x] Keep per-payment custody/receipt checks, pre-funding revalidation, and saved-bundle recovery; preserve forwarder nonce rules and Safe fallback.
- [x] Update both clients' batch review and test same-chain bundles, cooldown exclusion, exact mapping, failures and resume.
Plan review: use the existing raw Relayr lifecycle. Each payment remains its own destination transaction; no atomic multicall wrapper. Existing local simulation bounds remain; Relayr chooses the actual execution gas.

- [x] Discover legacy saved routing attempts by their authenticated destination, preserving original scope, transport, hashes and resume state. Recover all-handled journals interrupted before completion.

Review: 2,152 local tests passed and one skipped (live schema and loopback RPC suites excluded for the sandbox); final focused verification passed 74 tests after the saved-recovery correction. Typecheck, changed-file ESLint, wallet boundary checks, format ratchet and diff checks pass. JBM reports 2,542 tests passing plus typecheck, lint and source/inventory checks. Same-chain raw entries share one funding payment and retain per-call receipt mapping, including canonical reverted attempts. Saved source-6 attempts now appear on destination 1 without rewriting recovery records. Changes are local, not pushed.

## 2026-10-06 — Distinguish pending inventory from saved routing selection
- [x] Split discovery from paced verification so indexed rows show immediately with a checking state.
- [x] Label the resume button plainly and separate saved progress from the pending total.
- [x] Preserve submission gates and resolved-row filtering; cover delayed seven-payment inventory plus three saved calls and per-row RPC errors.
Review: 27 relevant tests pass; typecheck, changed-file ESLint and diff check pass. Both query stages share an invalidation prefix and use new cache keys for their new shapes. Follow-up remains local, not pushed.

## 2026-10-06 — Replace untouched routing drafts
- [x] Distinguish untouched drafts from submitted, funded, published, ambiguous or handled attempts.
- [x] Review the full current selection and replace the exact draft under the account lock after reservation checks and an atomic journal comparison.
- [x] Freeze reviewed identities, preserve recovery on failure, and require a fresh review after replacement errors.
Review: 63 engine tests and 14 routing component tests pass; reviewed Relayr suite passed during engine validation. Typecheck and changed-file lint pass. Regression coverage includes late submission evidence, lost publication responses, cancellation, changed journals, and failed replacement retries. Changes remain local, not pushed.

## 2026-10-06 — Read-only routing recovery checks
- [x] Return saved calls and a specific state-based reason in recovery metadata; decode exact authenticated calls for the confirmation.
- [x] Recheck once per saved selection and on request without signing/paying; reuse reservation proofs and reset only unpaid expired quoted rounds under account lock and journal comparison.
- [x] Preserve unknown submissions/funding/missing evidence and freeze open review identity across checks.
Review: 200 engine/Relayr tests pass; 17 UI tests and 15 pending-call tests pass, with typecheck, changed-file lint and diff checks. A screenshot cannot identify the local journal state; the UI now reports its real reason instead of generic zero-handled copy. Changes are local, not pushed.

## 2026-10-06 — Prepare Safe execution on open and pace RPC egress
- [x] Extract preparation without behavior change (19 baseline tests), then start it when Execute all opens.
- [x] Keep explicit quote review and separate payment confirmation; show payment chain options and decoded actions.
- [x] Pace browser RPC starts by 125ms across chains/retries without waiting for responses; all independent checks overlap and drain before error/payment.
- [x] Test cancellation, delayed quote, account changes, retries, error ordering, queued abort and 429 cooldown.
Review: 23 Safe dialog/card tests pass and 145 transport/check/Relayr tests pass. Broad sandbox-safe suite: 2,195 tests passed plus one skipped; sole failure was the stale copy-debt record from removing the pending-call middot, corrected and its six tests now pass. Live schema and loopback RPC files excluded. Typecheck, changed-file ESLint, format ratchet and wallet-boundary inventory pass; quote owner inventory updated from executeAll to prepareAll. JBM full suite: 2,576 tests pass. Not pushed.

## 2026-10-06 — Resume saved Safe quotes instead of retrying creation
- [x] Match complete chain/Safe/hash/nonce intent sets while keeping the original quote, UUIDs and signature calldata.
- [x] Revalidate original calls and show their nested decoded review; preserve all historical alias keys.
- [x] Protect legacy and current same-nonce reservations against changed signature/subset/alternative-hash attempts.
- [x] Offer structured existing-bundle checks for incompatible/paid/ambiguous records instead of Retry checks.
Review: 140 hook tests pass, plus 79 UI/activity/release/routing tests. Types and focused ESLint pass; wallet-boundary inventory remains unchanged. Existing quote recovery makes no new publication or payment. JBM has no equivalent persisted-unpaid-quote lookup deadlock. Local, not pushed.
