import { DeployRevnetForm } from "@/app/create/form/DeployRevnetForm";
import { createSchema } from "@/app/create/helpers/createSchema";
import type { RevnetFormData } from "@/app/create/types";
import { withSchema } from "@/lib/formValidation";
import { FormProvider } from "@/lib/forms";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { baseSepolia, sepolia } from "viem/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_ACCOUNT, TEST_BENEFICIARY, validRevnetForm } from "./fixtures/revnet";

function renderCreateForm(initialValues: RevnetFormData) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      {createForm(initialValues)}
    </QueryClientProvider>,
  );
}

function createForm(initialValues: RevnetFormData) {
  return (
    <FormProvider
      initialValues={initialValues}
      isInitialValid={false}
      validate={withSchema(createSchema)}
      onSubmit={() => undefined}
    >
      {({ values }) => (
        <>
          <DeployRevnetForm resetRelayrResponse={() => undefined} />
          <output data-testid="form-state">
            {JSON.stringify({
              operator: values.operator,
              stages: values.stages,
              issuanceBaseCurrency: values.issuanceBaseCurrency,
            })}
          </output>
        </>
      )}
    </FormProvider>
  );
}

function formState() {
  return JSON.parse(screen.getByTestId("form-state").textContent ?? "{}") as {
    operator: RevnetFormData["operator"];
    stages: RevnetFormData["stages"];
    issuanceBaseCurrency: RevnetFormData["issuanceBaseCurrency"];
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "debug").mockImplementation(() => undefined);
});

describe("create form section order", () => {
  it("asks for chains in the first section, before every chain-dependent section", () => {
    renderCreateForm(validRevnetForm());

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent ?? "");
    const indexOf = (pattern: RegExp) => headings.findIndex((heading) => pattern.test(heading));

    expect(headings[0]).toMatch(/chains/i);
    expect(indexOf(/chains/i)).toBeLessThan(indexOf(/look/i));
    expect(indexOf(/chains/i)).toBeLessThan(indexOf(/assets/i));
    expect(indexOf(/chains/i)).toBeLessThan(indexOf(/terms/i));
    expect(indexOf(/chains/i)).toBeLessThan(indexOf(/deploy/i));
    expect(indexOf(/deploy/i)).toBe(headings.length - 1);
  });
});

describe("inline per-chain inputs driven by the up-front chain selection", () => {
  function multiChainForm() {
    const form = validRevnetForm();
    form.chainIds = [sepolia.id, baseSepolia.id];
    form.operator = [];
    form.stages[0].splits[0].beneficiary = undefined;
    return form;
  }

  it("expands a split beneficiary and the operator to per-chain values at the field", () => {
    renderCreateForm(multiChainForm());

    fireEvent.click(screen.getByLabelText("Edit stage 1"));

    // Single value by default; expandable to the selected chains, seeded with
    // the single default value.
    expect(screen.queryByLabelText("Sepolia beneficiary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/per chain/i, { selector: "#perChainBeneficiary-0" }));
    expect(screen.getByLabelText("Sepolia beneficiary")).toHaveValue(TEST_BENEFICIARY);
    expect(screen.getByLabelText("Base Sepolia beneficiary")).toHaveValue(TEST_BENEFICIARY);

    fireEvent.change(screen.getByLabelText("Base Sepolia beneficiary"), {
      target: { value: TEST_ACCOUNT },
    });

    // Operator expands the same way, seeded with the stage operator. The
    // dialog buffers the edit: nothing reaches the parent form until Save.
    fireEvent.click(screen.getByLabelText(/per chain/i, { selector: "#perChainOperator" }));
    fireEvent.change(screen.getByLabelText("Base Sepolia operator"), {
      target: { value: TEST_BENEFICIARY },
    });
    expect(formState().operator).toEqual([]);

    fireEvent.click(screen.getByText("Save stage"));
    expect(formState().operator).toEqual([
      { chainId: String(sepolia.id), address: TEST_ACCOUNT },
      { chainId: String(baseSepolia.id), address: TEST_BENEFICIARY },
    ]);
    expect(formState().stages[0].splits[0].beneficiary).toEqual([
      { chainId: sepolia.id, address: TEST_BENEFICIARY },
      { chainId: baseSepolia.id, address: TEST_ACCOUNT },
    ]);
  });

  it("discards buffered per-chain operator edits when the dialog closes without saving", () => {
    renderCreateForm(multiChainForm());

    fireEvent.click(screen.getByLabelText("Edit stage 1"));
    fireEvent.click(screen.getByLabelText(/per chain/i, { selector: "#perChainOperator" }));
    fireEvent.change(screen.getByLabelText("Base Sepolia operator"), {
      target: { value: TEST_BENEFICIARY },
    });

    // Cancel means cancel: close without saving.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(formState().operator).toEqual([]);

    // Reopening starts from the parent's (unchanged) state.
    fireEvent.click(screen.getByLabelText("Edit stage 1"));
    expect(
      (screen.getByLabelText(/per chain/i, { selector: "#perChainOperator" }) as HTMLInputElement)
        .checked,
    ).toBe(false);
  });

  it("asks for the issuance base currency once, in the assets section, not per stage", () => {
    renderCreateForm(multiChainForm());

    // One global control in the form body.
    const select = screen.getByLabelText("Issuance currency");
    fireEvent.change(select, { target: { value: "USD" } });
    expect(formState().issuanceBaseCurrency).toBe("USD");

    // The stage dialog shows the chosen denomination without asking again.
    fireEvent.click(screen.getByLabelText("Edit stage 1"));
    expect(screen.queryAllByLabelText("Issuance currency")).toHaveLength(1);
  });

  it("assigns each auto-issuance row a selected chain at input time and saves it", () => {
    renderCreateForm(multiChainForm());

    fireEvent.click(screen.getByLabelText("Edit stage 1"));
    fireEvent.click(screen.getByText("add auto issuance +"));

    // Both rows' chain pickers show a chain from the up-front selection: the
    // fixture row keeps its chain, the new row defaults to the first one.
    expect(screen.getAllByText("Sepolia").length).toBeGreaterThanOrEqual(2);

    fireEvent.change(screen.getByLabelText("... and"), { target: { value: "40" } });
    // "to" labels: the split beneficiary, then one per auto-issuance row.
    fireEvent.change(screen.getAllByLabelText("to")[2], { target: { value: TEST_ACCOUNT } });
    fireEvent.click(screen.getByText("Save stage"));

    expect(formState().stages[0].autoIssuance).toEqual([
      { amount: "25", beneficiary: TEST_BENEFICIARY, chainId: sepolia.id },
      { amount: "40", beneficiary: TEST_ACCOUNT, chainId: sepolia.id },
    ]);
  });
});
