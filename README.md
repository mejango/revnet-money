[![revnet badge](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapp.revnet.eth.sucks%2Fapi%2Fdata%2Fshields%3FprojectId%3D3%26chainId%3D1&query=%24.message&label=Revnet%20Network&cacheSeconds=3600)](https://app.revnet.eth.sucks/base:3)

Revnet Money is the v6-only Revnet application. Project routes use
`<chain>:<projectId>` (for example, `/eth:3`).

This is a [wagmi](https://wagmi.sh) + [Next.js](https://nextjs.org) + Tailwind +
[Juicebox](https://juicebox.money) project. Installed browser wallets are
discovered through EIP-6963 with a generic injected-provider fallback.

# Getting Started

1. Install the exact Node release in `.nvmrc`, then create local configuration:

   ```sh
   cp .env.example .env.local
   ```

   Every public RPC variable accepts a comma-separated provider list. Use at
   least two independently operated endpoints per production chain.

1. Install dependencies:

   ```
   npm ci
   ```

1. Run the app:

   ```
   npm run dev
   ```

See [TESTING.md](./TESTING.md) for the invariant suite, transaction coverage inventory, and CI gates.

After `npm run build`, run `npm run test:browser` for deterministic production layout, keyboard, and accessibility checks at the supported viewport widths.

`npm run check` is the release-equivalent local gate. See
[DEPLOYMENT.md](./DEPLOYMENT.md) for the standalone container, configuration,
GHCR release, health check, rollback, and IPFS pinning controls. The runtime
architecture decision is recorded in
[ADR 0001](./docs/architecture/0001-frontend-runtime.md).

## Resource

- Revnet v6 contracts: https://github.com/rev-net/revnet-core-v6
