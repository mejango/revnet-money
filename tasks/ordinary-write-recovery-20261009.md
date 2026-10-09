# Revnet ordinary wallet-write recovery

Applies the approved shared plan at `/Users/jango/Documents/jb/v6/evm/.worktrees/sdk-sticky-adversarial-20261009/tasks/ordinary-write-recovery-20261009.md`. Required root AGENTS, pinned Ponytail skill/provenance, PLAN_REFINEMENT and relevant root/local lessons were read. Bridge readiness files remain frozen.

## Plan refinement

- **Objective:** Preserve ambiguous ordinary writes across reset, remount and reload, block changed-quote replay, and resume only from authenticated returned-hash evidence; keep multichain batches under their existing durable owner.
- **System fit:** The SDK classifies wallet rejection, ambiguity and returned identity; transaction activity owns ordinary write evidence and UI; the batch journal owns selected batch calls. Final wallet/account/connector/chain and mounted-generation gates follow asynchronous readiness and persistence. Canonical receipt evidence releases known identities; hashless unknown results remain held.
- **Reuse and simplicity:** Extend existing transaction activity with exact reviewed evidence and action scopes. Reuse native browser locks, SDK receipt verification and batch reset CAS. Add optional expected-snapshot CAS to the existing batch save owner rather than duplicate its bigint serialization. Typed durableRecovery callbacks transfer responsibility explicitly; callback presence alone cannot bypass generic persistence.
- **Evidence and unknowns:** Current hook stores only returned hashes, and duplicate detection requires a hash. Current batch saves its hash after the shared send promise resolves and broad catch rewrites without CAS. The physical SDK preview now supplies the shared parser, wallet callbacks and canonical/finality verifier. Review found transient-read loss of memory-only hashes, stale receipt writes, premature batch receipt UI success and existing batch routing failure release without finalized proof; the same existing owners address each. No transaction, publish or merge authority is added.
- **Verification:** Prove lost-reply and changed-quote rejection before edits; test reset/remount/reload, nondismissible unknown records, storage write/readback failure, stale snapshot rejection, final scope invalidation, known-hash canonical receipt resumption, definite wallet rejection and awaited batch hash persistence. Include exact-domain hash reattachment, persisted same-ID stale proof, raw-receipt UI suppression and finalized batch routing failure. Run focused tests and touched-file lint/types only; root owns broad integration gates.
- **Resource budget:** Own reviewed-write hook, transaction activity, multichain hook, narrow batch save CAS and new-lock Dismiss visibility plus focused tests. Read-only reviewer checks callback and persistence seams. Replan if SDK cannot authenticate existing Safe batch evidence without duplicated canonical/finality logic. No installs, builds, staging or commits.

## Checklist

- [x] Characterize lost replies and preservation failures with focused regressions.
- [x] Add ordinary activity reservations and typed domain-journal handoff.
- [x] Persist returned batch hashes before returning from the wallet boundary, with CAS.
- [x] Resume known hashes and keep unresolved writes locked with clear recovery copy.
- [x] Run focused tests, lint/types and record SDK preview limitations.
- [x] Complete parent-requested full light gates and unfiltered coverage on frozen source.
- [x] Complete allocated production build, standalone, bundle and browser gates.
- [x] Prepare the root-authorized local-only task commit after all verification; no push. Final commit identity is recorded with the gate manifest.

## Storage concurrency refinement

Independent review reproduced two failures after the first freeze: two healthy tabs reserving different actions can overwrite each other's whole activity arrays, and a reservation whose pre-wallet readback fails can strand its unsent marker because `beforeWrite` throws before the caller receives the reservation. Batch arrays have the same cross-account lost-update risk. Root authorized this narrow owner-level reopen; no SDK runtime changes are needed.

### Plan refinement

