// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const nextDirectory = dirname(require.resolve("next/package.json"));
const directories: string[] = [];

async function fixturePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture port allocated");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function buildProject() {
  const directory = mkdtempSync(join(tmpdir(), "image-optimizer-lifecycle-"));
  directories.push(directory);
  function write(path: string, contents: string) {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  write(
    "package.json",
    JSON.stringify({ name: "image-lifecycle-probe", version: "1.0.0", scripts: manifest.scripts }),
  );
  // The production repository intentionally retains this dependency-install policy.
  write(".npmrc", "ignore-scripts=true\n");
  write("node_modules/next/package.json", JSON.stringify({ version: "16.3.8" }));
  for (const path of ["dist/server/image-optimizer.js", "dist/esm/server/image-optimizer.js"]) {
    write(
      `node_modules/next/${path}`,
      readFileSync(join(nextDirectory, path), "utf8").replace(
        "const BYPASS_TYPES = [\n    AVIF,\n",
        "const BYPASS_TYPES = [\n",
      ),
    );
  }
  mkdirSync(join(directory, "scripts"));
  for (const path of ["scripts/prepare-image-optimizer.mjs", "scripts/build-browser.mjs"]) {
    copyFileSync(path, join(directory, path));
  }
  write("scripts/validate-env.mjs", "console.log('fixture environment accepted')\n");
  write(
    "test/fixtures/browser-project.json",
    JSON.stringify({ appPort: 4173, fixturePort: await fixturePort() }),
  );
  write(
    "scripts/browser-fixture-server.mjs",
    `
    import { createServer } from 'node:http';
    import project from '../test/fixtures/browser-project.json' with { type: 'json' };
    createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(req.url === '/healthz' ? {} : { graphqlOperations: { TopSuckerGroups: 1 }, unknownRequests: [] }));
    }).listen(project.fixturePort, '127.0.0.1');
  `,
  );
  // Only the expensive compiler is substituted. The npm entrypoints, patch
  // implementation, pristine framework targets and artifact checks are real.
  const compiler = `#!/usr/bin/env node
    const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
    const { dirname } = require('node:path');
    const path = 'node_modules/next/dist/server/image-optimizer.js';
    const source = readFileSync(path, 'utf8');
    if (!source.includes('const BYPASS_TYPES = [\\n    AVIF,\\n')) throw new Error('compiler received unpatched Next');
    writeFileSync('compiler-ran.json', JSON.stringify(process.argv.slice(2)));
    if (process.argv.includes('build')) {
      const output = '.next/standalone/' + path;
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, process.env.IMAGE_PROBE_CORRUPT_OUTPUT === 'true'
        ? source.replace('const BYPASS_TYPES = [\\n    AVIF,\\n', 'const BYPASS_TYPES = [\\n') : source);
      writeFileSync('.next/standalone/node_modules/next/package.json', JSON.stringify({ version: '16.3.8' }));
    }
  `;
  write("node_modules/next/dist/bin/next", compiler);
  write("node_modules/.bin/next", compiler);
  chmodSync(join(directory, "node_modules/.bin/next"), 0o755);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("image optimizer lifecycle with npm ignore-scripts", () => {
  it.each(["dev", "build", "build:browser"])(
    "prepares actual npm %s before compiler entry",
    async (entrypoint) => {
      const directory = await buildProject();
      const result = spawnSync("npm", ["run", entrypoint], {
        cwd: directory,
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(readFileSync(join(directory, "compiler-ran.json"), "utf8"))[0]).toBe(
        entrypoint === "dev" ? "dev" : "build",
      );
      expect(result.stdout).toContain("2 files patched");
      if (entrypoint !== "dev")
        expect(result.stdout).toContain("Standalone image optimizer preserves AVIF originals");
    },
  );

  it.each(["build", "build:browser"])(
    "rejects an unpatched %s artifact even when hooks are disabled",
    async (entrypoint) => {
      const directory = await buildProject();
      const result = spawnSync("npm", ["run", entrypoint], {
        cwd: directory,
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, IMAGE_PROBE_CORRUPT_OUTPUT: "true" },
      });
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("AVIF compatibility patch missing");
    },
  );
});
