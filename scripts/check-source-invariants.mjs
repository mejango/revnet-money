import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

const failures = [];
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function sourceFiles(root) {
  const files = [];
  for (const entry of readdirSync(new URL(`../${root}`, import.meta.url), {
    withFileTypes: true,
  })) {
    const relative = join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(relative));
    else if ([".ts", ".tsx", ".js", ".jsx"].includes(extname(entry.name))) {
      files.push(relative);
    }
  }
  return files;
}

for (const path of sourceFiles("src")) {
  const source = read(path);
  if (/from\s+["']viem\/chains["']/.test(source)) {
    failures.push(
      `${path}: production code must use the SDK's supported chain definitions, not the all-chain viem barrel`,
    );
  }
  if (
    /import\s+["']server-only["']/.test(source) &&
    /from\s+["']@tanstack\/react-query["']/.test(source)
  ) {
    failures.push(
      `${path}: server-only query owners must import @tanstack/query-core to avoid emitting React client-hook references`,
    );
  }
}

if (
  read("src/app/globals.css").includes("tailwind.config.ts") ||
  JSON.parse(read("components.json")).tailwind?.config !== "tailwind.config.mjs"
) {
  failures.push("Tailwind must load the warning-free ESM config");
}

// Cross-client rules have one SDK owner; these files are compatibility adapters.
const rpcTransport = read("src/lib/jbcenter-rpc.ts");
if (
  !rpcTransport.includes("createPacedJBCenterLimiter()") ||
  !/limiter: typeof window === ["']undefined["'] \? undefined : browserLimiter/.test(
    rpcTransport,
  ) ||
  rpcTransport.includes("createPacedRpcFetch")
) {
  failures.push(
    "Browser RPC pacing must use the shared SDK provider limiter before timeout creation",
  );
}

const safeTransactions = read("src/lib/safe-transactions.ts");
if (
  !safeTransactions.includes("safeTransactionRunsCalls as runsCalls") ||
  !/return runsCalls\(tx, calls, batch\);/.test(safeTransactions)
) {
  failures.push("Safe transaction matching must pass the explicit batch policy to the SDK owner");
}

const reviewedWrite = read("src/hooks/useReviewedWriteContract.ts");
if (
  !reviewedWrite.includes("submitReviewedContractWrite({") ||
  !/import \{[^}]*\bsubmitReviewedContractWrite\b[^}]*\} from ["']@bananapus\/nana-sdk-core\/review["']/.test(
    reviewedWrite,
  )
) {
  failures.push(
    "Reviewed contract writes must delegate their wallet boundary to the shared SDK owner",
  );
}
if (
  !reviewedWrite.includes(
    "safeExecutionRunsCalls(transaction, safe, proposal.calls, proposal.batch)",
  )
) {
  failures.push("Reviewed Safe execution must pass the explicit batch policy to the SDK owner");
}
const utils = read("src/lib/utils.ts");
if (
  !utils.includes(
    'import { transactionMessage as formatTransactionMessage } from "@bananapus/nana-sdk-core/review"',
  )
) {
  failures.push("Transaction presentation must use the shared SDK owner");
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("Source build invariants verified.");
