import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

const routeBudgetKiB = Number(process.env.CLIENT_ROUTE_GZIP_BUDGET_KIB ?? 900);
const totalBudgetKiB = Number(process.env.CLIENT_TOTAL_GZIP_BUDGET_KIB ?? 1100);
// Counts every emitted chunk, including ones a visitor may never download.
// WalletConnect (with @reown/appkit), Coinbase Wallet and Safe add ~690 KiB of
// strictly lazy vendor SDK here; the per-route budgets and the lazy-load
// assertions at the bottom of this file are what protect first paint.
// SDK 2.14.0's shared review measured 2599.8 KiB with one review per batch; a
// fee-return check for every fee-paying call in a batch review brings it to
// 2600.1 KiB, so the budget moved up by the minimum 1 KiB. Detecting a Safe by
// connector and WalletConnect peer measures 2600.9 KiB with the SDK's shared
// Safe maps replacing revnet's five copies, still within it. Formatting wallet
// balances as Juicebox Money does (rounded by decimal digits, dust kept visible)
// brings it to about 2601 KiB, so the budget moved up by the minimum 1 KiB again.
// axios 1.20.0 in Para's lazy chunk (+3.1), DOMPurify 3.4.16 (+0.4) and Next 16.3.8's
// client runtime (+0.2) measure 2604.7 KiB against 2601.1 KiB before, so the budget
// moves up by 4 KiB. The route budgets are unchanged.
// The transaction review moved into a provider plus a dialog loaded on the first
// request: every route's first load fell 7.5-27.3 KiB and route-referenced
// JavaScript 897.4 -> 883.0 KiB, but all client JavaScript measures 2610.7 KiB
// against 2605.2 KiB (SDK 2.17.0 alone changes nothing). The eager review held the
// select, wagmi config and other small shared modules in a chunk the layout and the
// pages shared; without it Next copies each into the page and lazy chunks that use
// it (the select alone is +10.0 KiB). The budget moves up by the minimum 5 KiB.
// SDK 2.17's Relayr quote binding (`bindRelayrQuote`, its bundle read and
// `relayrDestinationHash`) and its payment retry check (`requireRelayrPaymentRetry`,
// with its onchain payment proof) bring all client JavaScript to 2614.0 KiB against
// 2610.7 KiB, so the budget moves up by the minimum 4 KiB.
// SDK 2.18.0 puts each generated ABI in a module of its own. Webpack copies each one into
// every chunk that uses it, so all client JavaScript measures 2618.7-2618.8 KiB against
// 2614.0 KiB (largest route /[slug]/operator 655.1 -> 660.6 KiB). Builds vary by about
// 0.1 KiB, so the budget moves up 5 KiB to keep a clear margin.
// The send-safety fixes (the dialog hold through every send, the reviewed-account check,
// one output-less approve ABI, the SDK's sequence simulation in both Safe batch paths,
// the revert rule and the isolated reads of project-chosen tokens) measure 2623.9 KiB
// against 2618.8 KiB; the budget moves up to 2625 KiB.
// Deployment diagnostics keep contract reads on the server; their opt-in dialog,
// truthful data states and SDK deployment validation measure 2626.9 KiB against
// origin/main's 2623.3 KiB. The aggregate budget rises by the minimum 2 KiB;
// route and route-referenced budgets remain unchanged.
// Moving the shared diagnostics trigger into Extras adds 191 bytes for the
// section and button (2,689,893 -> 2,690,084 bytes gzip). The dialog stays in one chunk;
// only the aggregate ceiling moves up by the minimum 1 KiB.
// The SDK's Safe checks replace revnet's copies: authority identity with the Safe
// creation proof and its two pinned proxy creation codes, the strict Safe transaction
// and service readers, and the distribution receipt verifiers, which decode every
// log with the full controller, terminal and JBTokens ABIs. With the Safe badge's
// lazy import narrowed to the one export it uses, all client JavaScript measured
// 2640.1 KiB against 2626.8 KiB on main at a7609431, and the aggregate budget rises to
// 2641 KiB; route and route-referenced budgets remain unchanged.
// Binding each Safe proposal's result to the calls it was reviewed to run, its live
// approval count, the cached creation records and the unproven Ethereum handles line
// measure 2641.3 KiB against 2640.0 KiB; the aggregate budget rises by the minimum 1 KiB.
// Ending every Safe proposal the app can't follow (the watch's give-up rules and its read of a
// replaced nonce), the account's Dismiss and one bounded creation read for the page as well
// measure 2642.0 KiB against 2641.5 KiB, at the budget; it rises by the minimum 1 KiB.
// Following a Safe proposal to the chain's answer before it ends (its run of looks, the looks
// that learn nothing, a receipt's hour from its execution), the loan dialogs' unconfirmed line
// and the flows that stop reading such a proposal as pending measure 2643.0 KiB against
// 2641.9 KiB, at the budget; it rises by the minimum 1 KiB.
// Routes compiled only into the deterministic browser build (the IPFS and confirm
// proofs) never ship, so their own files are left out below. Measured that way,
// Juicebox Money's confirm primitives in every confirm bring all client JavaScript to
// 2640.6 KiB against origin/main's 2642.2 KiB at 00f0659e (largest route
// /[slug]/operator 675.4 -> 678.4 KiB), within the budget.
// Deciding Relayr sessions from the finalized chain through SDK 2.22.0's session rules (the
// classification, the outcome and its recheck, the reverted-quote release, the account view's
// check and Discard) measures 2644.2 KiB against 2641.7 KiB for origin/main's sources at dd5848ac
// on the same SDK; the aggregate budget rises by the minimum 1 KiB.
// SDK 2.23.0's reverted-quote rules (the release, the retry option, the payment attempt's outcome, the
// saved payment's proof and its strict reader) in place of revnet's copies measure 2645.0 KiB against
// 2644.2 KiB for origin/main's sources at 28a1393e on SDK 2.22.0; the aggregate budget rises by the
// minimum 1 KiB.
// One SDK Safe Relayr lifecycle replaces local preparation/funding/recovery decisions.
// With identical installed dependencies, HEAD 0f41a7d measures 2646.2 KiB and this
// migration 2650.9 KiB; the largest operator route decreases 691.0 -> 689.9 KiB.
// Raise only the aggregate ceiling to its measured integer KiB; route limits stay fixed.
// The build prompt adds progressive skill discovery, shared-token operating
// economics and transaction recovery guidance. On the same locked dependencies,
// HEAD 006935e2 measures 2650.9 KiB and the updated prompt 2651.5 KiB. Raise only
// the aggregate ceiling by the minimum 1 KiB; route limits stay unchanged.
// Safe recovery preserves lifecycle state and checks missing quotes against
// finalized Safe nonces. The final SDK/client build with strict journal guards
// and the updated build prompt measures 2657.1 KiB.
// Round up only the aggregate ceiling; route and wallet-loading limits stay fixed.
// Independent account/queue reads, shared Safe progress and liquidity price markers
// measure 2,725,587 B against HEAD 909cf1fd's 2,717,526 B (+8,061 B), using the same
// physical dependency graph and Node 26.5.0; only the SDK moves from 2.24.2 to 2.24.3.
// Round up only the aggregate ceiling; route and wallet-loading limits stay fixed.
// Shared cross-chain activity grouping and each original transaction link measure
// 2,726,333 B against HEAD 9d88fecc's 2,725,748 B (+585 B) on the same physical
// dependency graph. Round up only the aggregate ceiling; other limits stay fixed.
// Retained navigation with verified identity and bounded read/recovery behavior
// measures 2,733,461 B against clean 81aeb708's 2,726,293 B (+7,168 B, 0.26%) on
// identical physical dependencies. Duplicate server React imports and project
// contexts were removed before measuring. Round up only the aggregate ceiling;
// route-referenced JavaScript is 960,296 B versus 956,388 B; other limits stay fixed.
// Official SDK 2.24.5 plus the reviewed copy, permission and payment changes
// measure 2,734,565 B versus 2,730,720 B on the same physical dependency layout.
// Module copies and route references are unchanged; round only aggregate by 1 KiB.
// Responsive delivery/fidelity guards measure 2,742,956 B versus 2,734,565 B
// on matching physical dependencies, excluding dedicated browser-proof stubs.
// Round only the aggregate ceiling; route and lazy-wallet limits stay unchanged.
const allClientBudgetKiB = Number(process.env.CLIENT_ALL_JS_GZIP_BUDGET_KIB ?? 2679);
const routeBudget = routeBudgetKiB * 1024;
const totalBudget = totalBudgetKiB * 1024;
const allClientBudget = allClientBudgetKiB * 1024;
const buildDirectory = resolve(process.cwd(), ".next");
const buildManifestPath = resolve(buildDirectory, "build-manifest.json");
const appRoutesManifestPath = resolve(buildDirectory, "app-path-routes-manifest.json");
const clientReferenceDirectory = resolve(buildDirectory, "server", "app");

