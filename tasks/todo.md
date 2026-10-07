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

## 2026-10-06 — Replace unfunded Safe quotes for the current selection

- [x] Trace the current Safe prepare path and storage adapter; coordinate the replacement rule with the shared SDK owner.
- [x] Consume the SDK's quote-only replacement result without implementing another app policy; retain actual or ambiguous funding evidence.
- [x] Cover four saved calls to three currently ready calls, lost quote response without funding, and funded/unknown recovery using the real hook and storage adapter.
- [x] Run focused tests, typecheck, lint and relevant source/wallet checks; record the verified result.

Review: both saved-quote and lost-response four-to-three flows review the current calls, post a fresh bundle, and fund once. Archived quotes cannot be funded; canceled review preserves the old record. Legacy remote execution observations and funding flags remain sticky across reloads. Final focused suites pass 205 tests; the full run plus bounded reruns verifies 2,266 tests with one existing skip. The reruns covered six sandbox-blocked network/loopback tests and the final copy change. Types, touched-file lint, source invariants, wallet inventory and diff checks pass. Release and dependency publication are tracked by the parent task.

Published-install verification: SDK 2.24.2 and the reified lockfile installation were tested on Node 26.7.0. The full suite passed 2,265 tests with one existing skip; its only failure was a stale generic-message assertion, replaced with the shared funding-unresolved result, sticky observed-funding flag and refusal to quote again. The final 205-test focused rerun passes, giving 2,266 verified tests and one skip. Full typecheck, lint, source guards and the 142-site wallet inventory pass. No production code changed during this final verification.

## Plan refinement

- **Objective:** Opening Execute all should review and quote the currently ready Safe selection even when an earlier quote-only record exists; actual or ambiguous funding must still recover without paying twice.
- **System fit:** SafeQueueCard collects live ready transactions, the reviewed hook delegates lifecycle decisions to the SDK, and the RNM adapter preserves journal evidence; the shared SDK remains the owner of replacement and funding gates, while explicit review and payment authority stay unchanged.
- **Reuse and simplicity:** Reuse the existing SDK prepare path and storage adapter; add only necessary release-copy integration and regression coverage, without another discard action or app-side replacement heuristic.
- **Evidence and unknowns:** The user's three-current/four-saved screenshot proves that the historical selection still blocks progress after 2.24.1; the agreed SDK contract replaces overlapping quote-only sessions after current-call review, retains them as quote-replaced, and protects fundingObserved or remote execution evidence. RNM will normalize legacy chainStates into shared records rather than classify statuses itself.
- **Verification:** Exercise actual prepare/storage/reload for four-to-three replacement and missing quote responses, assert current exact calls are reviewed/posted before any wallet payment and funded once only after explicit consent, and retain malformed, submitted and hashless-funding refusal regressions.
- **Resource budget:** Investigate RNM while the SDK policy is resolved in parallel; make the smallest adapter change, then run focused tests/types/lint against the preview. Repeat the full suite and static gates on the published 2.24.2 installation because npm reified dependency entries beyond the SDK archive; bound any subsequent rerun to a concrete failure.


## 2026-10-07 — Load operator accounts and Safe queues independently

- [x] Share display-only Safe identity queries per chain/address; retain fresh action checks.
- [x] Show per-chain discovery/account/queue progress and overlap independent queue reads.
- [x] Surface transient verification failures with per-chain retry, withholding actions until verified.
- [x] Verify deduplication, slow-chain independence, retry recovery and unchanged action safety.
- [x] Display shared quote/payment/execution phases, preserve each verified chain on recovery, and move the fee control to the footer.
- [x] Require successful bounded neutral-caller Safe simulation before quoting and payment.

Plan refinement (approved by parent): Account and queue already mount independently, but each repeats the full SDK identity proof and aggregate promises hide faster chains. Reuse React Query as the display read owner and retain bounded SDK proofs. Preserve the existing complete operator map for write consumers while exposing a partial discovery map only to Account/Queue. Begin read-only service discovery after the bounded nonce while identity and live authority checks run; expose transactions only after every proof completes. No SDK or RPC pacing changes. Test deferred and failed reads with real query caching; run focused component tests, types, lint and source/wallet gates.

Follow-up scope from the user: consume the SDK's quoting phase after the actual Safe review acceptance so the modal says “Requesting Relayr quote…” while Relayr responds; move the network-fee selector after the execution list into the confirmation footer. Reuse the shared lifecycle and dialog footer; leave quote/payment policy unchanged. Regress delayed quote, cancellation and the fee control's final placement.

Further same-flow corrections: consume shared SDK lifecycle progress for quote phases, per-chain hashes and receipt verification; paid or ambiguous failures return to read-only Check status. Keep verified execution distinct from a Relayr success report. Align RNM preflight with JBM by using the SDK's bounded neutral-caller simulation and requiring execTransaction=true; test false/malformed results before quote and before payment. These fixes keep state ownership in the SDK and do not retry payment implicitly.

Review: against the final frozen SDK distribution, the full suite passes 2,282 tests with one existing skip. Two subsequent review regressions cover repeated recovery subscribers and failed identity refreshes; the final 272-test focused rerun passes, giving 2,284 verified tests. Typecheck, touched-file ESLint, source invariants, source-only dependency audit, unchanged 142-site wallet inventory and diff checks pass. The actual SDK/hook test proves one chain can remain Confirming while another is Executed, closing/reopening recovery retains both states, delayed receipt proof completes on watch, and the wallet sends once. The display-query test proves cached successful identity is hidden after failed refresh and retry restores it. SDK controller reuse retains verified progress through fund/watch; display-only snapshots replay for new subscribers. Production/browser builds and published-package verification belong to the parent release task. No commit or push performed here.

