import { USDC_ADDRESSES } from "@/app/constants";
import { parseDeployData } from "@/app/create/helpers/parseDeployData";
import {
  ETH_CURRENCY_ID,
  NATIVE_TOKEN,
  NATIVE_TOKEN_DECIMALS,
  SPLITS_TOTAL_PERCENT,
  USD_CURRENCY_ID,
} from "@bananapus/nana-sdk-core";
import { tokenCurrencyId } from "@bananapus/nana-sdk-core/v6";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  parseUnits,
  type AbiParameter,
} from "viem";
import { baseSepolia, sepolia } from "viem/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEPLOY_ALL_FIXTURE_COMMIT,
  EMPTY_SUCKER_CONFIG,
  SEPOLIA_REV_DEPLOYER,
  TEST_ACCOUNT,
  TEST_BENEFICIARY,
  TEST_SALT,
  TEST_TIMESTAMP,
  validRevnetForm,
} from "./fixtures/revnet";

const CREATION_FEE = 123_456n;
const CUSTOM_TOKEN = "0x000000000000000000000000000000000000d00d";

function buildRequest(
  reserveAsset: "ETH" | "USDC" | "ETH_USDC" | "CUSTOM" = "ETH",
  issuanceBaseCurrency: "ETH" | "USD" = "ETH",
) {
  const form = validRevnetForm();
  form.reserveAsset = reserveAsset;
  form.issuanceBaseCurrency = issuanceBaseCurrency;
  if (reserveAsset === "CUSTOM") {
    form.customReserveAsset = {
      address: CUSTOM_TOKEN,
      symbol: "DAI",
      decimals: 6,
      verifiedChainIds: [sepolia.id],
    };
  }
  return parseDeployData(form, {
    metadataCid: "bafy-metadata",
    chainId: sepolia.id,
    suckerDeployerConfig: EMPTY_SUCKER_CONFIG,
    timestamp: TEST_TIMESTAMP,
    salt: TEST_SALT,
    creationFee: CREATION_FEE,
  });
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("wallet-action:create-revnet — REVDeployer deployment encoding", () => {
  it("targets the contract-derived deploy-all fixture, independently of the SDK address book", () => {
    const request = buildRequest();

    expect(DEPLOY_ALL_FIXTURE_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    expect(request.address).toBe(SEPOLIA_REV_DEPLOYER);
  });

  it("selects and round-trips the canonical four-argument deployFor overload", () => {
    const request = buildRequest();
    const data = encodeFunctionData({
      abi: request.abi,
      functionName: request.functionName,
      args: request.args,
    });
    const decoded = decodeFunctionData({ abi: request.abi, data });

    expect(data.slice(0, 10)).toBe("0x54ca091d");
    expect(decoded.functionName).toBe("deployFor");
    expect(
      encodeFunctionData({
        abi: request.abi,
        functionName: "deployFor",
        args: decoded.args as typeof request.args,
      }),
    ).toBe(data);
    expect(request.args).toHaveLength(4);
    expect(request.args[0]).toBe(0n);
    expect(request.value).toBe(CREATION_FEE);
    expect(request.chainId).toBe(sepolia.id);
  });

  it("maps form economics to the exact REVConfig field scales", () => {
    const request = buildRequest();
    const [, config] = request.args;
    const stage = config.stageConfigurations[0];

    expect(config.description).toEqual({
      name: "Safety Test Revnet",
      ticker: "SAFE",
      uri: "bafy-metadata",
      salt: TEST_SALT,
    });
    expect(config.operator).toBe(TEST_ACCOUNT);
    expect(config.baseCurrency).toBe(ETH_CURRENCY_ID);
    expect(config.scopeCashOutsToLocalBalances).toBe(false);

    expect(stage.startsAtOrAfter).toBe(TEST_TIMESTAMP + 600);
    expect(stage.initialIssuance).toBe(parseUnits("1000", 18));
    expect(stage.issuanceCutFrequency).toBe(30 * 86_400);
    expect(stage.issuanceCutPercent).toBe(100_000_000);
    expect(stage.cashOutTaxRate).toBe(2_000);
    expect(stage.splitPercent).toBe(2_500);
    expect(stage.splits).toEqual([
      {
        preferAddToBalance: false,
        lockedUntil: 0,
        percent: SPLITS_TOTAL_PERCENT,
        projectId: 0n,
        beneficiary: TEST_BENEFICIARY,
        hook: "0x0000000000000000000000000000000000000000",
      },
    ]);
    expect(stage.autoIssuances).toEqual([
      {
        chainId: String(sepolia.id),
        count: parseUnits("25", 18),
        beneficiary: TEST_BENEFICIARY,
      },
    ]);
  });

  it("uses the canonical ETH accounting currency with ETH as the base currency", () => {
    const request = buildRequest("ETH");
    const [, config, accountingContexts] = request.args;

    expect(config.baseCurrency).toBe(ETH_CURRENCY_ID);
    expect(accountingContexts).toEqual([
      {
        token: NATIVE_TOKEN,
        decimals: NATIVE_TOKEN_DECIMALS,
        currency: ETH_CURRENCY_ID,
      },
    ]);
    expect(accountingContexts[0].currency).toBe(config.baseCurrency);
  });

  it("encodes USDC with six decimals and USD as the issuance base currency", () => {
    const request = buildRequest("USDC", "USD");
    const [, config, accountingContexts, suckerConfig] = request.args;
    const usdc = USDC_ADDRESSES[sepolia.id];

    expect(config.baseCurrency).toBe(USD_CURRENCY_ID(6));
    expect(accountingContexts).toEqual([
      { token: usdc, decimals: 6, currency: USD_CURRENCY_ID(6) },
    ]);
    expect(suckerConfig).toEqual(EMPTY_SUCKER_CONFIG);
  });

  it("accepts ETH and USDC together while pricing issuance in either currency", () => {
    const request = buildRequest("ETH_USDC", "ETH");
    const [, config, accountingContexts] = request.args;
    const usdc = USDC_ADDRESSES[sepolia.id];

    expect(config.baseCurrency).toBe(ETH_CURRENCY_ID);
    expect(accountingContexts).toEqual([
      {
        token: NATIVE_TOKEN,
        decimals: NATIVE_TOKEN_DECIMALS,
        currency: ETH_CURRENCY_ID,
      },
      { token: usdc, decimals: 6, currency: USD_CURRENCY_ID(6) },
    ]);
    expect(request.args).toHaveLength(4);
    expect(() => encodeFunctionData(request)).not.toThrow();

    const usdRequest = buildRequest("ETH_USDC", "USD");
    expect(usdRequest.args[1].baseCurrency).toBe(USD_CURRENCY_ID(6));
    expect(() => encodeFunctionData(usdRequest)).not.toThrow();
  });

  it("uses one token-keyed custom reserve for issuance, accounting, and shop prices", () => {
    const request = buildRequest("CUSTOM");
    const [, config, accountingContexts, suckerConfig, shopConfig, allowedPosts] = request.args;
    const currency = tokenCurrencyId(CUSTOM_TOKEN);

    expect(request.args).toHaveLength(6);
    expect(config.baseCurrency).toBe(currency);
    expect(accountingContexts).toEqual([{ token: CUSTOM_TOKEN, decimals: 6, currency }]);
    expect(suckerConfig).toEqual(EMPTY_SUCKER_CONFIG);
    expect(shopConfig).toBeDefined();
    if (!shopConfig) throw new Error("Expected the explicit custom-reserve shop config");
    expect(shopConfig.baseline721HookConfiguration.tiersConfig).toMatchObject({
      tiers: [],
      currency,
      decimals: 6,
    });
    expect(allowedPosts).toEqual([]);
    expect(() => encodeFunctionData(request)).not.toThrow();
  });

  it("keeps every split-bucket weight exact after percentage rounding", () => {
    const form = validRevnetForm();
    form.stages[0].splits = [
      { percentage: "33.33", defaultBeneficiary: TEST_ACCOUNT },
      { percentage: "33.33", defaultBeneficiary: TEST_BENEFICIARY },
      { percentage: "33.34", defaultBeneficiary: TEST_ACCOUNT },
    ];
    const request = parseDeployData(form, {
      metadataCid: "bafy-metadata",
      chainId: sepolia.id,
      suckerDeployerConfig: EMPTY_SUCKER_CONFIG,
      timestamp: TEST_TIMESTAMP,
      salt: TEST_SALT,
      creationFee: CREATION_FEE,
    });
    const splitWeights = request.args[1].stageConfigurations[0].splits.map(
      (split) => split.percent,
    );

    expect(splitWeights.reduce((sum, percent) => sum + percent, 0)).toBe(SPLITS_TOTAL_PERCENT);
    expect(() => encodeFunctionData(request)).not.toThrow();
  });
});

// Per-chain values collected inline in the create form (split beneficiary
// overrides and operator overrides keyed by chainId) must resolve to each
// chain's own address in that chain's deployFor args, falling back to the
// single default value on chains without an override.
describe("wallet-action:create-revnet — per-chain inline values", () => {
  const CHAIN_IDS = [sepolia.id, baseSepolia.id] as const;

  function perChainForm() {
    const form = validRevnetForm();
    form.chainIds = [...CHAIN_IDS];
    form.stages[0].splits = [
      {
        percentage: "25",
        defaultBeneficiary: TEST_BENEFICIARY,
        beneficiary: [
          { chainId: sepolia.id, address: TEST_BENEFICIARY },
          { chainId: baseSepolia.id, address: TEST_ACCOUNT },
        ],
      },
      // Single-value split: no per-chain overrides.
      { percentage: "25", defaultBeneficiary: TEST_BENEFICIARY },
    ];
    form.operator = [
      { chainId: String(sepolia.id), address: TEST_ACCOUNT },
      { chainId: String(baseSepolia.id), address: TEST_BENEFICIARY },
    ];
    return form;
  }

  function requestFor(form: ReturnType<typeof perChainForm>, chainId: (typeof CHAIN_IDS)[number]) {
    return parseDeployData(form, {
      metadataCid: "bafy-metadata",
      chainId,
      suckerDeployerConfig: EMPTY_SUCKER_CONFIG,
      timestamp: TEST_TIMESTAMP,
      salt: TEST_SALT,
      creationFee: CREATION_FEE,
    });
  }

  it("routes each chain's split beneficiary override and falls back to the default", () => {
    const form = perChainForm();
    const sepoliaSplits = requestFor(form, sepolia.id).args[1].stageConfigurations[0].splits;
    const baseSepoliaSplits = requestFor(form, baseSepolia.id).args[1].stageConfigurations[0]
      .splits;

    expect(sepoliaSplits.map((split) => split.beneficiary)).toEqual([
      TEST_BENEFICIARY,
      TEST_BENEFICIARY,
    ]);
    expect(baseSepoliaSplits.map((split) => split.beneficiary)).toEqual([
      TEST_ACCOUNT,
      TEST_BENEFICIARY,
    ]);
  });

  it("routes the per-chain operator override and falls back to the stage operator", () => {
    const form = perChainForm();
    expect(requestFor(form, sepolia.id).args[1].operator).toBe(TEST_ACCOUNT);
    expect(requestFor(form, baseSepolia.id).args[1].operator).toBe(TEST_BENEFICIARY);

    // Without an override the chain inherits the single stage operator.
    form.operator = form.operator.filter((entry) => Number(entry.chainId) !== baseSepolia.id);
    expect(requestFor(form, baseSepolia.id).args[1].operator).toBe(TEST_ACCOUNT);
  });

  it("still validates the per-chain fixture against the create schema", async () => {
    const { createSchema } = await import("@/app/create/helpers/createSchema");
    expect(createSchema.safeParse(perChainForm()).success).toBe(true);
  });
});

// REVDeployer folds ALL auto-issuance rows into `encodedConfiguration`, which
// must be byte-identical on every chain for the sucker deploy to link, and it
// mints only the rows whose chainId matches block.chainid. The client must
// therefore send the FULL row list — user-chosen chainIds intact — to every
// chain, never filtering rows or rewriting a row's chainId to the config chain.
describe("wallet-action:create-revnet — multi-chain auto issuance", () => {
  const CHAIN_IDS = [sepolia.id, baseSepolia.id] as const;

  function multiChainRequest(chainId: (typeof CHAIN_IDS)[number]) {
    const form = validRevnetForm();
    form.chainIds = [...CHAIN_IDS];
    form.stages[0].autoIssuance = [
      { chainId: sepolia.id, amount: "25", beneficiary: TEST_BENEFICIARY },
      { chainId: baseSepolia.id, amount: "40", beneficiary: TEST_ACCOUNT },
    ];
    return parseDeployData(form, {
      metadataCid: "bafy-metadata",
      chainId,
      suckerDeployerConfig: EMPTY_SUCKER_CONFIG,
      timestamp: TEST_TIMESTAMP,
      salt: TEST_SALT,
      creationFee: CREATION_FEE,
    });
  }

  function encodeRevnetConfig(request: ReturnType<typeof multiChainRequest>) {
    const deployFor = (
      request.abi as readonly { type: string; name?: string; inputs?: readonly AbiParameter[] }[]
    ).find((item) => item.type === "function" && item.name === "deployFor");
    if (!deployFor?.inputs) throw new Error("deployFor ABI entry missing");
    return encodeAbiParameters([deployFor.inputs[1]], [request.args[1]]);
  }

  it("carries every row with its user-chosen chainId in every chain's stage config", () => {
    for (const chainId of CHAIN_IDS) {
      const request = multiChainRequest(chainId);

      expect(request.args[1].stageConfigurations[0].autoIssuances).toEqual([
        {
          chainId: String(sepolia.id),
          count: parseUnits("25", 18),
          beneficiary: TEST_BENEFICIARY,
        },
        {
          chainId: String(baseSepolia.id),
          count: parseUnits("40", 18),
          beneficiary: TEST_ACCOUNT,
        },
      ]);
    }
  });

  it("encodes a byte-identical REVConfig for every chain", () => {
    const [sepoliaConfig, baseSepoliaConfig] = CHAIN_IDS.map((chainId) =>
      encodeRevnetConfig(multiChainRequest(chainId)),
    );

    expect(sepoliaConfig).toBe(baseSepoliaConfig);
    // Both rows' chainIds survive in the encoded bytes (uint32, hex-padded).
    const sepoliaWord = sepolia.id.toString(16).padStart(64, "0");
    const baseSepoliaWord = baseSepolia.id.toString(16).padStart(64, "0");
    expect(sepoliaConfig).toContain(sepoliaWord);
    expect(sepoliaConfig).toContain(baseSepoliaWord);
  });
});
