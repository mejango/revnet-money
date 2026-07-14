"use client";

import { Nav } from "@/components/layout/Nav";
import { useToast } from "@/components/ui/use-toast";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { getPublicClient } from "@wagmi/core";
import { Formik } from "formik";
import { withZodSchema } from "formik-validator-zod";
import {
  createSalt,
  jbContractAddress,
  jbProjectsAbi,
  MappableAsset,
  parseSuckerDeployerConfig,
  revDeployerAbi,
} from "juice-sdk-core";
import { useGetRelayrTxQuote } from "juice-sdk-react";
import { encodeFunctionData } from "viem";
import { useAccount } from "wagmi";
import { DEFAULT_FORM_DATA } from "./constants";
import { DeployRevnetForm } from "./form/DeployRevnetForm";
import { createSchema } from "./helpers/createSchema";
import { parseDeployData } from "./helpers/parseDeployData";
import { pinProjectMetadata } from "./helpers/pinProjectMetaData";
import { calculateFinalStageStarts } from "./helpers/recalculateStageStarts";
import { RevnetFormData } from "./types";

export default function Page() {
  const { toast } = useToast();
  const { address, isConnected } = useAccount();

  const { getRelayrTxQuote, data, reset } = useGetRelayrTxQuote();

  async function deployProject(formData: RevnetFormData) {
    if (!isConnected || !address) {
      throw new Error("Please connect your wallet to deploy");
    }

    const reserveAsset =
      formData.reserveAsset === "USDC" ? MappableAsset.USDC : MappableAsset.NATIVE;

    // Upload metadata
    const metadataCid = await pinProjectMetadata({
      name: formData.name,
      description: formData.description,
      logoUri: formData.logoUri,
      twitter: formData.twitter,
      telegram: formData.telegram,
      discord: formData.discord,
      infoUri: formData.infoUri,
    });

    const salt = createSalt();
    const timestamp = Math.floor(Date.now() / 1000);

    const relayrTransactions = [];

    for (const chainId of formData.chainIds) {
      const suckerDeployerConfig = parseSuckerDeployerConfig(
        chainId,
        formData.chainIds,
        [reserveAsset],
        { version: 6 },
      ) as Parameters<typeof parseDeployData>[1]["suckerDeployerConfig"];
      const deployData = parseDeployData(formData, {
        metadataCid,
        chainId,
        suckerDeployerConfig,
        timestamp,
        salt,
      });

      console.log({ deployData });

      const encodedData = encodeFunctionData({
        abi: revDeployerAbi, // ABI of the contract
        functionName: "deployFor",
        args: deployData,
      });

      const publicClient = getPublicClient(wagmiConfig, {
        chainId: chainId,
      });

      if (!publicClient) {
        throw new Error("Public client not available");
      }

      // Deploying a new revnet requires paying the exact project creation fee.
      const creationFee = await publicClient.readContract({
        address: jbContractAddress["6"]["JBProjects"][chainId],
        abi: jbProjectsAbi,
        functionName: "creationFee",
      });

      // Estimate gas for the transaction if it were to be sent directly to the revDeployer.
      // The estimate can fail if the deployer wallet doesn't hold the creation fee on this
      // chain, so fall back to a generous limit (Relayr re-simulates server-side).
      const gasEstimate = await publicClient
        .estimateContractGas({
          account: address,
          address: jbContractAddress["6"]["REVDeployer"][chainId],
          abi: revDeployerAbi,
          functionName: "deployFor",
          args: deployData,
          value: creationFee,
        })
        .catch(() => 8_000_000n);

      console.log("create::deploy calldata", chainId, gasEstimate, encodedData, deployData);

      relayrTransactions.push({
        data: {
          from: address,
          to: jbContractAddress["6"]["REVDeployer"][chainId],
          value: creationFee,
          // Use the estimated gas but add a buffer for the trustedForwarder.
          gas: gasEstimate + BigInt(120_000n),
          data: encodedData,
        },
        chainId,
        version: 6 as const,
      });
    }

    await getRelayrTxQuote(relayrTransactions);
  }

  return (
    <>
      <Nav />
      <Formik
        initialValues={DEFAULT_FORM_DATA}
        isInitialValid={false}
        validate={withZodSchema(createSchema) as any}
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
      </Formik>
    </>
  );
}