- **Objective:** Retain every unrelated unresolved action across concurrent tabs and let an exactly identified, proven-unsent reservation recover from storage failure without a second wallet invocation.
- **System fit:** Transaction activity remains the ordinary-write durable owner; multichain batches retain their existing owner. Outcome/proof/authority semantics are unchanged. Per-action wallet locks and per-account batch locks remain, while persistent entries become independent so status observers cannot erase other reservations.
- **Reuse and simplicity:** About 70 synchronous activity mutations span the reviewed-write/Safe watcher, reviewed Relayr hooks, the SDK Safe-Relayr store adapter, multichain progress and account Dismiss. Batch mutation APIs are also synchronous, including `releaseBatchRound` from account discard. Faithfully awaiting a global array lock would change each callback contract and its callers. Keep these APIs synchronous and use one small shared per-record persistence primitive for the two existing owners; no second journal or shared mutable index.
- **Evidence and unknowns:** The failing two-module interleaving regression returns both reservations successfully but restores only one row. A real-hook regression shows a silent pre-wallet save failure opening no wallet yet refusing retry after storage recovers. Legacy arrays must remain readable; per-ID overrides and tombstones prevent deleted legacy records from resurrecting. Ordinary records use stable `reviewedWrite.id` as physical identity even after the display ID becomes `tx:chain:hash`.
- **Verification:** Cover concurrent distinct activity IDs and batch accounts; migration with legacy/new rows; tombstones/reload; returned-hash write/readback failures; exact unsent cleanup without deleting newer evidence; stale proof CAS; changed-context final gates. Run focused storage/hook/batch regressions, then independent review before restarting full qualification. Existing routing supersession semantics stay intact.
- **Resource budget:** Limit production edits to the two store owners, a shared persistence primitive, and the existing wallet reservation callback if necessary. Use delta writes to changed/deleted IDs only, with expected raw snapshots and readback checks. Record caller inventory at `/tmp/revnet-activity-mutation-callers.txt`. Suspend broad coverage/builds while storage is reopened; full gates resume only after focused checks and independent clearance.

- [x] Implement per-record persistence and legacy overlay/tombstone reads in the existing owners.
- [x] Clean up exact unsent reservation failure inside the reservation owner.
- [x] Prove cross-tab safety, storage-restoration availability and legacy behavior.
- [x] Obtain independent read-only clearance and re-freeze before full qualification.

### Final reviewer refinements

- Each batch call reservation receives a fresh UUID retained in the exact submitted snapshot. Deferred cleanup may restore only that unique proven-unsent attempt, so a later tab reserving the same ready call cannot be mistaken for it. The hook adopts the owner-returned call including this identity; definite pre-wallet release clears it. Legacy unknown submissions remain held.
- Activity persistence retains an ordered chain of unacknowledged writes for each physical record. It first retries the exact earliest write, then uses the acknowledged version for later queued updates. A successful set with unavailable readback cannot strand a coalesced update, while true sibling changes still fail the expected-version check.
- Verification adds failing-before two-tab reservation ABA and own-write readback-outage/update/recovery regressions, plus retained sibling-conflict checks. These are narrow corrections inside the already approved existing-owner storage design; independent clearance still precedes full qualification.

## Bundle qualification refinement

- **Objective:** Qualify the required recovery/readiness behavior within a measured client-size budget, preserving route, initial-load and lazy-wallet protections.
- **System fit:** The frozen runtime and successful browser-build artifact remain unchanged. The aggregate bundle gate owns shipped JavaScript limits; any ceiling change requires an exact dependency-graph baseline and independent import review before the authorized local commit.
- **Reuse and simplicity:** Reuse the existing build and bundle scripts in an isolated archive of original commit `3d2d02a8559babc957da6a54882b00419bbb348d`, with a cloned identical dependency graph and authenticated official SDK 2.26.0 backup. Do not add a bundle exclusion or runtime workaround. If measured required growth accounts for the excess, change only the aggregate ceiling to the smallest integer KiB above the candidate measurement.
- **Evidence and unknowns:** Candidate aggregate is 2,775,788 bytes (2710.7 KiB), above 2706 KiB; largest route is 722,978 bytes and unique route-referenced JavaScript is 1,002,583 bytes, both within their existing limits. All lazy-wallet assertions pass. Read-only import review found one copy each of storage, shared recovery parsing/verification and destination readiness, with the unused SDK browser journal tree-shaken. Exact baseline attribution is pending.
- **Verification:** Authenticate official SDK against its tarball/lock integrity, compare every non-SDK dependency file including nested SDK dependencies, build baseline once using the pinned toolchain/environment after the candidate browser server stops, and measure both with the unchanged gate. Obtain independent reviewer approval. If the sole config ceiling changes, rerun its gate/tests/lint and retain the already built runtime/browser evidence.
- **Resource budget:** Root authorized one isolated baseline build and a minimal measured ceiling if no dependency/lazy regression or avoidable growth exists. Use the already allocated heavy slot; do not rebuild frozen candidate runtime, install dependencies, alter package pins, or broaden source changes. Stop for a concrete defect or failed provenance comparison.

## Review

Independent review by `/root/review_remediation_independent` cleared the frozen production changes: per-ID overlays/tombstones and key enumeration, stable physical identity, unique batch reservation attempts, exact unsent cleanup, acknowledged write ordering, canonical/finalized receipt CAS and terminal UI gating. Final regressions failed before their fixes; the focused owner/caller run passes 639 tests in 10 files.

