"use client";

import { FieldGroup } from "@/app/create/form/Fields";
import { pinProjectMetadata } from "@/app/create/helpers/pinProjectMetaData";
import { IpfsImageUploader } from "@/components/IpfsFileUploader";
import { RelayrPaymentSelect } from "@/components/RelayrPaymentSelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  useGetRelayrTxQuote,
  useSendRelayrTx,
  waitForRelayrBundle,
} from "@/hooks/useReviewedRelayr";
import {
  submittedViaSafe,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { useTokenA } from "@/hooks/useTokenA";
import type { Project } from "@/lib/bendystraw/types";
import { isRecord, issue, schema, ValidationIssue, withSchema } from "@/lib/formValidation";
import { FormProvider } from "@/lib/forms";
import { ipfsUri } from "@/lib/ipfs";
import { useJBContractContext, useJBProjectMetadataContext } from "@/lib/nana/project";
import type { ChainPayment, RelayrPostBundleResponse } from "@/lib/nana/types";
import { formatWalletError } from "@/lib/utils";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { JBChainId, jbControllerAbi, JBCoreContracts } from "@bananapus/nana-sdk-core";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { getPublicClient } from "wagmi/actions";
type MetadataFormData = {
  description: string;
  discord?: string;
  farcaster?: string;
  infoUri?: string;
  logoUri?: string;
  name: string;
  telegram?: string;
  twitter?: string;
};

const metadataSchema = schema<MetadataFormData>((input) => {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    issue(issues, [], "Invalid metadata");
    return issues;
  }

  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    issue(issues, ["name"], "Name is required");
  } else if (input.name.trim().length > 50) {
    issue(issues, ["name"], "Name is too long");
  }
  if (typeof input.description !== "string" || input.description.trim().length === 0) {
    issue(issues, ["description"], "Description is required");
  }

  for (const field of ["logoUri", "twitter", "telegram", "discord", "infoUri", "farcaster"]) {
    if (input[field] !== undefined && typeof input[field] !== "string") {
      issue(issues, [field], "Invalid value");
    }
  }

  return issues;
});

interface Props {
  projects: Array<Pick<Project, "projectId" | "token" | "chainId">>;
  triggerVariant?: "default" | "outline";
}