Browser verification refinement: the queue now probes bounded nonce concurrently with account identity. Its exact EOA fixture call (owner 0x1111111111111111111111111111111111111111, nonce() selector 0xaffed0e0, gas 100,000, latest block, no sender) must return empty data as Ethereum does. The fixture accepts only that tuple, retains unknown-request rejection, and adds negative cases for changed target, selector, gas, sender and block. Product code is unchanged. With the frozen SDK candidate, 13 fixture unit tests and the focused operator browser case pass; the complete production browser suite passes 126 tests with four existing skips. ESLint, source guards and diff checks pass. Evidence remains preview-only until official SDK 2.24.3 and installed dependency contents are reconciled.

## 2026-10-07 — Keep narrow liquidity visible with reference prices

## Plan refinement

- **Objective:** Include the authorized liquidity reference markers in this release while keeping funded LP ranges visible when reference prices widen the graph axis.
- **System fit:** AmmCard displays existing pair-token-denominated reference prices and LP composition; only histogram sampling changes, with all amount calculations and transaction authority unchanged.
- **Reuse and simplicity:** Reuse the existing per-band tick intersection and weight each range by its covered fraction; retain existing reference filtering and logarithmic marker placement.
- **Evidence and unknowns:** The supplied 0.5/2 reference fixture brackets a -100/100-tick range, but none of 48 band midpoints intersects it, hiding all bars. Both pair orientations need the same normalized intersection.
- **Verification:** Assert nonzero symmetric partial-band bars for both pair orientations; run liquidity depth/presence/range tests, types, focused lint and diff checks.
- **Resource budget:** One small sampling change and one parameterized regression; production/browser verification resumes with the release owner after source freeze.

- [x] Regress widened-axis narrow ranges for both pair orientations.
- [x] Weight existing tick intersections and verify focused checks.

Review: discovered and reproduced missing depth bars when the reference-price axis [0.5, 2] surrounds a narrow -100/100-tick LP range. Both orientation regressions failed with zero bars before the fix and now pass with two positive symmetric partial-band bars; marker positions remain unchanged. Liquidity now averages the existing tick overlap across each logarithmic bucket. Token/pair amount calculations and reference sources are unchanged. All 16 focused liquidity tests, full typecheck, touched-file ESLint and diff checks pass against the published SDK 2.24.3 installation. Runtime source frozen at AmmCard.tsx SHA256 2f951e84492ee69a9a2489a3bb5ae1910749f5d44488d927a241dccdea308abb; release owner handles combined production/browser verification and commit.

Final published-release verification: official SDK 2.24.3 tarball integrity and all 745 distribution files match the tested candidate; the full installed graph differs only in SDK version/lock metadata and Vitest result timing cache. A fresh physical snapshot includes the reviewed liquidity-price graph and interval-overlap regression fix (AmmCard SHA256 2f951e84492ee69a9a2489a3bb5ae1910749f5d44488d927a241dccdea308abb). On pinned Node 26.5.0/npm 12.0.1, production build and standalone checks pass, and the complete browser suite passes 126 tests with four existing skips. The final 113,074-entry dependency hash remains unchanged and product sources match the workspace.

Bundle review: the matched HEAD 909cf1fd/official SDK 2.24.2 baseline measures 2,717,526 bytes gzip; final combined SDK/account/progress/liquidity changes measure 2,725,587 bytes (+8,061). Only the aggregate ceiling moves from 2658 to the minimum 2662 KiB. Largest operator route is 716,852 bytes and unique route JavaScript is 955,660 bytes; route and wallet lazy-loading limits remain unchanged. Final budget, touched-script lint, source invariants and diff checks pass. All comparison/source/dependency manifests and logs are under /tmp/safe-progress-final-verification.y3xQVa. Remote Linux CI and live revision checks remain parent-owned.

CI formatting correction: run37570565542 rejected one wrapped expression in AmmCard.tsx under the repository's formatting ratchet. The pinned formatter changed only that expression's line break; no formatting debt or baseline changed. The full formatting ratchet, changed-file lint and diff check pass. The new revision's complete hosted build/browser/OCI gates and live check remain required. The earlier production result remains evidence for the behavior, not a substitute for the final revision's checks.

## 2026-10-07 — Make concurrent Safe status readable and preparation passive

- [x] Put each chain's independent status beside its heading, with batch and call details below.
- [x] Hide action buttons during automatic preparation while keeping the close control and Escape available.
- [x] Verify checking/quote controls, dismissal and payment/recovery behavior with existing component suites and static gates.
- [ ] Inspect desktop/mobile renderings and affected production artifact, then publish and verify exact CI/live revision.

Plan review: apply the approved workspace refinement for the Safe modal UX correction. Existing SDK state remains authoritative; optional TxSteps heading status is presentation-only, and TxConfirmDialog accepts a null action for phases that advance automatically. Other dialogs retain default actions and sequential-step semantics. No transaction, request, funding, cancellation or recovery rules change.

Review: status text is now readable at the chain heading, separated from the batch label and call details, and announces chain context without rereading the whole list. Automatic checks/review/quote preparation keep the current steps and one phase message visible with no idle action/footer; header Close and Escape stay available. Quoted and paid/recovery controls remain intact. All67 focused queue/dialog/UI tests, full typecheck, touched-file ESLint, complete formatting ratchet, source invariants and diff check pass. Independent runtime review found no blockers. Desktop/mobile visual inspection and exact production/deployment checks remain with the coordinator.

Visual correction: a four-chain quoted desktop capture exposed existing fixed cross-axis centering clipping the header/close above the viewport. The standalone card now uses desktop automatic vertical margins while its dialog remains start-aligned, preserving centering for short cards and scrollable access for tall cards. Hosted dialogs retain their existing geometry. Final screenshots and production verification include this two-class correction.

