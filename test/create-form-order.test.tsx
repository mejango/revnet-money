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

function precedes(first: Element, second: Element) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("create form section order", () => {
  it("numbers the sections in render order", () => {
    renderCreateForm(validRevnetForm());

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent ?? "");

    expect(headings).toEqual(["1. Look", "2. Settlement", "3. Terms", "4. Deploy"]);
  });

  it("settles chains and the reserve asset in one section, chains first", () => {
    renderCreateForm(validRevnetForm());

    // "Look" (name, ticker, logo, about, socials) has no chain-dependent
    // field, so it leads. Everything from the chain picker down does.
    const environment = screen.getByLabelText("Deployment environment");
    const chain = screen.getByRole("checkbox", { name: "Ethereum" });
    const reserveAsset = screen.getByRole("checkbox", { name: "Custom token" });
    const terms = screen.getByRole("heading", { name: "3. Terms" });

    expect(precedes(environment, chain)).toBe(true);
    expect(precedes(chain, reserveAsset)).toBe(true);
    expect(precedes(reserveAsset, terms)).toBe(true);
  });

  it("describes chains and reserve asset from the settlement section's copy", () => {
    renderCreateForm(validRevnetForm());

    const settlement = screen.getByRole("heading", { name: "2. Settlement" }).closest("div");
    expect(settlement?.textContent).toContain(
      "Pick which chains your revnet will accept money on and issue SAFE from, and which reserve asset will back the value of SAFE.",
    );
    expect(settlement?.textContent).toContain(
      "Holders of SAFE can cash out on any of the selected chains for the reserve token(s), and can move their SAFE between chains at any time, which moves proportional reserved tokens alongside.",
    );
  });

  it("promises operator-added chains from the deploy step, not the chain picker", () => {
    renderCreateForm(validRevnetForm());

    // The operator is configured in Terms, below the chain picker: this
    // promise only reads correctly once it sits with the other post-deploy
    // expectations.
    const copy = screen.getByText(/able to add new chains to the revnet later/i);
    expect(copy.closest("div")?.querySelector("h2")?.textContent).toBe("4. Deploy");
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

  it("edits the issuance denomination inline in the stage, as one global value", () => {
    renderCreateForm(multiChainForm());

    // No standalone denomination block in the form body: the control lives at
    // the point of use, in the stage's issuance row.
    expect(screen.queryByLabelText("Issuance currency")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Edit stage 1"));
    const inline = screen.getByLabelText("Issuance currency");
    expect(inline).toHaveValue("ETH");
    fireEvent.change(inline, { target: { value: "USD" } });

    // Buffered like the dialog's other parent-form fields: nothing reaches the
    // create form until Save.
    expect(formState().issuanceBaseCurrency).toBe("ETH");
    fireEvent.click(screen.getByText("Save stage"));
    expect(formState().issuanceBaseCurrency).toBe("USD");

    // The value is global: the stage summary quotes issuance in it.
    expect(
      screen.getAllByText(
        (_, element) => element?.tagName === "DD" && /\/\s*USD/.test(element.textContent ?? ""),
      ).length,
    ).toBeGreaterThan(0);
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
