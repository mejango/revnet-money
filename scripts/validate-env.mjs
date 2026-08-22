const BUILD_VALUES = {
  NEXT_PUBLIC_SITE_URL: "url",
  NEXT_PUBLIC_BENDYSTRAW_URL: "url",
  NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL: "url",
  NEXT_PUBLIC_PARA_API_KEY: "para-key",
  NEXT_PUBLIC_PARA_ENV: "para-env",
  NEXT_PUBLIC_DWELLIR_API_KEY: "public-key",
  NEXT_PUBLIC_VERSION: "revision",
};

const PRODUCTION_SITE_ORIGIN = "https://revnet.money";

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
  if (kind === "para-key" && value.length < 8) {
    return `${name} must be at least 8 characters`;
  }
  if (kind === "public-key" && !/^[A-Za-z\d_-]{8,128}$/u.test(value)) {
    return `${name} must be an 8-128 character URL-safe API key`;
  }
  if (kind === "revision" && value.length < 7) {
    return `${name} must be at least 7 characters`;
  }
  if (kind === "para-env" && !["DEV", "SANDBOX", "BETA", "PROD"].includes(value)) {
    return `${name} must be DEV, SANDBOX, BETA, or PROD`;
  }
  return null;
}

const phase = process.argv[2];
if (phase !== "build" && phase !== "runtime") {
  console.error("Usage: node scripts/validate-env.mjs <build|runtime>");
  process.exit(2);
}

const specification = phase === "build" ? BUILD_VALUES : {};
const entries = Object.entries(specification);
const errors = entries.map(([name, kind]) => validate(name, kind)).filter(Boolean);
if (phase === "build" && process.env.NEXT_PUBLIC_DETERMINISTIC_BROWSER === "true") {
  errors.push("NEXT_PUBLIC_DETERMINISTIC_BROWSER cannot be enabled in a deployment build");
}
if (phase === "build") {
  try {
    const siteOrigin = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "").origin;
    if (siteOrigin === PRODUCTION_SITE_ORIGIN && process.env.NEXT_PUBLIC_PARA_ENV !== "PROD") {
      errors.push("NEXT_PUBLIC_PARA_ENV must be PROD for the production Revnet origin");
    }
  } catch {
    // The ordinary URL validator above reports the malformed or absent value.
  }
}

if (errors.length) {
  console.error(`Invalid ${phase}-time environment:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log(`Validated ${entries.length} ${phase}-time environment values.`);