Visual/build verification: real four-chain modal output with three decoded calls per chain was captured in checking, quoting and quoted states, then rendered with the app's freshly compiled CSS and actual fonts at desktop and390px mobile widths. All captures have no horizontal overflow or browser/font errors. Quoted desktop Close now starts at y33 instead of y-39.75, and the payment action is fully reachable by scrolling. Temporary capture instrumentation was restored byte-for-byte. The final production and standalone build passes unchanged bundle/lazy-loading gates at2,725,748B gzip (+161B); no Revnet budget change is needed. Runtime snapshot sources match the workspace. Evidence: /tmp/safe-modal-visual/visual-verification.json and /tmp/safe-progress-final-verification.y3xQVa/revnet-modal-final-proof.json. Exact hosted CI/live verification follows publication.

## 2026-10-07 — Cross-chain buyback-pool activity

- [x] Reuse the SDK grouping policy in the project feed, after filters and same-tx folding.
- [x] Keep each original chain transaction available from the grouped row.
- [x] Verify regression cases, layout, published SDK version and local release checks.

Scope refinement: Revnet's new aggregation applies to standalone buyback-pool setup rows, the reported duplicate configuration activity. Its financial rows and mixed-action transactions retain their original rows because the mapper abbreviates some token counts and does not carry sufficient exact cross-chain economic identity. Juicebox's extraction preserves all current matching behavior. Both consumers use the shared six-hour/distinct-chain policy; the UI does not infer a remote bundle ID.

Activity review: five integration regressions use the real shared SDK and the reported public transaction hashes. All four pool events become one row with four accessible explorer links; actor/time/chain isolation, financial precision, mixed transactions, filters and pagination remain correct. Existing46 feed/account/home regressions, types, lint, full formatter ratchet, source and dead-code checks pass. Actual CSS/font screenshots at300px sidebar and390/320px viewports have no overflow and retain24px chain-link targets. Official2.24.4 incorporation and production/release verification remain pending.

Activity build review: controlled preview production and standalone builds pass with the same physical dependency graph apart from the reviewed SDK grouping export. Aggregate client JavaScript measures 2,726,333 B versus 9d88fecc's 2,725,748 B (+585 B); only the minimum aggregate ceiling moves from 2662 to 2663 KiB. Largest route 717,658 B, unique route JavaScript 956,427 B and all wallet lazy-loading guards retain their existing limits. The updated budget gate, checker lint and diff checks pass; all 113,082 physical dependency entries remain identical after the build. Actual public activity captures at 1280/390/320px show four rows becoming one, all four original explorer URLs, 24px link targets and no overflow. Temporary capture tests are removed. Final official 2.24.4 archive/input equality and exact hosted CI remain required; preview evidence is not yet final release proof. Evidence: /tmp/cross-chain-activity-verification/visual-verification.json and revnet-preview-proof.json.

Official package qualification: both manifests pin published core2.24.4 with verified registry integrity. All753 distribution files equal the tested preview; unrelated dependencies and runtime source are unchanged. The measured production/standalone artifact remains valid under exact input comparison, with only approved version/lock metadata differences and the2663KiB aggregate ceiling. Final official-package rerun passes all51 activity tests, types, affected lint and full formatting ratchet. Hosted CI and exact live revision checks are tracked by the workspace release checklist.


## 2026-10-07 — Keep anonymous browsing free of wallet initialization

- [x] Remove only the root provider's idle Para mount; preserve intent preload, sign-in/add-funds, and marked-session restoration.
- [x] Add wallet-enabled provider regressions covering native idle and timeout fallback after page load, intent preload, explicit requests, and marked sessions.
- [x] Verify the focused wallet suites, touched lint, full types, and source invariants; production build/browser evidence belongs to combined integration.

Plan review: use `/Users/jango/Documents/jb/v6/evm/docs/WEBSITE_PERFORMANCE_IMPLEMENTATION.md` (refinement gate passed), root `AGENTS.md`, pinned `workflow/ponytail/SKILL.md`/`README.md`, `docs/PLAN_REFINEMENT.md`, and relevant root/app lessons. Existing Para context, lazy host, reconnect marker, and module preload already own the behavior; remove the conflicting unsolicited mount without introducing a second wallet loader. The new provider tests run with Para enabled, and both idle cases fail on the original provider while explicit requests and session verification pass. The installed Next16.3.8 lazy-loading guide confirms the existing conditional React.lazy boundary is appropriate.

Review: all 29 focused wallet tests pass, including the new provider idle regressions and existing connector restoration/auth/host behavior. Full types, touched-file ESLint, source invariants and the full formatting ratchet, and whitespace checks pass. Independent read-only review found no blockers. Existing browser builds intentionally disable Para, so these enabled-provider timing regressions provide the direct guard; a production-environment browser network capture remains part of combined integration verification. No build, dependency installation, push or deployment was performed in this worktree.

## 2026-10-07 — Reuse client project reads during navigation

Plan: [client performance refinement](performance-client-reads.md), gated by the workspace checker and coordinator before implementation. Separate behavior-preserving extraction: 9b3c4a18.

- [x] Consolidate public complete ruleset history in the existing TanStack cache and preserve aggregate/error semantics.
- [x] Render indexed descriptions while full metadata loads; bound mutable-controller freshness and chart identity.
- [x] Verify TTL reuse/expiry, explicit invalidation, errors/recovery, data-scope changes, hydration and unchanged transaction guards.
- [ ] Coordinator: integrate with server/navigation changes and run combined production/browser/release checks.

Review: 16 focused suites pass231 tests, with typecheck, touched-file lint, full formatter ratchet, source checks, dead-code checks and diff check. Raw histories are shared across three hooks; no new cache or dependency. Exact local evidence and remaining coordinator gates are recorded in the linked plan.

## 2026-10-07 — Reuse recent project diagnostics

## Plan refinement

