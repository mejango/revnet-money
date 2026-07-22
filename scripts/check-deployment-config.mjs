import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";

const dockerfile = await readFile("Dockerfile", "utf8");
const wagmi = await readFile("src/lib/wagmiConfig.ts", "utf8");
const release = await readFile(".github/workflows/release-container.yml", "utf8");
const ci = await readFile(".github/workflows/ci.yml", "utf8");
const exampleEnvironment = await readFile(".env.example", "utf8");
const nextConfig = await readFile("next.config.js", "utf8");
const playwright = await readFile("playwright.config.ts", "utf8");
const browserFixture = await readFile("scripts/browser-fixture-server.mjs", "utf8");
const browserBuild = await readFile("scripts/build-browser.mjs", "utf8");
const browserProject = JSON.parse(await readFile("test/fixtures/browser-project.json", "utf8"));
const ipfsProxy = await readFile("src/app/api/ipfs/[...path]/route.ts", "utf8");
const gitignore = await readFile(".gitignore", "utf8");
const dockerignore = await readFile(".dockerignore", "utf8");
const packageManifest = JSON.parse(await readFile("package.json", "utf8"));

if (existsSync("yarn.lock")) {
  throw new Error("Only package-lock.json is allowed; remove the stale Yarn Classic lockfile");
}
if (!existsSync("package-lock.json") || packageManifest.packageManager !== "npm@10.9.2") {
  throw new Error("The deployment must use the npm 10.9.2 package lock");
}
if (
  !dockerfile.includes("COPY package.json package-lock.json ./") ||
  !dockerfile.includes("npm ci --ignore-scripts --no-audit --no-fund")
) {
  throw new Error("The container must install the npm lockfile without lifecycle scripts");
}
if (packageManifest.scripts?.["audit:production"] !== "npm audit --omit=dev --audit-level=high") {
  throw new Error("The production dependency audit must fail on high or critical advisories");
}
if (packageManifest.scripts?.["dependencies:check"] !== "npm ls --depth=0") {
  throw new Error("The installed dependency tree must have an explicit npm integrity gate");
}
if (
  packageManifest.dependencies?.next !== "16.2.11" ||
  packageManifest.devDependencies?.["eslint-config-next"] !== "16.2.11"
) {
  throw new Error("Next and eslint-config-next must remain on the supported 16.2.11 baseline");
}
for (const [name, workflow] of [
  ["CI", ci],
  ["release", release],
]) {
  const installIndex = workflow.indexOf("npm ci --ignore-scripts");
  const integrityIndex = workflow.indexOf("npm run dependencies:check");
  const auditIndex = workflow.indexOf("npm run audit:production");
  if (
    installIndex < 0 ||
    integrityIndex < installIndex ||
    auditIndex < integrityIndex ||
    integrityIndex === auditIndex
  ) {
    throw new Error(
      `${name} must verify install integrity, then separately audit production dependencies`,
    );
  }
}
if (!release.includes("npm run check")) {
  throw new Error("Release must invoke the package release-equivalent gate");
}
if (
  packageManifest.scripts?.["build:browser"] !== "node scripts/build-browser.mjs" ||
  !packageManifest.scripts?.check?.includes("npm run build:browser") ||
  !ci.includes("npm run build:browser") ||
  !Number.isInteger(browserProject.fixturePort) ||
  !browserBuild.includes("browserProject.fixturePort") ||
  !browserBuild.includes('spawn(process.execPath, ["scripts/browser-fixture-server.mjs"]') ||
  !browserBuild.includes("/__fixture/status")
) {
  throw new Error("The production browser build must compile the deterministic fixture endpoints");
}
if (!ci.includes("npm run env:test && npm run deployment:check")) {
  throw new Error("CI must execute environment and deployment policy fixtures");
}

const aliases = new Set();
const baseImages = [];
for (const match of dockerfile.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/gimu)) {
  const [, image, alias] = match;
  if (!aliases.has(image)) baseImages.push(image);
  if (alias) aliases.add(alias);
}
if (!baseImages.length || baseImages.some((image) => !/:\S+@sha256:[a-f\d]{64}$/u.test(image))) {
  throw new Error("Every Docker base image must include an exact tag and sha256 index digest");
}
if (/^#\s*syntax=/mu.test(dockerfile)) {
  throw new Error("Dockerfile must not use a mutable frontend syntax image");
}
for (const [name, source] of [
  [".gitignore", gitignore],
  [".dockerignore", dockerignore],
]) {
  for (const pattern of ["*.pem", "*.key"]) {
    if (!source.split(/\r?\n/u).includes(pattern)) {
      throw new Error(`${name} must ignore ${pattern}`);
    }
  }
}
for (const required of ["USER nextjs", "HEALTHCHECK", 'output: "standalone"']) {
  const source = required.startsWith("output")
    ? await readFile("next.config.js", "utf8")
    : dockerfile;
  if (!source.includes(required)) throw new Error(`Missing deployment invariant: ${required}`);
}
if (
  !playwright.includes('command: "npm run standalone:stage && npm run start:standalone"') ||
  !playwright.includes('command: "npm run browser:fixture"') ||
  !browserFixture.includes("/__fixture/status") ||
  !browserFixture.includes("decodeFunctionData") ||
  !browserFixture.includes("unknownRequests") ||
  packageManifest.scripts?.["standalone:stage"] !== "node scripts/stage-standalone.mjs"
) {
  throw new Error(
    "Browser tests must exercise standalone production against the strict ABI-aware fixture",
  );
}

if (/debug:\s*true/u.test(wagmi))
  throw new Error("Safe connector debug logging must not be forced on");
if (/alchemy\.com\/v2\/[A-Za-z\d_-]{8,}/u.test(wagmi)) {
  throw new Error("Provider credentials must not be committed in RPC URLs");
}
if (/hostname:\s*["']\*\*/u.test(nextConfig) || /pathname:\s*["']\*\*/u.test(nextConfig)) {
  throw new Error("Next image optimization must not allow arbitrary remote hosts or paths");
}
if (
  !/cache:\s*["']no-store["']/u.test(ipfsProxy) ||
  /cache:\s*["']force-cache["']/u.test(ipfsProxy)
) {
  throw new Error("Attacker-selected IPFS CIDs must bypass Next's persistent server data cache");
}

if (!/sbom:\s*true/u.test(release) || !/provenance:\s*mode=max/u.test(release)) {
  throw new Error("Container releases must publish an SBOM and maximal provenance");
}
if (/type=raw,value=latest/u.test(release)) {
  throw new Error("Container releases must not publish an ambiguous latest tag");
}

const workflowFiles = (await readdir(".github/workflows"))
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => `.github/workflows/${name}`);
for (const file of workflowFiles) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/^\s*uses:\s*([^\s#]+)/gmu)) {
    const reference = match[1];
    if (reference.startsWith("./")) continue;
    if (!/@[a-f\d]{40}$/u.test(reference)) {
      throw new Error(`${file} contains a mutable action reference: ${reference}`);
    }
  }
}

for (const name of [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_RPC_ETHEREUM_URLS",
  "ENABLE_PUBLIC_IPFS_PINNING",
  "INFURA_IPFS_API_SECRET",
  "IPFS_PINNING_INGRESS_TOKEN",
]) {
  if (!exampleEnvironment.includes(`${name}=`)) {
    throw new Error(`.env.example is missing ${name}`);
  }
}

console.log(
  `Deployment config verified: ${baseImages.length} digest-pinned base, ${workflowFiles.length} immutable workflows, no embedded RPC credentials.`,
);
