# Copied files

Files that come from Juicebox Money (jbm, `webclients/juicebox-money`). Each row names the source path, the source repo's commit when it was copied, and the edits revnet made. A fix to a copied wallet or transaction primitive lands in jbm, revnet-money and Homerun in the same change.

| File | Source | Source commit | Edits |
|---|---|---|---|
| `scripts/lib/test-titles.mjs` | jbm `scripts/lib/test-titles.mjs` | jbm 98c9409, unchanged since ca6e0eb (jbm#109) | None. Byte for byte: `git hash-object` gives jbm's blob id, `208f934`. `scripts/check-wallet-write-sites.mjs` reads a test file's markers through its `provingTitleWords`. |
| `test/lib/test-titles.test.ts` | jbm `test/lib/test-titles.test.ts` | jbm 98c9409, unchanged since ca6e0eb (jbm#109) | None. Byte for byte: blob id `9db6ece`. It tests the file above. |

Both copies keep jbm's formatting (no semicolons, single quotes), which revnet's Prettier config would change. `test/fixtures/format-debt.json` holds each file's SHA-256 as reviewed formatting debt, so a change to a copy fails `npm run format:ratchet` until its new digest is reviewed, and the two stay equal to jbm's.