- **Objective:** Reopening read-only deployment diagnostics within ten seconds reuses complete evidence for the identical chain/project/operator; explicit refresh, expired, changed, invalidated and failed evidence fetch again.
- **System fit:** ProjectDiagnosticsProvider owns the sole diagnostics query; its BFF combines independent deployment and indexer evidence, displays checked time/block, and never authorizes sends. Existing Retry checks and repeated Check operator use refetch; transaction authority and saved recovery stay unchanged.
- **Reuse and simplicity:** Reuse TanStack Query's existing complete key, built-in staleTime callback, deduplication and refetch. No second policy owner or new module is needed for one consumer; complete responses receive a ten-second lease while read failures or missing/incomplete indexed evidence remain immediately stale. Switching operators A to B to A may reuse fresh A evidence; repeated Check operator on unchanged A and Retry checks always fetch.
- **Evidence and unknowns:** Read workspace AGENTS.md, workflow/ponytail/SKILL.md and README.md, docs/PLAN_REFINEMENT.md, relevant workspace/app lessons and local Next caching docs. No descendant AGENTS.md exists. Baseline 81aeb708 uses staleTime zero; every caller and response fallback was traced. Installed Node 26.7.0 is available, required release Node 26.5.0 is absent; integrated pinned-toolchain release verification belongs to the coordinator.
- **Verification:** Render the real provider with a real QueryClient to prove fresh reuse, exact expiry, invalidation, changed identity, explicit refresh, in-flight deduplication and failure/degraded retry. Run existing diagnostics loader/route/index-status tests, full typecheck, focused ESLint, complete formatting ratchet and diff checks; no production build/deploy in this worktree.
- **Resource budget:** One isolated worktree at .worktrees/perf-revnet-preparation with existing node_modules symlink; edit only the owning component, its existing focused suite and this record. One focused regression pass plus repository static gates; replan if endpoint semantics or identities make bounded reuse unsafe.

- [x] Implement complete-result diagnostics freshness in its existing owner.
- [x] Verify rendered reuse and failure recovery with the real query cache and affected suites.
- [x] Record exact checks and commit the focused change for integration.

Review: complete diagnostics now reuse the existing chain/project/operator query for ten seconds. No new owner, key or transport cache was added. Explicit Retry checks and unchanged-operator Check still refetch; A/B/A selection can reuse the exact fresh A result. Null deployment, unavailable checks, missing/incomplete indexer evidence and failed refreshes remain immediately retryable; prior data is never displayed/copied after a failed refresh. Baseline regressions reproduced extra reopen/remount requests. Final verification: 33 tests passed across project-diagnostics, project-diagnostics-route, project-diagnostics-loader and project-index-status; full typecheck, focused ESLint, complete formatting ratchet (two unchanged debt entries) and diff checks pass. Read-only independent policy review found no authority-safety blocker. Verification used installed Node 26.7.0, TanStack Query 5.101.4, Next 16.3.8 and Vitest 4.1.10; exact pinned-toolchain/dependency integration and production/browser checks remain coordinator-owned. No build, install, push or deployment ran here.
## 2026-10-07 — Server project-read performance

Required workspace resources remain authoritative in this isolated checkout: `/Users/jango/Documents/jb/v6/evm/AGENTS.md`, `/Users/jango/Documents/jb/v6/evm/workflow/ponytail/SKILL.md`, `/Users/jango/Documents/jb/v6/evm/workflow/ponytail/README.md`, `/Users/jango/Documents/jb/v6/evm/docs/PLAN_REFINEMENT.md`, `/Users/jango/Documents/jb/v6/evm/tasks/lessons.md`, and this repository's `tasks/lessons.md`. Parent authorization and scope: `/Users/jango/Documents/jb/v6/evm/docs/WEBSITE_PERFORMANCE_IMPLEMENTATION.md`.

## Plan refinement

- **Objective:** Shorten project opening and repeat tab visits through shared indexed reads and progressive secondary rendering, while returning genuine missing-project HTTP errors before streaming and retaining retryable upstream failures.
- **System fit:** Server project/group readers own public indexed evidence consumed by metadata, layouts, tabs and previews. React request memoization shares one render; the existing TanStack dependency will own a process-local public display cache. Alias verification and final transaction authorization remain with their existing live owners; no wallet, account or send evidence enters this cache. Display invalidation follows metadata completion and explicit Retry.
- **Reuse and simplicity:** First extract the existing async layout body without changing its awaited behavior, prove regressions and commit it independently. Then reuse QueryClient.fetchQuery for exact family/chain/project-or-group keys, a 30-second freshness window, five-minute garbage collection, one in-flight read and no automatic retry. Only available indexer results are reusable; missing, incomplete and failed reads retain their original status and retry on the next request. Next unstable_cache is already used elsewhere but its stale-while-revalidate behavior can retain expired successes after failure, so it cannot enforce this bounded reuse rule without an additional stale-data protocol.
- **Evidence and unknowns:** Baseline is clean 81aeb708; installed Next16.3.8 loading and unstable_cache documentation/source confirms same-segment layout blocking and stale-while-revalidate semantics. Number/bigint keys currently split request memoization. Metadata invalidation runs immediately before its existing delayed refresh; Retry evicts the affected project and group, including unresolved group reads scoped by their requested tuple before membership is known. Eviction cancels known affected fills: supplied group IDs also identify pending peer reads, while unknown peer membership and other server processes retain the 30-second expiry backstop. Metadata refresh supplies each known group ID; public Retry never cancels unrelated pending reads. Indexer freshness itself is not a claim of onchain authority.
- **Verification:** Focused tests cover equal number/bigint callers, metadata/layout/page deduplication, chain/project separation, reuse through30s then fresh reads, negative/error/incomplete retry, explicit invalidation including a pending stale fill, and layout identity/not-found resolution before secondary streaming. Hold group/ruleset/operator reads to prove independent progress. Preserve onchain outage/fallback and metadata-write tests, run pinned Node26.5 focused tests/types/touched lint/formatter ratchet/source checks, and leave combined production/browser gates to root integration.
- **Resource budget:** Work only in `.worktrees/perf-revnet-server` on `perf/revnet-server-reads`; original node_modules is a read-only link for focused checks, with no installs/builds against it. One read-only cache reviewer checks architecture while implementation proceeds. Avoid changing alias/client-provider domains; coordinate shared props and invalidation. Replan if strict freshness, streaming status semantics or existing mutation tests cannot be preserved.