export function EditMetadataDialog({ projects, triggerVariant = "outline" }: Props) {
  const [open, setOpen] = useState(false);
  const { metadata } = useJBProjectMetadataContext();
  const { contractAddress } = useJBContractContext();
  const { toast } = useToast();
  const router = useRouter();
  const { address, chainId: connectedChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [callbackCalled, setCallbackCalled] = useState(false);
  const { symbol: tokenSymbol } = useTokenA();

  const { getRelayrTxQuote, reset: resetRelayr } = useGetRelayrTxQuote();
  const { sendRelayrTx } = useSendRelayrTx();
  const [relayrQuote, setRelayrQuote] = useState<RelayrPostBundleResponse | null>(null);
  const [selectedPayment, selectPayment] = useState<ChainPayment | null>(null);

  const { writeContractAsync, isPending, data: txHash } = useWriteContract();

  const { isLoading: isTxLoading, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const resetQuote = useCallback(() => {
    setRelayrQuote(null);
    selectPayment(null);
    resetRelayr();
  }, [resetRelayr, selectPayment, setRelayrQuote]);

  const onSuccess = useCallback(() => {
    setOpen(false);
    resetQuote();

    toast({
      title: "Metadata updated!",
      description: "New data will be visible shortly.",
    });
    setTimeout(() => {
      (metadata as any).refetch();
      router.refresh();
    }, 5000);
  }, [toast, metadata, router, resetQuote]);

  useEffect(() => {
    if (!open || !isSuccess || callbackCalled) return;
    onSuccess();
    setCallbackCalled(true);
  }, [isSuccess, open, callbackCalled, onSuccess]);

  const handleSubmit = async (values: MetadataFormData, { setSubmitting }: any) => {
    try {
      if (!address) throw new Error("Please connect your wallet");

      setSubmitting(true);

      const metadataCid = await pinProjectMetadata({
        ...metadata?.data,
        name: values.name,
        description: values.description,
        logoUri: values.logoUri || metadata?.data?.logoUri,
        twitter: values.twitter,
        telegram: values.telegram,
        discord: values.discord,
        infoUri: values.infoUri,
        // farcaster: values.farcaster,
      });

      const metadataUri = ipfsUri(metadataCid);
      setCallbackCalled(false);

      // Single chain - use direct writeContract
      if (projects.length === 1) {
        const project = projects[0];
        const chainId = project.chainId as JBChainId;

        if (connectedChainId !== chainId) {
          await switchChainAsync?.({ chainId });
        }

        await writeContractAsync({
          abi: jbControllerAbi,
          functionName: "setUriOf",
          chainId,
          address: contractAddress(JBCoreContracts.JBController, chainId),
          args: [BigInt(project.projectId), metadataUri],
        });

        toast({
          title: "Transaction submitted",
          description: "Awaiting confirmation...",
        });

        return;
      }

      // Multi-chain - use relayr
      const relayrTransactions = [];

      for (const project of projects) {
        const chainId = project.chainId as JBChainId;

        const controller = contractAddress(JBCoreContracts.JBController, chainId);
        const args = [BigInt(project.projectId), metadataUri] as const;

        const gasEstimate = await getPublicClient(wagmiConfig, { chainId }).estimateContractGas({
          address: controller,
          abi: jbControllerAbi,
          functionName: "setUriOf",
          args,
          account: address,
        });

        relayrTransactions.push({
          data: {
            from: address,
            to: controller,
            value: 0n,
            gas: gasEstimate + 50_000n,
            data: encodeFunctionData({ abi: jbControllerAbi, functionName: "setUriOf", args }),
          },
          chainId,
          version: 6 as const,
          review: {
            abi: jbControllerAbi,
            functionName: "setUriOf",
            args,
            label: "Update project metadata",
            contractName: "JBController",
          },
        });
      }

      const quote = await getRelayrTxQuote(relayrTransactions);
      if (!quote) throw new Error("Failed to get relayr tx quote");

      setRelayrQuote(quote);
      selectPayment(quote.payment_info[0]);
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: formatWalletError(e) || "Failed to update metadata",
      });
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePayAndSubmit = async () => {
    if (!relayrQuote || !selectedPayment || !sendRelayrTx) return;

    try {
      const hash = await sendRelayrTx(selectedPayment);
      if (submittedViaSafe(hash)) {
        toast({
          title: "Safe payment proposal submitted",
          description:
            "The Relayr bundle is not paid yet. Approve and execute this proposal in Safe; do not submit another payment.",
        });
        return;
      }
      await waitForRelayrBundle(relayrQuote.bundle_uuid);

      toast({
        title: "Metadata updated on every chain",
        description: "Relayr confirmed every destination transaction.",
      });
      onSuccess();
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: formatWalletError(e) || "Failed to submit transaction",
      });
      console.error(e);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        resetQuote();
      }}
    >
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm">
          Edit metadata
        </Button>
      </DialogTrigger>
      <DialogContent>
        <FormProvider
          initialValues={{
            name: metadata?.data?.name || "",
            description: metadata?.data?.description || "",
            logoUri: metadata?.data?.logoUri || "",
            twitter: (metadata?.data as any)?.twitter || "",
            telegram: (metadata?.data as any)?.telegram || "",
            discord: (metadata?.data as any)?.discord || "",
            infoUri: (metadata?.data as any)?.infoUri || "",
            farcaster: (metadata?.data as any)?.farcaster || "",
          }}
          validate={withSchema(metadataSchema)}
          onSubmit={handleSubmit}
          enableReinitialize
        >
          {({ handleSubmit, setFieldValue, isSubmitting }) => {
            const isLoading = isSubmitting || isPending || isTxLoading;
            return (
              <form onSubmit={handleSubmit}>
                <DialogHeader>
                  <DialogTitle>Edit metadata</DialogTitle>
                  <DialogDescription>
                    Update the project name, logo, and description.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <FieldGroup id="name" name="name" label="Name" />

                  <div>
                    <label
                      className="block mb-1 text-md font-semibold text-gray-900 dark:text-white"
                      htmlFor="logo_input"
                    >
                      Logo
                    </label>
                    <p className="text-sm text-zinc-500 mb-2">
                      Leave empty to keep the current one.
                    </p>
                    <IpfsImageUploader
                      onUploadSuccess={(cid) => {
                        setFieldValue("logoUri", ipfsUri(cid));
                      }}
                      disabled={isLoading}
                    />
                  </div>

                  <FieldGroup
                    id="description"
                    name="description"
                    label="Description"
                    component="textarea"
                    rows={4}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldGroup
                      id="twitter"
                      name="twitter"
                      label="Twitter"
                      placeholder="handle..."
                      autoComplete="off"
                    />
                    <FieldGroup
                      id="telegram"
                      name="telegram"
                      label="Telegram"
                      placeholder="t.me/yourchannel..."
                      autoComplete="off"
                    />
                    <FieldGroup
                      id="discord"
                      name="discord"
                      label="Discord"
                      placeholder="discord.gg/your-invite..."
                      autoComplete="off"
                    />
                    <FieldGroup
                      id="infoUri"
                      name="infoUri"
                      label="Website"
                      placeholder="example.com..."
                      autoComplete="off"
                      inputMode="url"
                    />
                    {/* <FieldGroup
                      id="farcaster"
                      name="farcaster"
                      label="Farcaster"
                      placeholder="username..."
                      autoComplete="off"
                    /> */}
                  </div>
                </div>

                {relayrQuote && tokenSymbol && (
                  <div className="py-4">
                    <RelayrPaymentSelect
                      payments={relayrQuote.payment_info}
                      tokenSymbol={tokenSymbol}
                      selectedPayment={selectedPayment}
                      onSelectPayment={selectPayment}
                      disabled={isLoading}
                    />
                  </div>
                )}

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setOpen(false)}
                    disabled={isLoading}
                  >
                    Cancel
                  </Button>
                  {relayrQuote ? (
                    <Button
                      type="button"
                      onClick={handlePayAndSubmit}
                      loading={isLoading}
                      disabled={isLoading}
                    >
                      Pay and submit
                    </Button>
                  ) : (
                    <Button type="submit" loading={isLoading} disabled={isLoading}>
                      {projects.length > 1 ? "Get quote" : "Save changes"}
                    </Button>
                  )}
                </DialogFooter>
              </form>
            );
          }}
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