Final qualification uses Node `26.7.0`, npm `12.0.1`, and physical SDK preview `2.27.0-preview.adversarial.4006a0bca708`, built from SDK commit `930f89f2f2cd06afaced3d5fddfd466b29edd24e`. SDK source digest: `4006a0bca708ba4929942a7b62b48e566a44ba347db0f002661712af513df4b9`; tar SHA-256: `7107a0ff2af3b373d5c7708468651090a165deb254a8f93071488d2fafba8116`. The root verified all 771 artifact files and preserved all 11 nested SDK dependency files. Manifest and lock retain the official `2.26.0` pin; no aliases or package-resolution overrides are used.

- `npm run test:ci -- --maxWorkers=2`: exit 0; 2,766 tests and 257 suites passed, one existing optional live Base RPC test/suite skipped because `LIVE_BASE_RPC_URL` was not configured. The live Bendystraw checks and loopback tests ran with network access. Coverage: statements 67.56%, branches 61.93%, functions 65.25%, lines 69.66%; all configured thresholds pass.
- Full lint, types, dead-code, environment, deployment, formatting ratchet, source and protocol checks: exit 0. Wallet inventory: 142 sites, 9 surfaces, 29 test-referenced actions.
- `PROTOCOL_DEPLOYMENTS_DIR=/Users/jango/Documents/jb/v6/evm/.worktrees/perf-deployments-20261007 npm run protocol:check`: exit 0; all 44 independent deployment artifacts match pinned commit `a6ab40c5806b52ff4cb21f9eaefe275e621796f9`.
- `npm run audit:production`: exit 0 with the repository's existing checked Para advisory exceptions.
- `npm run dependencies:check`: exit 1 only because the intentional physical SDK preview differs from the unchanged release pin. This is a preview qualification exception, not a clean published dependency-install claim.
- Exact commands, exits and logs: `/tmp/revnet-final-4006-20261009/{light-gates,coverage-result,audit-result,protocol-artifacts-result}.json`. Toolchain, frozen source hashes and package provenance: `toolchain.json`, `frozen-files.json`, `qualification-provenance.json` in that directory. Earlier preview/Node 24 focused results are supplemental only.

Production build and standalone checks passed. Browser summary: 139 passed, six existing conditional skips (four non-desktop prefetch cases and two wide-view Latest single-column cases), exit 0. The original aggregate budget failed at 2,775,788 bytes versus 2706 KiB. The isolated baseline at original commit `3d2d02a8559babc957da6a54882b00419bbb348d` with authenticated published SDK 2.26.0 measured 2,770,709 bytes; all 112,119 other dependency files, including the SDK's nested dependencies, are byte-identical. The baseline archive's 842 tracked source files and eight relevant build/config files were independently checked. Delta: 5,079 bytes (0.1833%), 215 to 216 chunks.

Independent budget review by `/root/review_client_sdk/readiness_consumers/jbm_gate_review` approved the minimal aggregate ceiling of 2711 KiB (276-byte headroom). Its module inspection found the new shared storage and SDK proof/parser owners; the hook, review and sucker chunks retain the same 20 route-manifest references. No new eager family, duplicated owner or avoidable import was found. Largest-route and unique-route bytes remain 722,978/900 KiB and 1,002,583/1100 KiB, and every lazy-wallet assertion passes. Only the gate ceiling and its documentation change; the production runtime/browser artifact remains frozen. Evidence: `baseline-dependency-proof.json`, `baseline-build-result.json`, `baseline-bundle.log`, `bundle-comparison.json`, `heavy-gates.json`, and `test-browser.log` in the final gate directory.

Remaining release gates: adopt the eventual published SDK after byte-equivalence verification, update official dependency pins/lock through the release process and run a clean locked install plus prescribed qualification; validate target build/runtime environment; complete the release OCI build/runtime smoke and deployment verification. The preview dependency exception is not published-release qualification. No push, publish or transaction is authorized here.

Final aggregate gate passes at 2711 KiB. Targeted bundle-script tests pass 19/19; script lint, source invariants and diff checks pass. Reverification after heavy gates confirms no runtime/test drift, all 771 SDK files and 11 nested dependency files unchanged, and unchanged official manifest/lock hashes. Compact successful evidence: `/tmp/revnet-final-4006-20261009/successful-gate-manifest.json`; diagnostic records preserve the original budget failure. No repeat production build or full test sweep was needed for the gate-only ceiling change.
