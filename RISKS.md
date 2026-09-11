# Revnet client risks

## Priority risks

- A registry-selected terminal can be a gateway, a current or retired raw router,
  or an unknown address. Read the project's actual `terminalOf` selection and the
  gateway's `ROUTER`; recognize directly attached entries without inventing a
  registry hop. Unknown selections remain unknown. Payment previews, allowance
  spenders, and transaction targets must use the same attached entry.
- Deployment presence is chain-specific. Generated records validate successful
  deployment receipts and retain current, previous, and v1 history. Pending
  proposals do not enable new targets. Regeneration must use the pinned
  executed artifacts; an address on one chain is not evidence for another.
- A successful gateway transaction can leave a fee payment pending in gateway
  custody. Receipt success does not prove fee settlement. Retries and
  finalization have distinct outcomes; `pendingCallCount` is a lifetime counter,
  not an active pending balance. The client does not display an indexed
  per-project custody balance.

The current snapshot records executed deployments on Ethereum, Optimism, Base,
Arbitrum and the three full-stack testnets. OP Sepolia remains feed-only. This
enables migration preparation on those mainnets; it does not migrate existing
projects or replace the live registry allowlist checks.

## Trust assumptions and accepted behaviors

Registry defaults and allowlists are live state controlled by protocol roles.
Migration presets and cross-chain mirrors require canonical deployment evidence,
target bytecode, and live `isHookAllowed`/`isTerminalAllowed` responses. RPC errors
remain errors: they must not become empty pools, missing selections, or retired
fallback defaults. A preview can become stale before a transaction executes.

Retired contracts remain recognizable for ongoing projects and activity history.
They are not silently substituted for an unavailable current selection. Mirroring
requires valid source ordering and skips dependent pool steps when hook selection
is unavailable. Custom addresses require explicit per-chain selection.

Current buyback metadata has three words; a swap below the TWAP floor falls
back to minting. Earlier generations retain their own behavior. A historical
two-day TWAP sentinel must not become the new hook's actual pool window.

## Invariants to verify

- Regenerate and check both client data and independent fixtures against the same
  executed deploy-all commit; preserve deliberate historical addresses.
- Exercise absent deployments, disallowed targets, RPC failures, reordered
  mirrors, and unavailable hook dependencies before offering migrations.
- Keep direct and registry-selected payment entry points consistent through
  preview, authorization, and execution.
- Decode Safe queue actions with the contract generation at the destination.
  Distinguish gateway retained custody from the core terminal's held fees.
- Pass the production dependency audit without widening its scoped exception,
  then run the production build and browser checks after framework updates.
