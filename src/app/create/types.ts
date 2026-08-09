import { JBChainId } from "@bananapus/nana-sdk-core";

export type StageData = {
  initialOperator?: string; // only one operator (technically per chain) not per stage
  initialIssuance: string;
  pickUpFromPrevious?: boolean;

  priceCeilingIncreasePercentage: string;
  priceCeilingIncreaseFrequency: string;
  priceFloorTaxIntensity: string;
  /** App-specific uint14 metadata; preserved when importing a deployed stage. */
  extraMetadata?: number;

  autoIssuance: {
    amount: string;
    beneficiary: string;
    chainId: JBChainId;
  }[];

  splits: {
    percentage: string;
    defaultBeneficiary: string;
    beneficiary?: {
      chainId: JBChainId;
      address: string;
    }[];
  }[];
  stageStart: string;
  stageStartCuts?: string;
  futureStartTimestamp?: number;
};

export type CustomReserveAsset = {
  address: string;
  symbol: string;
  decimals: number | null;
  verifiedChainIds: JBChainId[];
};

export type RevnetFormData = {
  name: string;
  // tagline: string;
  description: string;
  logoUri?: string;

  // Optional social and website links
  twitter?: string;
  telegram?: string;
  discord?: string;
  infoUri?: string;

  tokenSymbol: string;

  stages: StageData[];
  chainIds: JBChainId[];
  operator: {
    chainId: string;
    address: string;
  }[];
  reserveAsset: "ETH" | "USDC" | "ETH_USDC" | "CUSTOM";
  issuanceBaseCurrency: "ETH" | "USD";
  customReserveAsset: CustomReserveAsset;
};