for (const manifestPath of [buildManifestPath, appRoutesManifestPath]) {
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing ${manifestPath}. Run \`npm run build\` before this check.`);
  }
}

const gzipSizes = new Map();

function javascriptAsset(asset) {
  if (typeof asset !== "string") return null;
  // Next appends deployment IDs to chunk URLs. URL decorations are not part
  // of the emitted filename or its identity for budgets and lazy SDK checks.
  // Decode only after removing the suffix, so encoded filename characters
  // remain part of the path and are never treated as URL delimiters.
  const pathname = decodeURIComponent(asset.split(/[?#]/u, 1)[0]);
  if (!pathname.endsWith(".js")) return null;
  const relativePath = relative(buildDirectory, resolve(buildDirectory, pathname));
  if (
    isAbsolute(pathname) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`The build manifest references a client asset outside .next: ${asset}`);
  }
  return relativePath.split(sep).join("/");
}

function gzipSize(relativePath) {
  const cached = gzipSizes.get(relativePath);
  if (cached !== undefined) return cached;

  const absolutePath = resolve(buildDirectory, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`The build manifest references a missing client asset: ${relativePath}`);
  }
  const size = gzipSync(readFileSync(absolutePath), { level: 9 }).byteLength;
  gzipSizes.set(relativePath, size);
  return size;
}

function filesBelow(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

const buildManifest = JSON.parse(readFileSync(buildManifestPath, "utf8"));
const appRoutes = JSON.parse(readFileSync(appRoutesManifestPath, "utf8"));
const rootMainFiles = [
  ...new Set((buildManifest.rootMainFiles ?? []).map(javascriptAsset).filter(Boolean)),
];
const pages = Object.fromEntries(
  filesBelow(clientReferenceDirectory)
    .filter((file) => file.endsWith("_client-reference-manifest.js"))
    .map((file) => {
      const source = readFileSync(file, "utf8");
      const assignment = source.match(/globalThis\.__RSC_MANIFEST\[("(?:\\.|[^"\\])*")\]=/u);
      if (!assignment || assignment.index === undefined) {
        throw new Error(`Could not read the client reference manifest: ${file}`);
      }

      const appPath = JSON.parse(assignment[1]);
      const manifest = JSON.parse(
        source.slice(assignment.index + assignment[0].length).replace(/;\s*$/u, ""),
      );
      const routeAssets = Object.values(manifest.clientModules ?? {}).flatMap(
        (module) => module.chunks ?? [],
      );
      const javascript = [...new Set(routeAssets.map(javascriptAsset).filter(Boolean))];

      return [appRoutes[appPath] ?? appPath, [...new Set([...rootMainFiles, ...javascript])]];
    })
    .filter(([, assets]) => assets.length > rootMainFiles.length),
);

// Routes from `page.browsertest.tsx` compile only into the deterministic
// browser build (next.config.js) and never ship. Their own files, the chunks
// under static/chunks/app/<route>/ (including source-route stubs omitted from
// page manifests), are left out unless a shipped page references them. Any other
// chunk counts, even one only a proof route lists: a shipped route may load it
// on demand.
const appDirectory = resolve(process.cwd(), "src", "app");
const proofRoutes = new Set(
  filesBelow(appDirectory)
    .filter((file) => file.endsWith(`${sep}page.browsertest.tsx`))
    .map((file) => `/${relative(appDirectory, dirname(file)).split(sep).join("/")}`),
);
const shippedPages = Object.entries(pages).filter(([route]) => !proofRoutes.has(route));
const shippedAssets = new Set([...rootMainFiles, ...shippedPages.flatMap(([, assets]) => assets)]);
const proofOnlyAssets = new Set(
  filesBelow(resolve(buildDirectory, "static", "chunks", "app"))
    .filter((file) => file.endsWith(".js"))
    .map((file) => relative(buildDirectory, file).split(sep).join("/"))
    .filter((asset) =>
      [...proofRoutes].some((route) => asset.startsWith(`static/chunks/app${route}/`)),
    )
    .filter((asset) => !shippedAssets.has(asset)),
);

const routes = shippedPages
  .map(([route, assets]) => {
    const javascript = [...new Set(assets.filter((asset) => asset.endsWith(".js")))];
    return {
      route,
      size: javascript.reduce((total, asset) => total + gzipSize(asset), 0),
    };
  })
  .sort((left, right) => right.size - left.size);

if (routes.length === 0) {
  throw new Error("The client build manifest contains no app routes.");
}

const totalSize = [...gzipSizes.values()].reduce((total, size) => total + size, 0);
const allClientFiles = filesBelow(resolve(buildDirectory, "static", "chunks")).filter(
  (file) =>
    file.endsWith(".js") &&
    !proofOnlyAssets.has(relative(buildDirectory, file).split(sep).join("/")),
);
if (allClientFiles.length === 0) {
  throw new Error("The production build contains no client JavaScript chunks.");
}
const allClientSize = allClientFiles.reduce(
  (total, file) => total + gzipSync(readFileSync(file), { level: 9 }).byteLength,
  0,
);
const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const largest = routes[0];

console.log(`Largest app route: ${largest.route} (${kib(largest.size)} gzip)`);
console.log(`Unique app JavaScript: ${kib(totalSize)} gzip`);
console.log(`All client JavaScript: ${kib(allClientSize)} gzip`);
console.log(
  `Budgets: ${routeBudgetKiB} KiB per route, ${totalBudgetKiB} KiB route-referenced, ${allClientBudgetKiB} KiB all client JavaScript`,
);

const failures = [];
for (const route of routes.filter((entry) => entry.size > routeBudget)) {
  failures.push(`${route.route} is ${kib(route.size)} (budget ${routeBudgetKiB} KiB)`);
}
if (totalSize > totalBudget) {
  failures.push(`unique app JavaScript is ${kib(totalSize)} (budget ${totalBudgetKiB} KiB)`);
}
if (allClientSize > allClientBudget) {
  failures.push(
    `all client JavaScript is ${kib(allClientSize)} (budget ${allClientBudgetKiB} KiB)`,
  );
}

// Wagmi's `reconnect()` calls `getProvider()` on every configured connector, so
// a vendor wallet SDK becomes an eager download the moment its `shouldRestore`
// gate is dropped. Markers must be strings only the vendor bundle can contain —
// never a connector id or display name, which our own source carries.
const vendorWallets = [
  ["WalletConnect", ["walletconnect.org", "wc@2:", "@reown/appkit"]],
  ["Coinbase Wallet", ["CoinbaseWalletSDK", "keys.coinbase.com", "walletlink"]],
  ["Safe", ["safe-apps-provider", "SafeAppProvider"]],
];
for (const [label, markers] of vendorWallets) {
  const vendorAssets = new Set(
    allClientFiles
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return markers.some((marker) => source.includes(marker));
      })
      .map((file) => relative(buildDirectory, file).split(sep).join("/")),
  );
  if (vendorAssets.size === 0) continue;
  const eager = Object.values(pages)
    .flat()
    .filter((asset) => vendorAssets.has(asset));
  if (eager.length > 0) {
    failures.push(`${label} SDK is eagerly loaded: ${[...new Set(eager)].join(", ")}`);
  } else {
    console.log(`${label} SDK is lazy-loaded`);
  }
}

if (failures.length > 0) {
  throw new Error(`Client bundle budget exceeded:\n- ${failures.join("\n- ")}`);
}
