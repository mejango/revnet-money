import {
  getJBContractAddress,
  JBChainId,
  jbContractAddress,
  JBCoreContracts,
  jbDirectoryAbi,
  jbMultiTerminalAbi,
  jbRouterTerminalRegistryAbi,
  JBRouterTerminalContracts,
  jbSwapTerminalAbi,
  JBSwapTerminalContracts,
  JBVersion,
} from "@bananapus/nana-sdk-core";
import { resolvePaymentTerminal } from "@bananapus/nana-sdk-core/v6";
import { getContract, PublicClient, zeroAddress } from "viem";
import { Token } from "./token";

export async function getPaymentTerminal(args: {
  client: PublicClient;
  version: JBVersion;
  chainId: JBChainId;
  projectId: bigint;
  tokenIn: Token;
  baseToken: Pick<Token, "isNative">;
}) {
  const { client, version, chainId, projectId, tokenIn, baseToken } = args;

  // v6 replaced the swap terminal with the router terminal registry, which routes payments
  // in any token regardless of the project's accounting token. `resolvePaymentTerminal`
  // falls back to it when the project has no primary terminal for the token.
  if (version === 6) {
    const resolved = await resolvePaymentTerminal(client, {
      chainId,
      projectId,
      token: tokenIn.address,
    });
    const registry = getJBContractAddress(
      JBRouterTerminalContracts.JBRouterTerminalRegistry,
      version,
      chainId,
    );
    const isRouter =
      resolved.isRouter || resolved.address.toLowerCase() === registry.toLowerCase();

    return {
      address: resolved.address,
      abi: isRouter ? jbRouterTerminalRegistryAbi : jbMultiTerminalAbi,
      type: isRouter ? "swap" : "multi",
    };
  }

  const directory = getContract({
    address: getJBContractAddress(JBCoreContracts.JBDirectory, version, chainId),
    abi: jbDirectoryAbi,
    client,
  });

  const terminal = await directory.read.primaryTerminalOf([projectId, tokenIn.address]);

  if (!terminal) {
    throw new Error(`No primary terminal found for ${tokenIn.symbol}`);
  }

  const swapTerminal = getSwapTerminalAddress(version, chainId, baseToken.isNative);

  if (terminal === zeroAddress) {
    return { address: swapTerminal, abi: jbSwapTerminalAbi, type: "swap" };
  }

  const isSwapTerminal = terminal.toLowerCase() === swapTerminal.toLowerCase();

  return {
    address: terminal,
    abi: isSwapTerminal ? jbSwapTerminalAbi : jbMultiTerminalAbi,
    type: isSwapTerminal ? "swap" : "multi",
  };
}

function getSwapTerminalAddress(version: JBVersion, chainId: JBChainId, isNative: boolean) {
  if (version === 4) {
    return jbContractAddress[4].JBSwapTerminal1_1[chainId];
  }

  return getJBContractAddress(
    isNative
      ? JBSwapTerminalContracts.JBSwapTerminalRegistry
      : JBSwapTerminalContracts.JBSwapTerminalUSDCRegistry,
    version,
    chainId,
  );
}
