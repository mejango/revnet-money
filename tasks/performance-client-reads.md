# Revnet client project-read reuse

Mandatory workspace resources remain /Users/jango/Documents/jb/v6/evm/AGENTS.md, /Users/jango/Documents/jb/v6/evm/workflow/ponytail/SKILL.md and README.md, /Users/jango/Documents/jb/v6/evm/docs/PLAN_REFINEMENT.md, and /Users/jango/Documents/jb/v6/evm/tasks/lessons.md. Root implementation plan: /Users/jango/Documents/jb/v6/evm/docs/WEBSITE_PERFORMANCE_IMPLEMENTATION.md. This isolated checkout inherits those requirements; app lessons are tasks/lessons.md. Installed Next 16.3.8 client-side-data-fetching/tanstack-query and fetching-data guides were reviewed.

## Plan refinement

- **Objective:** Reduce redundant project reads during Terms/Owners/Extras revisits, display indexed descriptions immediately, and preserve accurate cache identity and bounded freshness for public read preparation without changing transaction execution.
- **System fit:** The app QueryClient already owns a 30-second default TTL. Existing wagmi keys retain chain/contract/function/argument binding. A common per-chain/project/rulesets-contract TanStack query will own complete raw ruleset history; display consumers select their own representation. Project metadata retains its complete gateway fetch and error state; indexed description is a fallback, not a completeness assertion. Live transaction preparation and send guards remain their current separate owners.
- **Reuse and simplicity:** First extract the existing useRulesets query options without changing keys, return shape, freshness or ordering and test/commit it. Then reuse those options from both ruleset hooks, move class conversion to select, and add the contract address to the raw query key so old persisted class-shaped entries cannot collide. Reuse 60-second ruleset freshness and existing persistence, 30-second provider defaults, and 15-second chart polling. No new cache, dependency or global default change.
- **Evidence and unknowns:** useRulesets and useAllRulesetsByChain independently call readAllProjectRulesets for matching projects. Mutable controller currently has infinite freshness; remove that override so existing 30-second default governs it. TokenPriceChart omits base-token fields from its query key despite using them in the fetcher; include them and set freshness to its existing 15-second refresh interval. ProjectProviders currently drops the available indexed description. Server worker owns server hydration/caching and EditMetadataDialog invalidation; nav worker owns URL and alias changes.
- **Verification:** Run real QueryClient/hook tests proving single/multiple/in-flight ruleset reuse, 60-second expiry, explicit invalidation, project/chain/contract isolation, old persisted-shape isolation, error/retry and changed raw data/class selection. Provider tests prove indexed description paints during deferred metadata and richer data replaces it. Run affected existing persistence, ruleset, owners, metadata and chart regressions, typecheck, focused ESLint and formatting ratchet. Transaction send/authority paths remain untouched; root runs combined release gates/build/browser checks.
- **Resource budget:** One isolated worktree from 81aeb708, shared read-only node_modules symlink, pinned Node 26.5.0, no installs/builds/push/deploy. Keep aggregate ruleset loading/error semantics stable while changing the owning cache. Stop and refine if tests reveal dependent semantics beyond this focused scope; report exact commits and checks to root.

## Checks

- [ ] Root gate/check-in before behavior implementation.
- [ ] Behavior-preserving options extraction and regression commit.
- [ ] Shared raw ruleset query, bounded mutable-controller read, complete chart identity/freshness and description fallback.
- [ ] Focused regression checks, typecheck, lint and format.
- [ ] Review results and hand off tested commits.
