import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { format, resolveConfig } from "prettier";
import { executedDeploymentAddress } from "./lib/protocol-rollout-artifacts.mjs";

// Only canonical executed deployment records enable a chain. Proposal output is
// deliberately not an input: after execution the same command updates the app.
const root = resolve(process.env.PROTOCOL_DEPLOYMENTS_DIR ?? "../../deploy-all-v6");
const chainNames = {
  1: "ethereum",
  10: "optimism",
  8453: "base",
  42161: "arbitrum",
  11155111: "sepolia",
  11155420: "optimism_sepolia",
  84532: "base_sepolia",
  421614: "arbitrum_sepolia",
};
const names = [
  "JBDirectory",
  "JBBuybackHook",
  "JBBuybackHookRegistry",
  "JBRouterTerminal",
  "JBRouterTerminalRegistry",
  "JBRouterTerminalGateway",
  "JBRatioPriceFeed",
];
const read = (chain, name) => {
  const path = join(root, "deployments", chain, `${name}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
};
const chains = {};
let gatewayAbi;
for (const [id, alias] of Object.entries(chainNames)) {
  const contracts = {};
  for (const name of names)
    contracts[name] = executedDeploymentAddress(read(alias, name), id, name);
  const history = {};
  for (const name of ["JBBuybackHook", "JBRouterTerminal"]) {
    history[name] = {
      previous:
        executedDeploymentAddress(read(alias, `${name}_deprecated1`), id, name) ??
        (!contracts.JBRouterTerminalGateway ? contracts[name] : null),
      v1: executedDeploymentAddress(read(alias, `${name}_deprecated`), id, name),
    };
  }
  chains[id] = { alias, contracts, history };
  gatewayAbi ??= read(alias, "JBRouterTerminalGateway")?.abi;
}
if (!gatewayAbi)
  throw new Error(
    "No executed gateway artifact found; use the canonical rollout deployment checkout.",
  );
const source = {
  repository: "deploy-all-v6",
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
};
const snapshot = { source, chains };
const abiNames = new Set([
  "ROUTER",
  "pendingCallCount",
  "pendingCallCommitmentOf",
  "pendingCallFailureOf",
  "processPendingCall",
  "processPendingCallWithGas",
  "finalizePendingCall",
  "finalizePendingCallWithGas",
]);
const abi = gatewayAbi.filter(
  (item) =>
    (item.type === "function" && abiNames.has(item.name)) ||
    (item.type === "event" && item.name.startsWith("JBRouterTerminalGateway_")),
);
const outputs = {
  "src/lib/protocol-rollout.json": `${JSON.stringify(snapshot, null, 2)}\n`,
  "src/lib/router-gateway-abi.ts": `// Generated from an executed JBRouterTerminalGateway artifact by scripts/generate-protocol-rollout.mjs.\nexport const routerGatewayAbi = ${JSON.stringify(abi, null, 2)} as const\n`,
};
const fixturePath = "test/fixtures/protocol-deployments.v6.json";
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
fixture.source.commit = source.commit;
for (const chain of Object.values(fixture.chains)) {
  const entries = [
    chain.revDeployer,
    ...Object.values(chain.ccipSuckerDeployers),
    ...Object.values(chain.nativeSuckerDeployers),
  ];
  for (const entry of entries) {
    const artifact = read(chain.deploymentDirectory, entry.artifact);
    if (!artifact?.address)
      throw new Error(`Missing ${chain.deploymentDirectory}/${entry.artifact}`);
    entry.address = executedDeploymentAddress(
      artifact,
      Object.entries(chainNames).find(([, alias]) => alias === chain.deploymentDirectory)[0],
      entry.artifact.split("__")[0],
    );
  }
}
outputs[fixturePath] = `${JSON.stringify(fixture, null, 2)}\n`;
for (const [path, output] of Object.entries(outputs)) {
  const data = await format(output, { ...(await resolveConfig(path)), filepath: path });
  if (process.argv.includes("--check")) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== data)
      throw new Error(`Stale generated rollout file: ${path}`);
  } else writeFileSync(path, data);
}
console.log(
  `Verified rollout records for ${Object.keys(chains).length} chains at ${source.commit}.`,
);
