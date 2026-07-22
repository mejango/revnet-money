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
import { decodeFunctionData, encodeFunctionData, parseUnits } from "viem";
import { sepolia } from "viem/chains";
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

function buildRequest(reserveAsset: "ETH" | "USDC" = "ETH") {
  const form = validRevnetForm();
  form.reserveAsset = reserveAsset;
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

  it("uses a token-keyed accounting currency while keeping ETH as the base currency", () => {
    const request = buildRequest("ETH");
    const [, config, accountingContexts] = request.args;

    expect(config.baseCurrency).toBe(ETH_CURRENCY_ID);
    expect(accountingContexts).toEqual([
      {
        token: NATIVE_TOKEN,
        decimals: NATIVE_TOKEN_DECIMALS,
        currency: tokenCurrencyId(NATIVE_TOKEN),
      },
    ]);
    expect(accountingContexts[0].currency).not.toBe(config.baseCurrency);
  });

  it("encodes USDC with six decimals and USD as the issuance base currency", () => {
    const request = buildRequest("USDC");
    const [, config, accountingContexts, suckerConfig] = request.args;
    const usdc = USDC_ADDRESSES[sepolia.id];

    expect(config.baseCurrency).toBe(USD_CURRENCY_ID(6));
    expect(accountingContexts).toEqual([
      { token: usdc, decimals: 6, currency: tokenCurrencyId(usdc) },
    ]);
    expect(suckerConfig).toEqual(EMPTY_SUCKER_CONFIG);
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
