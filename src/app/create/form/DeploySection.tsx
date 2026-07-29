import { toast } from "@/components/ui/use-toast";
import { QuoteButton } from "../buttons/QuoteButton";
import { formatFormErrors } from "../helpers/formatFormErrors";
import { ChainOperator } from "./ChainOperator";
import { Divider } from "./Divider";
import { useCreateForm } from "./useCreateForm";

export function DeploySection({
  disabled = false,
  validBundle = false,
}: {
  disabled?: boolean;
  validBundle?: boolean;
}) {
  const { revnetTokenSymbol, values, submitForm, isSubmitting, isValid, errors } = useCreateForm();

  // The operator is normally set inline in the first stage's terms. When no
  // stage collected one, ask for it here before deploying.
  const needsOperator = values.chainIds.length > 0 && !values.stages[0]?.initialOperator;

  return (
    <>
      <div className="md:col-span-1">
        <h2 className="mb-4 text-lg font-bold md:mb-2">4. Deploy</h2>
        <p className="text-lg text-zinc-600">
          Deploy your revnet on the chains you selected. Anyone will be able to pay it to receive{" "}
          {revnetTokenSymbol} right away.
        </p>
        <p className="mt-2 text-lg text-zinc-600">
          The project operator you set in your revnet&apos;s terms will also be able to add new
          chains to the revnet later.
        </p>
      </div>
      <div className="mt-6 md:col-span-2 md:mt-0">
        {needsOperator && (
          <>
            <ChainOperator disabled={validBundle} />
            <Divider />
          </>
        )}
        <QuoteButton
          isLoading={isSubmitting}
          validBundle={validBundle}
          disabled={disabled}
          onSubmit={() => {
            submitForm();

            if (!isValid) {
              toast({
                variant: "destructive",
                title: "Please fix the errors and try again.",
                description: formatFormErrors(errors),
              });
              console.debug(errors);
            }
          }}
        />
      </div>
    </>
  );
}
