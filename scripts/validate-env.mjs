const BUILD_VALUES = {
  NEXT_PUBLIC_SITE_URL: "url",
  NEXT_PUBLIC_BENDYSTRAW_URL: "url",
  NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL: "url",
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "text",
  NEXT_PUBLIC_INFURA_IPFS_HOSTNAME: "hostname",
  NEXT_PUBLIC_MAINNET_SUBGRAPH_URL: "url",
  NEXT_PUBLIC_OPTIMISM_SUBGRAPH_URL: "url",
  NEXT_PUBLIC_BASE_SUBGRAPH_URL: "url",
  NEXT_PUBLIC_ARBITRUM_SUBGRAPH_URL: "url",
  NEXT_PUBLIC_SEPOLIA_SUBGRAPH_URL: "url",
  NEXT_PUBLIC_OPTIMISM_SEPOLIA_SUBGRAPH_URL: "url",
  NEXT_PUBLIC_BASE_SEPOLIA_SUBGRAPH_URL: "url",
  NEXT_PUBLIC_ARBITRUM_SEPOLIA_SUBGRAPH_URL: "url",
  NEXT_PUBLIC_RPC_ETHEREUM_URLS: "url-list",
  NEXT_PUBLIC_RPC_OPTIMISM_URLS: "url-list",
  NEXT_PUBLIC_RPC_BASE_URLS: "url-list",
  NEXT_PUBLIC_RPC_ARBITRUM_URLS: "url-list",
  NEXT_PUBLIC_RPC_ETHEREUM_SEPOLIA_URLS: "url-list",
  NEXT_PUBLIC_RPC_OPTIMISM_SEPOLIA_URLS: "url-list",
  NEXT_PUBLIC_RPC_BASE_SEPOLIA_URLS: "url-list",
  NEXT_PUBLIC_RPC_ARBITRUM_SEPOLIA_URLS: "url-list",
};

const RUNTIME_VALUES = { ENABLE_PUBLIC_IPFS_PINNING: "boolean" };

function validUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function validate(name, kind) {
  const value = process.env[name]?.trim();
  if (!value) return `${name} is required`;

  if (kind === "url" && !validUrl(value)) {
    return `${name} must use HTTPS (HTTP is allowed only for loopback development)`;
  }
  if (kind === "url-list") {
    const urls = value.split(",").map((entry) => entry.trim());
    if (urls.some((url) => !url || !validUrl(url))) {
      return `${name} must be a comma-separated list of HTTPS URLs (HTTP is loopback-only)`;
    }
  }
  if (
    kind === "hostname" &&
    !/^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)*[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(value)
  ) {
    return `${name} must be a hostname without a scheme or path`;
  }
  if (kind === "boolean" && value !== "true" && value !== "false") {
    return `${name} must be either true or false`;
  }
  if (kind === "secret" && value.length < 32) {
    return `${name} must be at least 32 characters`;
  }
  return null;
}

const phase = process.argv[2];
if (phase !== "build" && phase !== "runtime") {
  console.error("Usage: node scripts/validate-env.mjs <build|runtime>");
  process.exit(2);
}

const specification = phase === "build" ? BUILD_VALUES : RUNTIME_VALUES;
const entries = Object.entries(specification);
if (phase === "runtime" && process.env.ENABLE_PUBLIC_IPFS_PINNING === "true") {
  entries.push(
    ["INFURA_IPFS_PROJECT_ID", "text"],
    ["INFURA_IPFS_API_SECRET", "text"],
    ["IPFS_PINNING_INGRESS_TOKEN", "secret"],
  );
}
const errors = entries.map(([name, kind]) => validate(name, kind)).filter(Boolean);

if (errors.length) {
  console.error(`Invalid ${phase}-time environment:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log(`Validated ${entries.length} ${phase}-time environment values.`);
