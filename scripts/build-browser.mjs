import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import browserProject from "../test/fixtures/browser-project.json" with { type: "json" };

const fixtureOrigin = `http://127.0.0.1:${browserProject.fixturePort}`;
const fixtureGraphql = `${fixtureOrigin}/graphql`;
const fixtureRpc = `${fixtureOrigin}/rpc`;
const environment = {
  ...process.env,
  NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${browserProject.appPort}`,
  NEXT_PUBLIC_BENDYSTRAW_URL: fixtureOrigin,
  NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL: fixtureOrigin,
  NEXT_PUBLIC_INFURA_IPFS_HOSTNAME: "127.0.0.1",
  NEXT_PUBLIC_MAINNET_SUBGRAPH_URL: fixtureGraphql,
  NEXT_PUBLIC_OPTIMISM_SUBGRAPH_URL: fixtureGraphql,
  NEXT_PUBLIC_BASE_SUBGRAPH_URL: fixtureGraphql,
  NEXT_PUBLIC_ARBITRUM_SUBGRAPH_URL: fixtureGraphql,
  NEXT_PUBLIC_SEPOLIA_SUBGRAPH_URL: fixtureGraphql,
  NEXT_PUBLIC_OPTIMISM_SEPOLIA_SUBGRAPH_URL: fixtureGraphql,
  NEXT_PUBLIC_BASE_SEPOLIA_SUBGRAPH_URL: fixtureGraphql,
  NEXT_PUBLIC_ARBITRUM_SEPOLIA_SUBGRAPH_URL: fixtureGraphql,
  NEXT_PUBLIC_RPC_ETHEREUM_URLS: fixtureRpc,
  NEXT_PUBLIC_RPC_OPTIMISM_URLS: fixtureRpc,
  NEXT_PUBLIC_RPC_BASE_URLS: fixtureRpc,
  NEXT_PUBLIC_RPC_ARBITRUM_URLS: fixtureRpc,
  NEXT_PUBLIC_RPC_ETHEREUM_SEPOLIA_URLS: fixtureRpc,
  NEXT_PUBLIC_RPC_OPTIMISM_SEPOLIA_URLS: fixtureRpc,
  NEXT_PUBLIC_RPC_BASE_SEPOLIA_URLS: fixtureRpc,
  NEXT_PUBLIC_RPC_ARBITRUM_SEPOLIA_URLS: fixtureRpc,
};

function run(command, args) {
  const result = spawnSync(command, args, { env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status ?? 1}`);
  }
}

run(process.execPath, ["scripts/validate-env.mjs", "build"]);
// A prior Next data cache could otherwise hide whether this build actually
// exercised the deterministic contract-derived fixture.
rmSync(new URL("../.next/cache", import.meta.url), { recursive: true, force: true });

const fixture = spawn(process.execPath, ["scripts/browser-fixture-server.mjs"], {
  env: environment,
  stdio: "inherit",
});
try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (fixture.exitCode !== null) {
      throw new Error(`Browser fixture exited before build (status ${fixture.exitCode})`);
    }
    try {
      const response = await fetch(`${fixtureOrigin}/healthz`, {
        signal: AbortSignal.timeout(250),
      });
      if (response.ok) break;
    } catch {
      // The child has not bound the loopback listener yet.
    }
    if (attempt === 49) throw new Error("Browser fixture did not become ready for the build");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  run(process.execPath, ["node_modules/next/dist/bin/next", "build", "--webpack"]);
  const statusResponse = await fetch(`${fixtureOrigin}/__fixture/status`, {
    signal: AbortSignal.timeout(1_000),
  });
  if (!statusResponse.ok) throw new Error("Browser fixture status was unavailable after build");
  const status = await statusResponse.json();
  if (status.unknownRequests?.length) {
    throw new Error(
      `Production build made unsupported fixture requests: ${JSON.stringify(status.unknownRequests)}`,
    );
  }
  if (!(status.graphqlOperations?.TopSuckerGroups > 0)) {
    throw new Error("Production build did not render the populated TopSuckerGroups fixture");
  }
} finally {
  fixture.kill("SIGTERM");
}
