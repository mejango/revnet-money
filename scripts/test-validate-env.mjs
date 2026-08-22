import { spawnSync } from "node:child_process";

const buildNames = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_BENDYSTRAW_URL",
  "NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL",
];

const baseEnvironment = {
  ...process.env,
  ...Object.fromEntries(buildNames.map((name) => [name, "https://service.example"])),
  NEXT_PUBLIC_DWELLIR_API_KEY: "dwellir-browser-key",
  NEXT_PUBLIC_PARA_API_KEY: "public-para-key",
  NEXT_PUBLIC_PARA_ENV: "PROD",
  NEXT_PUBLIC_VERSION: "development",
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
    NEXT_PUBLIC_SITE_URL: "http://localhost:3002",
  }),
  0,
);
expectStatus(
  "public plaintext URL",
  run("build", { NEXT_PUBLIC_BENDYSTRAW_URL: "http://bendystraw.example" }),
  1,
);
expectStatus("malformed Dwellir key", run("build", { NEXT_PUBLIC_DWELLIR_API_KEY: "bad/key" }), 1);
expectStatus("invalid Para environment", run("build", { NEXT_PUBLIC_PARA_ENV: "STAGING" }), 1);
expectStatus(
  "production origin with production Para",
  run("build", {
    NEXT_PUBLIC_SITE_URL: "https://revnet.money",
    NEXT_PUBLIC_PARA_ENV: "PROD",
  }),
  0,
);
expectStatus(
  "production origin with non-production Para",
  run("build", {
    NEXT_PUBLIC_SITE_URL: "https://revnet.money",
    NEXT_PUBLIC_PARA_ENV: "BETA",
  }),
  1,
);
expectStatus(
  "loopback development with beta Para",
  run("build", {
    NEXT_PUBLIC_SITE_URL: "http://localhost:3002",
    NEXT_PUBLIC_PARA_ENV: "BETA",
  }),
  0,
);
expectStatus(
  "deployment with deterministic wallet mode",
  run("build", { NEXT_PUBLIC_DETERMINISTIC_BROWSER: "true" }),
  1,
);
expectStatus("runtime has no app-owned secrets", run("runtime"), 0);

console.log(
  "Environment validation fixtures passed (HTTPS, Dwellir, Para, and no runtime secrets).",
);
