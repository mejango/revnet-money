"use client";

import { Nav } from "@/components/layout/Nav";
import { pinDraftItems } from "@/components/shop/itemDraft";
import { useToast } from "@/components/ui/use-toast";
import {
  requireRelayrRecoveryScopeAvailable,
  useGetRelayrTxQuote,
} from "@/hooks/useReviewedRelayr";
import {
  isSafeConnector,
  submittedViaSafe,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { FormProvider } from "@/lib/forms";
import { withSchema } from "@/lib/formValidation";
import type { JBChainId, RelayrPostBundleResponse } from "@/lib/nana/types";
import { areRelayrChainsCompatible } from "@/lib/relayr-chains";
import { formatWalletError } from "@/lib/utils";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import { withWriteIntent } from "@/lib/write-hold";
import { createSalt, parseSuckerDeployerConfig } from "@bananapus/nana-sdk-core";
import { gasWithHeadroom } from "@bananapus/nana-sdk-core/review";
import { getProjectCreationFee } from "@bananapus/nana-sdk-core/v6";
import { useEffect, useRef, useState } from "react";
import { encodeFunctionData, PublicClient } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { DEFAULT_FORM_DATA } from "./constants";
import { DeployRevnetForm, type DirectDeployment } from "./form/DeployRevnetForm";
import { LaunchedNotice } from "./form/LaunchedNotice";
import { createSchema } from "./helpers/createSchema";
import { bridgeableReserveAssets, verifyCustomReserveAsset } from "./helpers/customReserveAsset";
import { assertLaunchFeedsReachable } from "./helpers/feedReachability";
import {
  checkSavedLaunch,
  checkSavedLaunches,
  launchInputOf,
  launchIntent,
  launchSalt,
  noteLaunchSent,
  savedLaunchOf,
  settleLaunchSalt,
} from "./helpers/launchIntent";
import { parseDeployData } from "./helpers/parseDeployData";
import { pinProjectMetadata } from "./helpers/pinProjectMetaData";
import { calculateFinalStageStarts } from "./helpers/recalculateStageStarts";
import { quotedStageStartOf, type QuotedStageStart } from "./helpers/staleQuote";
import { RevnetFormData } from "./types";

export default function Page() {
  const { toast } = useToast();
  const { address, chainId: connectedChainId, isConnected, connector } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const { getRelayrTxQuote, data, reset } = useGetRelayrTxQuote();
  const [directDeployment, setDirectDeployment] = useState<DirectDeployment | null>(null);
  /** A saved launch the chain shows already happened: shown, and never sent again. */
  const [launched, setLaunched] = useState<{ chainId: number; revnetId: bigint }>();
  useEffect(() => {
    if (!address) return;
    let live = true;
    void checkSavedLaunches(
      (chainId) =>
        getPublicClient(wagmiConfig, { chainId: chainId as JBChainId }) as PublicClient | undefined,
      address,
    )
      .then((found) => {
        if (live && found) setLaunched(found);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [address]);
  const [quotedStageStart, setQuotedStageStart] = useState<QuotedStageStart>();
  const [paymentChainId, setPaymentChainId] = useState<number>();
  const quotedFormData = useRef<RevnetFormData | null>(null);

  async function deployProject(
    formData: RevnetFormData,
  ): Promise<RelayrPostBundleResponse | undefined> {
    if (!isConnected || !address) {
      throw new Error("Connect your wallet to launch the revnet.");
    }
    if (formData.chainIds.length > 1 && isSafeConnector(connector)) {
      throw new Error("For a Safe deployment, select one chain.");
    }
    if (formData.chainIds.length > 1 && !areRelayrChainsCompatible(formData.chainIds)) {
      throw new Error("Choose either live chains or test chains, not a mix.");
    }
    // A launch waits while an earlier one's signature can still run, saying until when.
    await requireRelayrRecoveryScopeAvailable(address, "revnet-launch");
    setDirectDeployment(null);
    // The one copy of what the user submitted: the launch's intent, salt, saved-launch lookup and
    // settlement are all built from it, never from refreshed metadata.
    const launchInput = launchInputOf(formData);

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

    // Item media and metadata pin once: CIDs are chain-independent, so every chain in a
    // multichain launch deploys the same digests.
    if (deploymentFormData.store.items.length > 0) {
      deploymentFormData = {
        ...deploymentFormData,
        store: {
          ...deploymentFormData.store,
          items: await pinDraftItems(
            deploymentFormData.store.items,
            deploymentFormData.store.categories,
          ),
        },
      };
    }

    // A single-chain launch is sent from this page: its salt stays the same across retries and
    // reloads until it confirms, so a reload can find a launch whose reply was lost (the
    // DeployRevnet event carries the salt). The write hold, keyed by the config, is what stops a
    // second launch: the stage starts are fresh, so the chain would take a retry. A multichain
    // launch has its own recovery through Relayr.
    const singleChain = deploymentFormData.chainIds.length === 1 && address;
    const salt = singleChain
      ? launchSalt(address, deploymentFormData.chainIds[0]!, launchInput, createSalt)
      : createSalt();
    const timestamp = Math.floor(Date.now() / 1000);

    const relayrTransactions = [];
    let directRequest: ReturnType<typeof parseDeployData> | null = null;
    let firstRequest: ReturnType<typeof parseDeployData> | null = null;

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
        throw new Error("Could not connect to the chain. Try again.");
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

      // Fail-closed: block the launch when any JBPrices pair the terminal
      // will need at runtime (context <-> base for pays, context <-> context
      // for cash-outs) has no reachable feed on this chain. Probed on-chain,
      // so registering the missing default feed unblocks the combination
      // without a client release.
      await assertLaunchFeedsReachable({
        chainId,
        publicClient: publicClient as PublicClient,
        contexts: request.args[2],
        baseCurrency: request.args[1].baseCurrency,
      });

      if (deploymentFormData.chainIds.length === 1) directRequest = request;
      if (!firstRequest) firstRequest = request;

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

      relayrTransactions.push({
        recoveryScope: "revnet-launch",
        data: {
          from: address,
          to: request.address,
          value: request.value,
          gas: gasWithHeadroom(gasEstimate),
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

    if (directRequest && address) {
      const chainId = deploymentFormData.chainIds[0];
      const client = getPublicClient(wagmiConfig, { chainId }) as PublicClient | undefined;
      // A saved attempt of this launch the chain shows already happened: nothing is sent.
      if (client && savedLaunchOf(address, chainId, launchInput)?.fromBlock) {
        const { launched: revnetId } = await checkSavedLaunch(
          client,
          chainId,
          address,
          launchInput,
        );
        if (revnetId !== "unknown") {
          setLaunched({ chainId, revnetId });
          return;
        }
      }
      // The first block its DeployRevnet event can be in; a read that fails only skips the note.
      const fromBlock = await Promise.resolve()
        .then(() => client?.getBlockNumber())
        .catch(() => undefined);
      if (fromBlock !== undefined) noteLaunchSent(address, chainId, launchInput, fromBlock);
      if (connectedChainId !== chainId) await switchChainAsync({ chainId });
      // Held by the user's launch config: the salt, stage start and pin are the page's own.
      const hash = await withWriteIntent(
        writeContractAsync,
        ...launchIntent(launchInput),
      )({
        chainId,
        address: directRequest.address,
        abi: directRequest.abi,
        functionName: directRequest.functionName,
        args: directRequest.args,
        value: directRequest.value,
      } as unknown as Parameters<typeof writeContractAsync>[0]);
      if (submittedViaSafe(hash)) {
        toast({
          title: "Safe proposal submitted",
          description:
            "Approve and carry out the launch proposal in your Safe. Your revnet exists once the chain confirms that transaction.",
        });
        return;
      }
      setDirectDeployment({ chainId, hash });
      if (client)
        void waitForReceiptWithRetry(client as PublicClient, hash)
          .then((receipt) => {
            // Launched: the next launch of this config is a new revnet, with a new salt.
            if (receipt.status === "success") settleLaunchSalt(address, chainId, launchInput);
          })
          .catch(() => undefined);
      toast({
        title: "Revnet deployment submitted",
        description:
          "Once the transaction confirms, use the button at the bottom of this page to open your revnet.",
      });
      return;
    }

    if (firstRequest) {
      quotedFormData.current = deploymentFormData;
      setQuotedStageStart(quotedStageStartOf(firstRequest, deploymentFormData));
    }
    return await getRelayrTxQuote(relayrTransactions);
  }

  // REVDeployer locks cash-outs and loans for 7 days when the first stage's
  // start time is already past at execution, and the quote freezes stage
  // starts. Paying a stale quote therefore rebuilds the whole request from the
  // same form data: `deployProject` captures one fresh timestamp shared by
  // every chain, keeping the encoded configuration byte-identical across
  // chains so suckers still pair. A different launch is never signed while the
  // stale one's requests can still run, which would let the two launch on
  // different chains: the rebuild waits until every one of them is dead at a
  // finalized block, saying until when, and the stale quote is never paid.
  async function rebuildStaleQuote(): Promise<RelayrPostBundleResponse> {
    const formData = quotedFormData.current;
    if (!formData) {
      throw new Error(
        "The original launch request is unavailable. Clear the quote and get a new one.",
      );
    }
    const quote = await deployProject(formData);
    if (!quote) {
      throw new Error("Could not refresh the quote. Clear it and try again.");
    }
    return quote;
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
            setPaymentChainId(connectedChainId);
            await deployProject({
              ...formData,
              stages: calculateFinalStageStarts(formData.stages),
            });
          } catch (e: any) {
            toast({
              variant: "destructive",
              title: "Error",
              description: formatWalletError(e, "Could not prepare the transaction. Try again."),
            });
            console.error(e);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {launched ? (
          <LaunchedNotice chainId={launched.chainId} revnetId={launched.revnetId} />
        ) : null}
        <DeployRevnetForm
          relayrResponse={data}
          resetRelayrResponse={reset}
          preferredPaymentChainId={paymentChainId}
          directDeployment={directDeployment}
          quotedStageStart={quotedStageStart}
          rebuildStaleQuote={rebuildStaleQuote}
        />
      </FormProvider>
    </>
  );
}
