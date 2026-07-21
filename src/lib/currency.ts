import { ETH_CURRENCY_ID, USD_CURRENCY_ID } from "@bananapus/nana-sdk-core";

export function toBaseCurrencyId(currency: number | string) {
  if (Number(currency) === 1 || Number(currency) === 61166) return ETH_CURRENCY_ID;
  return USD_CURRENCY_ID(6);
}

const usdSymbols = ["USDC", "USD", "USDT", "DAI"];

export function isUsd(symbol: string) {
  return usdSymbols.map((s) => s.toLowerCase()).includes(symbol.toLowerCase());
}
