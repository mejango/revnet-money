import { defineConfig } from "@playwright/test";
import browserProject from "./test/fixtures/browser-project.json";

const appPort = browserProject.appPort;
const appOrigin = `http://127.0.0.1:${appPort}`;
const fixturePort = browserProject.fixturePort;
const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;

const deterministicEnvironment = {
  APP_REVISION: "browser-test",
  ENABLE_PUBLIC_IPFS_PINNING: "false",
  HOSTNAME: "127.0.0.1",
  INFURA_IPFS_API_SECRET: "ci-runtime-secret",
  INFURA_IPFS_PROJECT_ID: "ci-runtime-project",
  NEXT_PUBLIC_SITE_URL: appOrigin,
  NEXT_PUBLIC_ARBITRUM_SEPOLIA_SUBGRAPH_URL: `${fixtureOrigin}/graphql`,
  NEXT_PUBLIC_ARBITRUM_SUBGRAPH_URL: `${fixtureOrigin}/graphql`,
  NEXT_PUBLIC_BASE_SEPOLIA_SUBGRAPH_URL: `${fixtureOrigin}/graphql`,
  NEXT_PUBLIC_BASE_SUBGRAPH_URL: `${fixtureOrigin}/graphql`,
  NEXT_PUBLIC_BENDYSTRAW_URL: fixtureOrigin,
  NEXT_PUBLIC_INFURA_IPFS_HOSTNAME: "127.0.0.1",
  NEXT_PUBLIC_MAINNET_SUBGRAPH_URL: `${fixtureOrigin}/graphql`,
  NEXT_PUBLIC_OPTIMISM_SEPOLIA_SUBGRAPH_URL: `${fixtureOrigin}/graphql`,
  NEXT_PUBLIC_OPTIMISM_SUBGRAPH_URL: `${fixtureOrigin}/graphql`,
  NEXT_PUBLIC_RPC_ARBITRUM_SEPOLIA_URLS: `${fixtureOrigin}/rpc`,
  NEXT_PUBLIC_RPC_ARBITRUM_URLS: `${fixtureOrigin}/rpc`,
  NEXT_PUBLIC_RPC_BASE_SEPOLIA_URLS: `${fixtureOrigin}/rpc`,
  NEXT_PUBLIC_RPC_BASE_URLS: `${fixtureOrigin}/rpc`,
  NEXT_PUBLIC_RPC_ETHEREUM_SEPOLIA_URLS: `${fixtureOrigin}/rpc`,
  NEXT_PUBLIC_RPC_ETHEREUM_URLS: `${fixtureOrigin}/rpc`,
  NEXT_PUBLIC_RPC_OPTIMISM_SEPOLIA_URLS: `${fixtureOrigin}/rpc`,
  NEXT_PUBLIC_RPC_OPTIMISM_URLS: `${fixtureOrigin}/rpc`,
  NEXT_PUBLIC_SEPOLIA_SUBGRAPH_URL: `${fixtureOrigin}/graphql`,
  NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL: fixtureOrigin,
  PORT: String(appPort),
};

export default defineConfig({
  testDir: "./test/e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  failOnFlakyTests: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: appOrigin,
    colorScheme: "light",
    contextOptions: { reducedMotion: "reduce" },
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "desktop-1280", use: { viewport: { width: 1280, height: 900 } } },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 } } },
    { name: "mobile-390", use: { viewport: { width: 390, height: 844 } } },
    { name: "narrow-320", use: { viewport: { width: 320, height: 568 } } },
  ],
  webServer: [
    {
      command: "npm run browser:fixture",
      url: `${fixtureOrigin}/healthz`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "npm run standalone:stage && npm run start:standalone",
      url: `${appOrigin}/create`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: deterministicEnvironment,
    },
  ],
});