- [x] Extract the layout's existing body without changing await boundaries and commit passing regression checks.
- [x] Normalize indexed keys and add bounded successful-result reuse plus targeted invalidation tests.
- [x] Stream group-backed content only after authoritative route/project checks; let start-date and operator display resolve independently.
- [x] Wire Retry and metadata completion to server display invalidation; verify shared read owners and recovery.
- [x] Run focused checks and record exact commits, limitations and integration gates.

Review: behavior-preserving layout extraction is commit 11c7b631; bounded display reuse is c881dc02. Header skeleton extraction is dda04735, with exact rendered HTML equality for both populated and empty hints checked before reuse. The final layout retains route/project existence checks before its own streaming boundary, shows the known identity while group/operator data waits, and renders start-time and chart failures locally. Group success eligibility includes the requested project; all production callers now use that normalized key. Explicit invalidation cancels exact and known-group fills, retains unrelated reads, and documents unknown peer/replica expiry rather than promising global consistency. An independent cache review found no remaining blocker. On pinned Node 26.5, all 71 focused tests across 8 suites, full typecheck, touched-file ESLint, source invariants, formatter ratchet and diff checks pass. Navigation identity-boundary wiring and combined production/browser/404 measurements remain parent integration work; no build, dependency install, push or deployment occurred in this worktree. The shared installed graph reports Vitest 4.1.10 versus manifest 4.1.9, so these focused checks do not replace the parent's locked-install integration qualification.
## 2026-10-07 — Retained project navigation

Uses workspace AGENTS.md, workflow/ponytail/SKILL.md and docs/PLAN_REFINEMENT.md at /Users/jango/Documents/jb/v6/evm. Approved design and six-field refinement: /Users/jango/Documents/jb/v6/evm/docs/WEBSITE_PERFORMANCE_IMPLEMENTATION.md (gate passed).

- [x] Extract duplicated subtab URL owner without behavior change.
- [x] Add request-verified alias snapshot, short successful reuse and whole-project/page identity gate.
- [x] Switch tabs/subtabs/graph ranges to retained navigation preserving URL state.
- [x] Verify expiry, failures, rebinding, page/layout races, history and state retention.

## Plan refinement

- **Objective:** Retain alias tab, graph and history navigation without exposing actions for another binding; normal long transaction review remains usable.
- **System fit:** Server resolver remains identity authority; client navigation checks its five-second successful proof; ProjectPageBoundary compares child/layout tuples. Existing TransactionReviewProvider captures the initiating alias scope and checks it at approval, cancels unapproved dialogs on scope changes, and leaves durable transaction recovery unchanged.
- **Reuse and simplicity:** Native history handles local URL state, TanStack coalesces reads, and the existing global review queue owns scoped approval. Remove broad click capture instead of intercepting arbitrary form/dialog interactions or changing thirteen write callers.
- **Evidence and unknowns:** Independent review found global review dialogs live above the project boundary and bypass descendant capture; native dialogs also obscure an external Retry. Installed Next16 docs confirm retained layouts and refresh merging, requiring explicit keys and page acknowledgements. Exact pre-send protection after a completed review is investigated separately from alias approval.
- **Verification:** Exercise actual global review provider with deferred verification, expiry, cancellation, rebinding and simultaneous queued dialogs. Assert no approval from an obsolete id/scope after awaited work; retain existing review and recovery suite; cover real alias browser tabs, subtabs, graph range and history without documents.
- **Resource budget:** A focused optional scope API in the existing review owner avoids wider financial pipeline edits. Use isolated worktree and parallel read-only review; final production browser verification belongs to the combined branch with server wrapper installed.

### Navigation implementation review

- `resolveProjectRoute.server.ts` remains the sole bidirectional alias/authority resolver. Request-only `connection()` prevents full-route caching; `/api/project-route` returns no-store successful proof timestamps.
- `projectRouteQuery.ts` owns the memory-only, nonpersisted five-second lease and explicit invalidation. `localCheckedAt = requestStartedAt - (serverNow - checkedAt)` charges full transport time and tolerates server/browser clock skew; a response slower than the lease is rejected. SSR snapshots trigger one client verification because server time cannot safely establish browser freshness. No idle polling.
- The whole provider subtree is keyed by chain/project/operator, and each server page acknowledges its own identity before actions are exposed. Native history preserves unrelated parameters/hash. Native project dialogs release the top layer during verification without losing mounted form state.
- Global transaction review captures the active project scope and checks it at approval/funding selection; cancellation/id checks prevent late async proofs approving another dialog. Saved transaction journals are unchanged. Alias scope is checked at approval; existing per-action authority, simulation and account checks still own later send validation.
- Combined production/browser validation requires the server-worker layout wrapper and is assigned to integration. Focused tests include browser regressions replacing prior document-reload expectations.

### Refined alias rebinding recovery

Root architectural decision: ordinary same-project tabs, graph controls, history and successful expired-proof checks never reload the document. A positively verified change of tuple/operator replaces the document once, which also cancels old JavaScript preparations before they can enqueue under a new scope. Failed verification never reloads and retains Retry plus the original numeric project link. This exception avoids broad changes to financial execution owners while retaining their previous cancellation boundary. Tests distinguish same-binding/no-document, changed-binding/one-document, and failed-proof/no-document behavior.

## 2026-10-07 — Verify the combined website performance changes

## Plan refinement

