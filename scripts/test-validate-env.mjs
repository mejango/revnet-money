import { spawnSync } from "node:child_process";

const buildNames = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_BENDYSTRAW_URL",
  "NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL",
  "NEXT_PUBLIC_MAINNET_SUBGRAPH_URL",
  "NEXT_PUBLIC_OPTIMISM_SUBGRAPH_URL",
  "NEXT_PUBLIC_BASE_SUBGRAPH_URL",
  "NEXT_PUBLIC_ARBITRUM_SUBGRAPH_URL",
  "NEXT_PUBLIC_SEPOLIA_SUBGRAPH_URL",
  "NEXT_PUBLIC_OPTIMISM_SEPOLIA_SUBGRAPH_URL",
  "NEXT_PUBLIC_BASE_SEPOLIA_SUBGRAPH_URL",
  "NEXT_PUBLIC_ARBITRUM_SEPOLIA_SUBGRAPH_URL",
  "NEXT_PUBLIC_RPC_ETHEREUM_URLS",
  "NEXT_PUBLIC_RPC_OPTIMISM_URLS",
  "NEXT_PUBLIC_RPC_BASE_URLS",
  "NEXT_PUBLIC_RPC_ARBITRUM_URLS",
  "NEXT_PUBLIC_RPC_ETHEREUM_SEPOLIA_URLS",
  "NEXT_PUBLIC_RPC_OPTIMISM_SEPOLIA_URLS",
  "NEXT_PUBLIC_RPC_BASE_SEPOLIA_URLS",
  "NEXT_PUBLIC_RPC_ARBITRUM_SEPOLIA_URLS",
];

const baseEnvironment = {
  ...process.env,
  ...Object.fromEntries(buildNames.map((name) => [name, "https://service.example"])),
  NEXT_PUBLIC_INFURA_IPFS_HOSTNAME: "ipfs.example",
};

function run(phase, overrides = {}) {
  return spawnSync(process.execPath, ["scripts/validate-env.mjs", phase], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...baseEnvironment, ...overrides },
  });
}

function expectStatus(label, result, status) {
  if (result.status !== status) {
    throw new Error(
      `${label}: expected exit ${status}, got ${result.status}\n${result.stdout}${result.stderr}`,
    );
  }
}

expectStatus("valid HTTPS build values", run("build"), 0);
expectStatus(
  "loopback HTTP development values",
  run("build", {
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    NEXT_PUBLIC_RPC_ETHEREUM_URLS: "http://127.0.0.1:8545,http://[::1]:8546",
  }),
  0,
);
expectStatus(
  "public plaintext URL",
  run("build", { NEXT_PUBLIC_BENDYSTRAW_URL: "http://bendystraw.example" }),
  1,
);
expectStatus(
  "malformed fallback URL list",
  run("build", { NEXT_PUBLIC_RPC_BASE_URLS: "https://rpc.example,not-a-url" }),
  1,
);
expectStatus(
  "disabled public pinning",
  run("runtime", {
    ENABLE_PUBLIC_IPFS_PINNING: "false",
    INFURA_IPFS_PROJECT_ID: "",
    INFURA_IPFS_API_SECRET: "",
  }),
  0,
);
expectStatus(
  "enabled public pinning with runtime secrets",
  run("runtime", {
    ENABLE_PUBLIC_IPFS_PINNING: "true",
    INFURA_IPFS_PROJECT_ID: "runtime-project",
    INFURA_IPFS_API_SECRET: "runtime-secret",
    IPFS_PINNING_INGRESS_TOKEN: "a-secure-ingress-token-at-least-32-characters",
  }),
  0,
);
expectStatus(
  "missing runtime secret",
  run("runtime", {
    ENABLE_PUBLIC_IPFS_PINNING: "true",
    INFURA_IPFS_PROJECT_ID: "runtime-project",
    INFURA_IPFS_API_SECRET: "",
    IPFS_PINNING_INGRESS_TOKEN: "a-secure-ingress-token-at-least-32-characters",
  }),
  1,
);
expectStatus(
  "short ingress token",
  run("runtime", {
    ENABLE_PUBLIC_IPFS_PINNING: "true",
    INFURA_IPFS_PROJECT_ID: "runtime-project",
    INFURA_IPFS_API_SECRET: "runtime-secret",
    IPFS_PINNING_INGRESS_TOKEN: "too-short",
  }),
  1,
);
expectStatus("invalid pinning switch", run("runtime", { ENABLE_PUBLIC_IPFS_PINNING: "yes" }), 1);

console.log(
  "Environment validation fixtures passed (HTTPS, loopback, lists, and runtime secrets). ",
);
