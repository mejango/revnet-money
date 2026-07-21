[![revnet badge](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapp.revnet.eth.sucks%2Fapi%2Fdata%2Fshields%3FprojectId%3D3%26chainId%3D1&query=%24.message&label=Revnet%20Network&cacheSeconds=3600)](https://app.revnet.eth.sucks/base:3)


Revnet Money is the v6-only Revnet application. Project routes use
`<chain>:<projectId>` (for example, `/eth:3`).

This is a [wagmi](https://wagmi.sh) + [ConnectKit](https://docs.family.co/connectkit) + [Next.js](https://nextjs.org) + Tailwind + [Juicebox](https://juicebox.money) project.

# Getting Started

1. Create a `.env` file and set environment variables (use `.env.example` as a starting point).
1. Install dependencies:

   ```
   npm install
   ```

1. Run the app:

   ```
   npm run dev
   ```

## Resource

- Revnet v6 contracts: https://github.com/rev-net/revnet-core-v6
