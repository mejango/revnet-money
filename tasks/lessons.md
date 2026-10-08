
## 2026-10-06: Safe recovery follows intent, not signature serialization
- Correction: an extra owner confirmation changed exact bundle calldata keys and caused Retry checks to repeat a reservation warning.
- Rule: when resuming a saved quote, match complete identical Safe intent sets and keep its frozen original bytes. Preserve actual or ambiguous funding reservations across legacy records; quote-only replacement follows the corrected rule below.

## 2026-10-06: A Safe quote is not a funding attempt
- Correction: a quote-only historical selection still blocked the user's currently ready transactions even though they had never paid.
- Rule: distinguish quote creation from funding evidence in the shared Safe lifecycle; let the shared owner replace an eligible unfunded quote for the current reviewed selection, while preserving submitted, hashless, malformed and otherwise ambiguous funding history. Test the real four-saved/three-current user flow rather than only recovery messages.


## 2026-10-07: Display latency must not become an authority verdict
- Correction: Account showed Unknown on some chains and delayed pending multisig queues even when the same operator was a Safe elsewhere.
- Rule: share display identity probes, render independent chains as they finish, and expose retryable verification failures explicitly. Keep fresh action authority checks separate; never use a cached or failed display probe to authorize a write.

- Follow-up: after consent, say the quote is being requested; after payment, show each chain's submission and verification progress from shared lifecycle events. Never leave a paid flow presenting the Pay action or a stale wallet-confirmation message. A missing receipt is pending until proof is available, not proof of failure.
## 2026-10-07 — Make automatic phases visually distinct from actions

- User correction: per-chain Checking/Ready was buried in muted detail text, and preparation showed a disabled button despite advancing automatically.
- Rule: place concurrent status beside its chain heading, separate details below, and render one passive progress message while no action is available. Keep dismissal possible before payment; verify mobile wrapping and the quoted/paid states.


## 2026-10-07 — Keep payment actions concise
- Correction: the user wants the initial Safe bundle funding action and nested payment confirmation both labeled “Pay”.
- Rule: put the transaction count and execution explanation in the review content; keep the payment button label Pay. Preserve disabled, pending, recovery and authority behavior when changing labels. Existing Safe queue and payment-review assertions enforce the exact label.

## 2026-10-07 — Remove duplicate reads without removing final validation

- Correction: repeated checks delayed the final payment flow. Saved Safe preconditions and mandatory legacy guards caused identical nonce/hash reads within one validation pass.
- Rule: deduplicate only equivalent address/calldata/expected tuples inside the existing verifier invocation; retain conflicting expectations, synthesize missing legacy guards and reread on every later pass. Guard, raw-payment, direct-batch and Safe-payment regressions enforce exact per-pass counts and refusal after final state drift.

## 2026-10-07 — Describe the actual payment phase and verified effect

- Correction: final preparation retained Review payment copy, and a wrapped wallet payment left rows waiting for payment after submission.
- Rule: use the shared lifecycle's phase boundaries: Preparing payment covers consent and local preparation, Checking before payment covers final beforeSend guards, and submitted/ambiguous evidence says Checking payment status. Keep canonical wrapped-funding proof and per-chain verification in the SDK. Deferred actual-adapter and rendered progress regressions enforce the order without new app polling or weaker guards.

## 2026-10-07 — A package tarball does not include its installed nested dependencies

- Finding: replacing the entire installed SDK directory with a preview tarball also removed its nested bs58/base-x packages, causing fallback to different root major versions while every manifest hash stayed unchanged.
- Rule: retain nested node_modules when replacing only a package's own files, then verify the whole installed package-path/content graph and actual dependency resolution. Package metadata and compiled-file equality alone do not qualify the installation or bundle measurement. Invalidate measurements from an incorrect graph; require final clean-install CI before release.

## 2026-10-08 — Request priority must not bypass appropriate image sizing

- Correction: the user asked that critical images not download oversized originals either.
- Rule: let loading hints control timing independently from the shared image-size policy. Use a visible contained derivative before unknown crop geometry is available, then select the smallest adequate existing derivative before resorting to an original. Preserve source/format/error exceptions and state their actual limits rather than claiming a universal byte cap.
- Owning checks: responsive-image observer, native SSR and source/rerender regressions enforce sizing for default/eager/high-priority images and sufficient physical pixels before intended fit restoration.
