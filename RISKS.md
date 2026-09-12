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
  not an active pending balance. “Payments awaiting routing” discovers retained
  calls by source project and chain, authenticates their complete original
  calldata against the live gateway commitment, and excludes this custody from
  the project's spendable balance. An unavailable or incomplete index is not
  evidence that custody is empty.

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

Pending payment recovery is permissionless. The original beneficiary, payer,
source project, memo and metadata cannot be edited. Cooldowns and finalization are
derived from chain time and the live failure streak. A final attempt can settle,
refund, or remain pending after a changed failure. Only a matching gateway event
and original payment tuple establish an executed outcome; outer receipt success
alone does not establish settlement. Frozen batches recheck commitment and failure
state before wallet boundaries, retain uncertain submissions, and resume confirmed
attempts without repeating them. Recovery batches use reviewed direct calls in
durable rounds. Raw `eth_call` preflights cannot follow token-controlled CCIP
redirects; simulations and estimates use the live executable transaction cap so
complex finalizer refunds are not limited to a gas-reserve heuristic.

A canonical reverted EOA transaction completes a failed attempt without retrying
it automatically. Safe proposals remain pending until exact execution is verified,
or until the original payment has resolved and the full proposal can be fetched
and authenticated against its canonical Safe transaction hash and frozen call.
An authenticated obsolete proposal can leave the routing batch, but its original
hash and nonce remain visible for cancellation in Safe. Unavailable or inconsistent
proposal data never authorizes abandoning an uncertain wallet submission.

Market composition uses indexed net liquidity ranges valued at the current
onchain price. Like the previous indexed event replay, these ranges cover the
canonical PositionManager's positions. Missing, inconsistent, or incomplete
indexed data falls back to a complete RPC liquidity history; an explicit indexed
zero range represents a fully withdrawn position. LP ownership reads remain
per-position and require every page.

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
