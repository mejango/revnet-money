const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: __dirname,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  webpack(config, { webpack }) {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false };
    // Para dynamically imports optional peers we do not use (Farcaster
    // mini-apps, Cosmos + Solana wallets); resolve them to empty modules.
    // Only the focused EVM connector is configured, so these paths never run.
    config.resolve.alias["@farcaster/miniapp-sdk"] = false;
    config.resolve.alias["@farcaster/miniapp-wagmi-connector"] = false;
    config.resolve.alias["@getpara/cosmos-wallet-connectors"] = false;
    config.resolve.alias["@getpara/evm-wallet-connectors"] = false;
    config.resolve.alias["@getpara/solana-wallet-connectors"] = false;
    // Para's Wagmi bridge imports the connector barrel for `injected`. Wagmi 3
    // deliberately makes that barrel's vendor SDKs optional, so resolve it to
    // core's public connector export instead of installing unused wallet SDKs.
    config.resolve.alias["wagmi/connectors$"] = "@wagmi/core";
    config.resolve.alias["@x402/core"] = false;
    config.resolve.alias["@x402/evm"] = false;
    config.resolve.alias["@x402/svm"] = false;
    config.resolve.alias["@react-native-async-storage/async-storage"] = false;
    for (const provider of [
      "alchemy",
      "biconomy",
      "cdp",
      "gelato",
      "pimlico",
      "porto",
      "rhinestone",
      "safe",
      "thirdweb",
      "zerodev",
    ]) {
      config.resolve.alias[`@getpara/aa-${provider}`] = false;
    }
    // @coinbase/wallet-sdk's worker ends in `export {}`, which Next's minifier
    // rejects when webpack emits it as a classic worker.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /[\\/]HeartbeatWorker(\.js)?$/,
        `${__dirname}/src/vendor/HeartbeatWorker.js`,
      ),
    );
    return config;
  },
  images: {
    // Content-addressed project media and hashed app artwork can safely retain
    // optimized variants for a year.
    minimumCacheTTL: 60 * 60 * 24 * 365,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.stamp.fyi",
        port: "",
        pathname: "/avatar/**",
      },
    ],
    unoptimized: false,
  },
};