- **Objective:** Qualify the combined wallet, server-read, client-cache and retained-navigation changes against repository release checks and measured project/tab/graph journeys.
- **System fit:** The layout's verified route snapshot surrounds project providers, while child snapshots acknowledge the same binding; indexed display caching and metadata invalidation retain their separate owners. Alias proof gates review scope, and existing final transaction/recovery checks remain authoritative.
- **Reuse and simplicity:** Preserve both append-only task records and combine the navigation page wrapper with the existing streamed chart. Add only the agreed layout wrapper and a meaningful integration assertion, then reuse the repository's pinned CI/build/browser tools and unchanged baseline comparison scripts.
- **Evidence and unknowns:** Combined server/client/diagnostics changes have passed focused checks; baseline production client JavaScript already exceeds its aggregate budget slightly. Final navigation integration, exact production size, 404 behavior and browser journeys remain unverified. Build inputs use the locked install and pinned Node 26.5/npm 12; root owns Docker and Para-enabled production smoke.
- **Verification:** Run full dependency, environment, deployment, type, lint, formatting, source, dead-code, protocol, wallet and coverage gates; build the production browser artifact, verify standalone output and measured budgets, then run the complete two-worker browser suite and unchanged comparison journey. Diagnose failures before modifying source or budgets.
- **Resource budget:** One owner mutates this integration checkout and serializes builds; fixture ports 4173/4174 are confirmed free. Use the existing log runner and bounded progress polling, preserve baseline artifact/source hashes, and rerun checks only for relevant subsequent changes or failures. No push or deployment is authorized by this verification.

- [x] Preserve both task histories and merge the streamed overview with its identity boundary.
- [x] Wire and verify the whole-project layout identity boundary.
- [x] Run complete static, coverage, production, browser and actual HTTP-status checks.
- [x] Run the matched physical-baseline/final comparison after other builds and probes stop.
- [x] Record qualified source revision, evidence and remaining measurement handoff.

Integration merge review: navigation extraction 2e4652e7 and behavior 656f9a16 preserve both task histories, every requested-project group key, and the streamed StartedProjectChart. The layout now supplies the same verified snapshot to the boundary enclosing all project providers. All 99 focused integration tests across nine suites pass, including the real navigation/cache suites and a new parent/child snapshot assertion. Full release checks follow this source commit.

Final review refinement: an observerless in-flight alias proof can finish after mutation invalidation and erase the invalidated state. Cancel affected fills before marking their query family invalid, retaining the marker so a fresh initial snapshot cannot bypass the mutation. Add a deferred pre-mutation response regression and retain existing failed-proof/fresh-initial refusal coverage. Full integration also found a legacy confirmation test mocking away the newly consumed useQueryClient hook; preserve its controlled authority reads while exposing a real query client for cancellation/invalidation. The alias browser readiness assertion needs a real marker on the boundary it observes. These are targeted correctness/verification fixes before the production source freeze.

Independent final review: the deferred proof test failed before cancellation and now fetches the rebound identity; failed endpoint proof still cannot fall back to a fresh initial lease. A second regression proves same-alias refreshed server props cannot replace the originally mounted binding without the exceptional document reset. A lagged indexed isRevnet:false flag also reproduced missing child content despite live alias proof; the layout now prefers that already-verified REVOwner evidence. All three affected confirmation mocks expose a real QueryClient. The navigation owner independently reviewed the merged layout, streamed page, keys, cancellation and metadata paths and reported no remaining blocker, pending full/runtime checks.

Bundle refinement: the final server display-cache import through @tanstack/react-query introduces 13 React client-hook references into each affected server route manifest, versus zero in the matched baseline. The installed @tanstack/query-core 5.101.4 export is the identical QueryClient class. Import it directly in the server owner and explicitly pin that existing package in manifest/lock metadata, without changing physical dependencies or cache semantics. Rebuild and measure before considering any bundle-ceiling change. The positive payment draft in the new alias browser test also revealed an unsupported previewPayFor fixture call; retain that scenario, add only its exact contract-derived response and negative request cases, and keep unknown-request rejection strict.

Core-import measurement: a09d6edc removes all 13 unwanted React Query client references and saves 8,252 bytes gzip; largest route drops below baseline, but aggregate remains 30,332 bytes above it. Parsed modules still duplicate review/provider and full route-gate code across page consumers. A behavior-preserving extraction now gives review scope and project context/page-boundary/navigation hooks their own lightweight owners, with every caller migrated and no policy change; its checked plan is tasks/performance-navigation-imports.md. The fixture correction accepts only the traced terminal/project1/USDC/12,000,000/guest-zero-address/empty-metadata preview tuple, deriving beneficiary/reserved tokens from the existing fixture weight and reserve percent and rejecting altered requests. No bundle limit has changed.

Final source verification: context extraction f1ec03e9 and exact preview fixture 961f01c4 pass independent reviews. With the locked physical dependency graph and pinned Node 26.5/npm 12, all dependency/audit, dead-code, environment, deployment, type, lint, formatting, source, protocol and wallet gates pass. Full coverage passes 2,386 tests across 253 suites, with one existing skipped test/suite (statements 65.81%, branches 60.23%, functions 63.19%, lines 67.92%). The combined production and standalone builds pass. Context extraction removes the repeated SDK/review/gate modules and saves another 24,069 bytes gzip; the final aggregate is 2,733,461 bytes and route-referenced JavaScript 960,296 bytes. A physical-copy baseline build is required before the final aggregate-ceiling decision because the earlier baseline used symlinked dependencies, which can change webpack module identities and compression despite equal package contents.

Browser-test refinement: the retained alias journey now reaches the valid positive payment preview. Its next assertion incorrectly expected a pool-only selector on a fixture whose IndexedBuybackPools response intentionally has no events. Replace that impossible action with a second supported Time range selection and browser Back/Forward, retaining assertions for range, URL filter/hash, Amount 12, Terms/Overview and zero document requests. Keep unknown fixture requests rejected. This is test-only; it neither fabricates pool data nor claims browser coverage for smooth/trade modes. The complete browser suite must pass again on this corrected test before qualification.

