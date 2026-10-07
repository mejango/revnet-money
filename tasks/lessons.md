
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
