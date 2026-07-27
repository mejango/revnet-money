"use client";

import { Nav } from "@/components/layout/Nav";
import { useToast } from "@/components/ui/use-toast";
import { useGetRelayrTxQuote } from "@/hooks/useReviewedRelayr";
import { useWriteContract } from "@/hooks/useReviewedWriteContract";
import { withSchema } from "@/lib/formValidation";
import { FormProvider } from "@/lib/forms";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { createSalt, parseSuckerDeployerConfig } from "@bananapus/nana-sdk-core";
import { getProjectCreationFee } from "@bananapus/nana-sdk-core/v6";
import { encodeFunctionData, PublicClient } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { DEFAULT_FORM_DATA } from "./constants";
import { DeployRevnetForm } from "./form/DeployRevnetForm";
import { createSchema } from "./helpers/createSchema";
import { bridgeableReserveAssets, verifyCustomReserveAsset } from "./helpers/customReserveAsset";
import { parseDeployData } from "./helpers/parseDeployData";
import { pinProjectMetadata } from "./helpers/pinProjectMetaData";
import { calculateFinalStageStarts } from "./helpers/recalculateStageStarts";
import { RevnetFormData } from "./types";

export default function Page() {
  const { toast } = useToast();
  const { address, chainId: connectedChainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const { getRelayrTxQuote, data, reset } = useGetRelayrTxQuote();

  async function deployProject(formData: RevnetFormData) {
    if (!isConnected || !address) {
      throw new Error("Please connect your wallet to deploy");
    }

    let deploymentFormData = formData;
    if (formData.reserveAsset === "CUSTOM") {
      const verified = await verifyCustomReserveAsset(
        formData.customReserveAsset.address,
        formData.chainIds,
        (chainId) => getPublicClient(wagmiConfig, { chainId }),
      );
      deploymentFormData = { ...formData, customReserveAsset: verified };
    }

    // Arbitrary ERC-20s have no canonical bridge mapping. Empty mappings still
    // link the revnet/project token while keeping each chain's reserves local.
    const reserveAssets = bridgeableReserveAssets(deploymentFormData.reserveAsset);

    // Upload metadata
    const metadataCid = await pinProjectMetadata({
      name: deploymentFormData.name,
      description: deploymentFormData.description,
      logoUri: deploymentFormData.logoUri,
      twitter: deploymentFormData.twitter,
      telegram: deploymentFormData.telegram,
      discord: deploymentFormData.discord,
      infoUri: deploymentFormData.infoUri,
    });

    const salt = createSalt();
    const timestamp = Math.floor(Date.now() / 1000);

    const relayrTransactions = [];
    let directRequest: ReturnType<typeof parseDeployData> | null = null;

    for (const chainId of deploymentFormData.chainIds) {
      const suckerDeployerConfig = parseSuckerDeployerConfig(
        chainId,
        deploymentFormData.chainIds,
        reserveAssets,
        { version: 6 },
      ) as Parameters<typeof parseDeployData>[1]["suckerDeployerConfig"];

      const publicClient = getPublicClient(wagmiConfig, {
        chainId: chainId,
      });

      if (!publicClient) {
        throw new Error("Public client not available");
      }

      // Deploying a new revnet requires paying the exact project creation fee.
      const creationFee = await getProjectCreationFee(publicClient as PublicClient, chainId);

      const request = parseDeployData(deploymentFormData, {
        metadataCid,
        chainId,
        suckerDeployerConfig,
        timestamp,
        salt,
        creationFee,
      });
      if (deploymentFormData.chainIds.length === 1) directRequest = request;

      console.log({ deployData: request.args });

      const encodedData = encodeFunctionData({
        abi: request.abi,
        functionName: request.functionName,
        args: request.args,
      });

      // Estimate gas for the transaction if it were to be sent directly to the revDeployer.
      // The estimate can fail if the deployer wallet doesn't hold the creation fee on this
      // chain, so fall back to a generous limit (Relayr re-simulates server-side).
      const gasEstimate = await publicClient
        .estimateContractGas({
          account: address,
          address: request.address,
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
          value: request.value,
        })
        .catch(() => 8_000_000n);

      console.log("create::deploy calldata", chainId, gasEstimate, encodedData, request.args);

      relayrTransactions.push({
        data: {
          from: address,
          to: request.address,
          value: request.value,
          // Use the estimated gas but add a buffer for the trustedForwarder.
          gas: gasEstimate + BigInt(120_000n),
          data: encodedData,
        },
        chainId,
        version: 6 as const,
        review: {
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
          label: `Deploy ${deploymentFormData.name} on ${chainId}`,
          contractName: "REVDeployer",
        },
      });
    }

    if (directRequest) {
      const chainId = deploymentFormData.chainIds[0];
      if (connectedChainId !== chainId) await switchChainAsync({ chainId });
      await writeContractAsync({
        chainId,
        address: directRequest.address,
        abi: directRequest.abi,
        functionName: directRequest.functionName,
        args: directRequest.args,
        value: directRequest.value,
      } as unknown as Parameters<typeof writeContractAsync>[0]);
      toast({
        title: "Revnet deployment submitted",
        description:
          "The single-chain deployment was sent directly. Track its onchain confirmation above.",
      });
      return;
    }

    await getRelayrTxQuote(relayrTransactions);
  }

  return (
    <>
      <Nav />
      <FormProvider
        initialValues={DEFAULT_FORM_DATA}
        isInitialValid={false}
        validate={withSchema(createSchema)}
        onSubmit={async (formData: RevnetFormData, { setSubmitting }) => {
          try {
            setSubmitting(true);
            await deployProject({
              ...formData,
              stages: calculateFinalStageStarts(formData.stages),
            });
          } catch (e: any) {
            toast({
              variant: "destructive",
              title: "Error",
              description: e.message || "Error encoding transaction",
            });
            console.error(e);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <DeployRevnetForm relayrResponse={data} resetRelayrResponse={reset} />
      </FormProvider>
    </>
  );
}