Physical-baseline refinement: the baseline's dependencies are now an APFS physical copy whose package files and internal links match the integration tree; only Vitest's generated results cache changed during coverage. Clean 81aeb708 preserves its original package/lock hashes, and its build, standalone and original budget gates pass. The correct aggregate comparison is 2,726,293 to 2,733,461 bytes (+7,168, or 0.26%); route-referenced JavaScript is 956,388 to 960,296 bytes (+3,908), and the largest route is 717,633 to 721,049 bytes. This supersedes the symlink comparison's apparent route decrease. After removing the duplicated SDK/provider/gate and server React-hook imports, the residual cost is the required navigation verification and display/recovery behavior. Root approved only the minimum aggregate ceiling, 2663 to 2670 KiB; retain every route and lazy-loading limit. Verify the existing budget-checker regression suite, checker lint, source invariants and the actual production artifact. Physical provenance and comparison reports are `/private/tmp/jb-performance-checks/revnet-baseline-physical-provenance.json` and `revnet-bundle-physical-comparison.json`.

Qualification review at 8fbf2e66: all final static and coverage gates pass, as do the production build, standalone and measured bundle gates. The complete corrected browser suite passes 131 tests with four existing skips and no flaky retries, including every viewport's alias range/history/draft journey. The aggregate adjustment passes 19 checker regressions, focused lint/format, source invariants and independent review; route and lazy-wallet limits are unchanged. Actual compiled-server probes return HTTP 404 for explicit ERC721NonexistentToken evidence and HTTP 500 for unavailable RPC evidence, with exact request assertions and no unknown requests. Reports: `/private/tmp/jb-performance-checks/revnet-final-complete.json`, `revnet-final-artifact.json`, `revnet-final-browser-corrected.json`, and `revnet-http-status-final.json`. The application remains byte-equivalent to the production container built from 961f01c4; later changes affect only browser assertions, the budget checker and this record. Parent-owned least-privilege container health/revision/image checks pass. No push or deployment occurred.

Remaining measurement protocol: rerun both the newly physical baseline and final artifact with the same final fixture and identical comparison script, after the parent confirms other builds/browser probes are quiet. Use fresh browser contexts, retain server-cache conditions in the report, assert real content and reject unknown requests/errors. Report cold versus warm observations and request counts without treating local deterministic timings as live-site speed estimates. Earlier symlink and fixture-version timing reports are superseded.

Matched comparison review: physical baseline 81aeb708 and final c035600a use identical fixture/script/Node/Playwright hashes, with no competing builds or browser probes. Both complete all content/error checks. Across three numeric journeys, indexed Project requests fall 51 to 4, SuckerGroup 33 to 4, raw allOf reads 6 to 3, and route RSC requests 87 to 60. One alias journey falls from six documents to one initial document, Project 16 to 1 and SuckerGroup 9 to 1; all final tabs/history preserve the document, and graph selection issues no route RSC. Original locator timing is mixed: numeric initial median 251 to 195 ms and graph selection 40 to 19 ms, but first Terms is roughly unchanged at 845 to 850 ms, and alias Terms appears substantially slower. These raw reports remain in `/private/tmp/jb-performance-checks/revnet-comparison-summary.json` and the referenced paired reports; no universal speedup claim is supported.

Bounded timing diagnosis: a separately reviewed temporary observer records actual capture-phase click time and the first simultaneous destination URL/selected-tab/financial-content/ready-boundary match, using a shared monotonic epoch clock and sessionStorage across baseline document navigations. It preserves every original assertion. The first attempt required an initial chart that the original readiness callback never promised; it stopped without accepting a measurement, and its failed report is retained. The corrected identical observer runs three numeric and three alias journeys per artifact and passes all checks. Numeric initial DOM-ready medians are 185.5 to 181.6 ms, first Terms 348.9 to 351.2, and Terms revisit 19.6 to 20.8. Alias Overview return improves 134.2 to 49.4 ms, while first Terms is 153.6 to 367.9 and revisit 148.7 to 330.5: a real local 180–214 ms regression remains, amplified by locator polling into roughly850 ms. Alias boundary checks take only a few milliseconds and its RSC responses finish roughly30 ms after request; the later DOM availability is consistent with installed React's300 ms Suspense fallback throttle. This is source/capture attribution, not an isolated framework-cause experiment. Initial chart completion is unmeasured; observer availability is not exact paint. Original cold-start variation remains visible, and these local deterministic timings do not estimate live-site latency. No runtime changes were made to chase the diagnostic. Evidence: `/private/tmp/jb-performance-checks/revnet-comparison-observed-summary.json` and its raw paired reports. All owned processes are stopped and fixture ports are free; parent receives the verified implementation plus this explicit limitation for the next performance decision.

## Follow-up — Attribute and shorten tab readiness

- [x] Follow the checked [tab readiness plan](performance-tab-readiness.md): attribute the existing fallback first, then isolate one loading-boundary experiment if supported.
- [x] Preserve deep-link, slow/error, identity and financial behavior; qualify the accepted change with matched DOM measurements and repository gates.

Plan review: the first batch remains immutable. The reviewed deletion-only experiment proves the repeated route fallback cost: matched alias Terms revisit DOM readiness330.6→39.9 ms and numeric first Terms354.1→61.6 ms. Final work moves the existing fallback into one persistent content boundary and adds one shared pending destination in ProjectMenu, retaining committed selection and all authority rules. The plan checker passes; cold/slow/interrupted acceptance and final release gates remain required. An unrelated4173 preview stays untouched; temporary matched probes use4175 with an exact fixture CORS-header adapter. The unchanged full browser suite will run in hosted PR CI before merge.

