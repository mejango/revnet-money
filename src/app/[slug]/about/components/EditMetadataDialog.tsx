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
import { useCallback, useEffect, useRef, useState } from "react";
import { encodeFunctionData } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import {
  customPropertyCollisions,
  formatCustomProperties,
  mergeProjectMetadata,
  parseCustomProperties,
} from "./metadataMerge";

type MetadataFormData = {
  customProperties?: string;
  description: string;
  discord?: string;
  farcaster?: string;
  infoUri?: string;
  logoUri?: string;
  name: string;
  payDisclosure?: string;
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

  for (const field of [
    "logoUri",
    "twitter",
    "telegram",
    "discord",
    "infoUri",
    "farcaster",
    "payDisclosure",
  ]) {
    if (input[field] !== undefined && typeof input[field] !== "string") {
      issue(issues, [field], "Invalid value");
    }
  }

  if (input.customProperties !== undefined) {
    if (typeof input.customProperties !== "string") {
      issue(issues, ["customProperties"], "Invalid value");
    } else {
      const parsed = parseCustomProperties(input.customProperties);
      if (!parsed.ok) issue(issues, ["customProperties"], parsed.error);
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

  // The metadata JSON this edit is merged on top of. The context value can be a
  // server-provided subset (name/logo/description only), so it is re-fetched
  // when the dialog opens and again right before pinning. Until that authoritative
  // copy is in hand the advanced editor stays in a loading state and saving is
  // blocked, otherwise an empty custom-properties box would delete custom fields.
  const [currentMetadata, setCurrentMetadata] = useState<Record<string, unknown> | null>(null);
  const [metadataLoadFailed, setMetadataLoadFailed] = useState(false);
  const metadataReady = currentMetadata !== null;

  // Prefer the authoritative copy for the form fields too, falling back to the
  // context value while it loads.
  const initialMetadata = currentMetadata ?? metadata?.data;

  const metadataRef = useRef(metadata);
  metadataRef.current = metadata;

  const resolveCurrentMetadata = useCallback(async (): Promise<Record<string, unknown>> => {
    const source = metadataRef.current as
      { data?: unknown; refetch?: () => Promise<{ data?: unknown } | undefined> } | undefined;
    const refetched = await source?.refetch?.();
    const data = isRecord(refetched?.data) ? refetched.data : source?.data;
    return isRecord(data) ? data : {};
  }, []);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setCurrentMetadata(null);
    setMetadataLoadFailed(false);

    resolveCurrentMetadata().then(
      (data) => {
        if (!cancelled) setCurrentMetadata(data);
      },
      () => {
        if (!cancelled) setMetadataLoadFailed(true);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [open, resolveCurrentMetadata]);

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
      // Fail closed: never merge onto a metadata JSON we could not read.
      if (!metadataReady) throw new Error("Still loading the current metadata. Try again.");

      const customProperties = parseCustomProperties(values.customProperties ?? "");
      if (!customProperties.ok) throw new Error(customProperties.error);

      setSubmitting(true);

      // Re-fetch the CURRENT metadata JSON before pinning. The context value can
      // be a server-provided subset (name/logo/description only), and merging on
      // top of a subset would destroy custom fields and tags.
      const authoritative = await resolveCurrentMetadata();

      const metadataCid = await pinProjectMetadata(
        mergeProjectMetadata(authoritative, values, customProperties.value),
      );

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
            name: (initialMetadata as any)?.name || "",
            description: (initialMetadata as any)?.description || "",
            logoUri: (initialMetadata as any)?.logoUri || "",
            twitter: (initialMetadata as any)?.twitter || "",
            telegram: (initialMetadata as any)?.telegram || "",
            discord: (initialMetadata as any)?.discord || "",
            infoUri: (initialMetadata as any)?.infoUri || "",
            farcaster: (initialMetadata as any)?.farcaster || "",
            payDisclosure: (initialMetadata as any)?.payDisclosure || "",
            customProperties: formatCustomProperties(currentMetadata),
          }}
          validate={withSchema(metadataSchema)}
          onSubmit={handleSubmit}
          enableReinitialize
        >
          {({ handleSubmit, setFieldValue, isSubmitting, values }) => {
            const isLoading = isSubmitting || isPending || isTxLoading;
            const parsedCustom = parseCustomProperties(values.customProperties ?? "");
            const collisions = parsedCustom.ok ? customPropertyCollisions(parsedCustom.value) : [];
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

                  <FieldGroup
                    id="payDisclosure"
                    name="payDisclosure"
                    label="Payment notice"
                    component="textarea"
                    rows={2}
                    placeholder="Shown to supporters before they pay. Leave empty for none."
                  />

                  <details className="border-2 border-melon-300 bg-melon-25 px-3 py-2">
                    <summary className="cursor-pointer select-none text-md font-semibold leading-6">
                      Advanced
                    </summary>
                    <div className="mt-3 space-y-2">
                      {metadataReady ? (
                        <>
                          <FieldGroup
                            id="customProperties"
                            name="customProperties"
                            label="Custom properties"
                            description="Any other fields stored with this project, as JSON. This is the full set: remove a key to delete it, leave it empty for none."
                            component="textarea"
                            rows={6}
                            spellCheck={false}
                            placeholder="{}"
                            className="font-mono text-sm"
                          />
                          {collisions.length > 0 && (
                            <p className="text-sm text-zinc-500">
                              Set by the fields above, so ignored on save: {collisions.join(", ")}
                            </p>
                          )}
                        </>
                      ) : metadataLoadFailed ? (
                        <p className="text-sm text-red-500">
                          Could not load the current metadata. Close and reopen this dialog to
                          retry. Saving is blocked so custom fields are not overwritten.
                        </p>
                      ) : (
                        <p className="text-sm text-zinc-500">Loading current metadata...</p>
                      )}
                    </div>
                  </details>
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
                    <Button
                      type="submit"
                      loading={isLoading}
                      disabled={isLoading || !metadataReady}
                    >
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
