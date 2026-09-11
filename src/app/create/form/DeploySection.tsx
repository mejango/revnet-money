import { chainDisplayName } from "@/app/constants";
import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { isSafeConnector } from "@/hooks/useReviewedWriteContract";
import { hasErrors } from "@/lib/forms";
import type { JBChainId } from "@/lib/nana/types";
import { areRelayrChainsCompatible } from "@/lib/relayr-chains";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { useState } from "react";
import { useAccount } from "wagmi";
import { formatFormErrors } from "../helpers/formatFormErrors";
import { useCreateForm } from "./useCreateForm";

export function DeploySection({
  disabled = false,
  validBundle = false,
}: {
  disabled?: boolean;
  validBundle?: boolean;
}) {
  const {
    revnetTokenSymbol,
    reserveAssetSymbol,
    values,
    submitForm,
    isSubmitting,
    isValid,
    errors,
    submitCount,
  } = useCreateForm();
  const [review, setReview] = useState(false);
  // The explicit config keeps this section renderable outside a WagmiProvider.
  const { connector, chainId: connectedChainId } = useAccount({ config: wagmiConfig });

  // A Safe proposal executes arbitrarily later, but the request encodes stage
  // 1's start time now. REVDeployer locks cash-outs and loans for 7 days when
  // that start is already past at execution, so warn before proposing.
  const deploysViaSafe = isSafeConnector(connector) && values.chainIds.length === 1;
  const singleChain = values.chainIds.length === 1;
  const unsupportedMultichain =
    !singleChain && (isSafeConnector(connector) || !areRelayrChainsCompatible(values.chainIds));
  const chainNames = values.chainIds.map((chainId) => chainDisplayName(chainId));
  const action = singleChain ? "Deploy the revnet" : "Sign and get quote";

  return (
    <>
      <div className="md:col-span-1">
        <h2 className="mb-4 text-lg font-bold md:mb-2">6. Deploy</h2>
        <p className="text-lg text-zinc-600">
          Create your revnet on the selected chains. Once its first stage starts, people can pay it
          to receive {revnetTokenSymbol} under its terms.
        </p>
        <p className="mt-2 text-lg text-zinc-600">
          If you chose an operator, they can add chains later using the same launch settings.
        </p>
      </div>
      <div className="mt-6 md:col-span-2 md:mt-0">
        {deploysViaSafe && (
          <p className="mb-4 border border-peel-400 bg-peel-25 p-3 text-sm text-peel-800">
            This proposal fixes stage 1&apos;s start time, about 10 minutes ahead unless you chose a
            date. If your Safe carries out the proposal after that time, cash-outs and loans will be
            locked for 7 days. To avoid the lock, choose a start date that gives your Safe enough
            time to approve and carry out the proposal.
          </p>
        )}
        {unsupportedMultichain ? (
          <p
            role="alert"
            className="mb-4 border border-peel-400 bg-peel-25 p-3 text-sm text-peel-800"
          >
            {isSafeConnector(connector)
              ? "For a Safe deployment, select one chain."
              : "Choose either live chains or test chains, not a mix."}
          </p>
        ) : null}
        <div className="flex justify-end">
          <ButtonWithWallet
            targetChainId={
              singleChain
                ? values.chainIds[0]
                : areRelayrChainsCompatible([...values.chainIds, connectedChainId ?? 0])
                  ? (connectedChainId as JBChainId)
                  : undefined
            }
            size="lg"
            loading={isSubmitting}
            disabled={isSubmitting || disabled || unsupportedMultichain}
            onClick={() => {
              if (hasErrors(errors)) void submitForm();
              else setReview(true);
            }}
            connectWalletText="Connect Wallet"
            className="bg-teal-500 text-melon-950 hover:bg-teal-600"
          >
            {validBundle ? "Quote complete" : action}
          </ButtonWithWallet>
        </div>
        {review && values.chainIds[0] ? (
          <TxConfirmDialog
            open
            onOpenChange={(open) => {
              if (!open) setReview(false);
            }}
            title={singleChain ? "Confirm deployment" : "Confirm deploy request"}
            chainId={values.chainIds[0]}
            steps={
              singleChain
                ? [
                    {
                      title: `Deploy ${values.name || "the revnet"} on ${chainNames[0]}`,
                      detail: "Creates the revnet with the terms you chose.",
                    },
                  ]
                : values.chainIds.map((chainId) => ({
                    key: String(chainId),
                    title: `Sign the authorization for ${chainDisplayName(chainId)}`,
                  }))
            }
            stepsIntro={
              singleChain
                ? undefined
                : `Your wallet will ask for ${values.chainIds.length} signatures. The relay payment comes after the quote.`
            }
            activeIndex={isSubmitting ? 0 : -1}
            action={action}
            onConfirm={() => {
              void submitForm().finally(() => setReview(false));
            }}
            busy={isSubmitting}
          >
            <SummaryRow label="Revnet">{values.name || "Unnamed"}</SummaryRow>
            <SummaryRow label="Token">${revnetTokenSymbol}</SummaryRow>
            <SummaryRow label="On">{chainNames.join(", ")}</SummaryRow>
            <SummaryRow label="Backed by">{reserveAssetSymbol}</SummaryRow>
          </TxConfirmDialog>
        ) : null}
        {submitCount > 0 && !isValid ? (
          <div className="mt-3 max-w-xl border-l-2 border-red-500 pl-3" role="alert">
            <p className="text-sm font-semibold text-red-700">Please fix these details:</p>
            <p className="mt-1 whitespace-pre-line text-sm text-red-700">
              {formatFormErrors(errors)}
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}