Final recovery review: application source remains unchanged after 2cecaa32; tested head 63e6b539 adds the cold-content and interrupted-navigation regressions. All required local static/advisory/protocol/coverage/artifact checks pass, with 2388 unit tests and 139 production browser tests. Numeric and alias cold-stream proofs, genuine 404 versus unavailable 500, numeric native pending and failed-alias Retry/draft recovery pass. The matched final design removes the measured floor: numeric first Terms 340.4→63.7 ms; alias first Terms 373.5→71.9 ms, revisit 331.5→41.1 ms and second Overview 337.2→41.2 ms. All twelve journeys preserve documents and exact financial content; Terms request counts and whole-pair query/contract-read counts do not grow. Timings are local DOM observations, not live percentiles. The [full qualification record](performance-tab-readiness.md#final-qualification-review) names raw reports, artifact provenance and retained failures. Independent review found no source blocker; root owns hosted checks and release.

## 2026-10-07 — Match Juicebox activity row hierarchy

Root `/Users/jango/Documents/jb/v6/evm/AGENTS.md`, pinned `workflow/ponytail/SKILL.md` and `README.md`, `docs/PLAN_REFINEMENT.md`, relevant root/app lessons and installed Next 16.3.8 CSS guidance reviewed. No descendant AGENTS.md applies in this checkout. Isolated from both performance worktrees at production `ff2a3ceacd6d21ede7aff61598bbd1bdd7df2dc7`.

## Plan refinement

- **Objective:** Give Revnet's project/account activity the requested Juicebox row hierarchy: action badge, prefixed actor, time beside overlapping chain links, and compact auto-issuance quantities with exact values available.
- **System fit:** `ActivityItemRow` owns both project and account rendering; `mapActivityEvents` owns amount presentation, while `number.ts` owns compact formatting. Preserve event/transaction identity, grouping, attribution, financial meanings, original explorer links, query freshness, transaction authority and recovery. Root owns review, deployment and final production verification.
- **Reuse and simplicity:** Reuse the shared row, existing semantic bullets, profile/date/chain/link components and compact-number formatter. Keep the established Simplon typography/palette and existing inflow/outflow/reserved treatment. Add only action labels and exact-token display metadata where auto-issuance starts abbreviating; no new component, dependency, data source or cache.
- **Evidence and unknowns:** Both source flows confirm the gap: amount-less Revnet rows replace the badge with the actor, chain links have 24px spaced wrappers around 14px marks, and auto-issuance bypasses the compact formatter. Juicebox already supplies badges and overlapping 18px marks. Screenshots motivate layout; rendered mobile/desktop geometry still needs verification, and preserved first-batch tests do not qualify these edits.
- **Verification:** Extend existing mapper/row tests to cover compact large/tiny auto-issuance with a lossless exact title, action labels and actor prefixes, flow preservation, every explorer destination and semantic grouping. Run focused tests, type/lint/format and source gates, then obtain a quiet slot for production build/bundle and browser verification; check mobile/desktop wrapping and icon geometry without changing the performance probe/harness. Required CI/release checks remain root-owned.
- **Resource budget:** One writer in this isolated checkout; minimal runtime owners and existing tests. No build, browser, timing probe or heavy dependency work until root grants the slot. Preserve unrelated processes and worktrees, and replan if amount semantics or bundle limits would change.

- [x] Implement the shared row hierarchy and owner-level quantity presentation.
- [ ] Verify focused regressions and repository gates; inspect responsive production output in an assigned slot.
- [ ] Record evidence, independent review readiness and commit the isolated change for root delivery.

Consumer check: the homepage also consumes `mapActivityEvents`' auto-issuance count, so its existing summary retains the same exact-token title. Its layout and grouping remain unchanged. The quantity's full decimal string is grouped directly, avoiding floating-point conversion for the exact value.

Review refinement: mint, auto-issuance, reserved-split and item-mint rows identify recipients rather than necessarily the initiating caller. Their new attribution line says `to`; administrative actors say `by`, preserving existing flow/distribution wording and mapped identities. Regressions use different caller/beneficiary accounts so the layout cannot imply that the recipient initiated the transaction.

Source review: independent review reports no remaining source blocker. All 54 focused tests across activity mapping, row rendering, cross-chain grouping, swap direction, account merging and filters pass. Physical locked dependencies match the verified first-batch graph (113,031 distinct files and 51 internal symlinks); provenance is `/private/tmp/jb-performance-checks/revnet-activity-physical-provenance.json`. Full gates and rendered checks follow the combined candidate below.

## Plan refinement

- **Objective:** Qualify the activity presentation on the reviewed performance follow-up tree that will precede it in production, while keeping activity separately reviewable.
- **System fit:** Commit the activity-only delta from first-batch production, then merge the independently reviewed performance branch into this activity worktree. Root owns stacked PR delivery, performance-first promotion, exact tree checks and production verification; both task histories remain evidence.
- **Reuse and simplicity:** Merge disjoint runtime owners without rewriting either change. Reuse the verified physical dependency clone and final existing CI checks once on the combined source; no install, formatter policy change or harness port change.
- **Evidence and unknowns:** The activity-only source passed independent review and 54 focused tests. Performance `63e6b539` (or its notes-only final successor) has independent qualification. Merged source, bundle size, full coverage and browser layout still need qualification and must not inherit a passing claim from either separate base.
- **Verification:** Resolve only append-only task-history conflicts, inspect the runtime union, then run every CI/package gate, production build, standalone/bundle checks and full browser suite. Supplement the unchanged browser harness with a deterministic activity-response/profile overlay on desktop/mobile to inspect overlapping links, exact quantities, attribution and wrapping.
- **Resource budget:** One combined local gate/build sequence after the root releases the timing slot; coordinate 4173/4174 with the performance owner. No push/deploy here. Replan instead of relaxing a bundle cap or changing data semantics if combined verification fails.
