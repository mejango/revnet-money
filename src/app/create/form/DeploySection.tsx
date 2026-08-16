import { isSafeConnector } from "@/hooks/useReviewedWriteContract";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { useAccount } from "wagmi";
import { QuoteButton } from "../buttons/QuoteButton";
import { formatFormErrors } from "../helpers/formatFormErrors";
import { useCreateForm } from "./useCreateForm";

export function DeploySection({
  disabled = false,
  validBundle = false,
}: {
  disabled?: boolean;
  validBundle?: boolean;
}) {
  const { revnetTokenSymbol, values, submitForm, isSubmitting, isValid, errors, submitCount } =
    useCreateForm();
  // The explicit config keeps this section renderable outside a WagmiProvider.
  const { connector } = useAccount({ config: wagmiConfig });

  // A Safe proposal executes arbitrarily later, but the request encodes stage
  // 1's start time now. REVDeployer locks cash-outs and loans for 7 days when
  // that start is already past at execution, so warn before proposing.
  const deploysViaSafe = isSafeConnector(connector) && values.chainIds.length === 1;

  return (
    <>
      <div className="md:col-span-1">
        <h2 className="mb-4 text-lg font-bold md:mb-2">5. Deploy</h2>
        <p className="text-lg text-zinc-600">
          Deploy your revnet on the chains you selected. Anyone will be able to pay it to receive{" "}
          {revnetTokenSymbol} right away.
        </p>
        <p className="mt-2 text-lg text-zinc-600">
          An operator, if you named one, will also be able to add new chains to the revnet later
          using the matching deployment configuration.
        </p>
      </div>
      <div className="mt-6 md:col-span-2 md:mt-0">
        {deploysViaSafe && (
          <p className="mb-4 border border-peel-400 bg-peel-25 p-3 text-sm text-peel-800">
            This deployment encodes stage 1&apos;s start time when it is proposed — about 10 minutes
            ahead unless you set one. If your Safe executes the proposal after that time, cash-outs
            and loans are locked for 7 days from execution. To avoid the lock, set stage 1 to start
            in the future, later than the Safe will execute.
          </p>
        )}
        <QuoteButton
          isLoading={isSubmitting}
          validBundle={validBundle}
          disabled={disabled}
          onSubmit={() => {
            void submitForm();
          }}
        />
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
