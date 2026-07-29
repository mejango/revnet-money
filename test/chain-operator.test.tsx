import { ChainOperator } from "@/app/create/form/ChainOperator";
import { createSchema } from "@/app/create/helpers/createSchema";
import { parseDeployData } from "@/app/create/helpers/parseDeployData";
import type { RevnetFormData } from "@/app/create/types";
import { withSchema } from "@/lib/formValidation";
import { FormProvider } from "@/lib/forms";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { baseSepolia, sepolia } from "viem/chains";
import { describe, expect, it } from "vitest";
import {
  EMPTY_SUCKER_CONFIG,
  TEST_ACCOUNT,
  TEST_BENEFICIARY,
  TEST_SALT,
  TEST_TIMESTAMP,
  validRevnetForm,
} from "./fixtures/revnet";

/**
 * Selection order deliberately differs from the sorted render order
 * (sortChains renders Sepolia before Base Sepolia): binding by index would
 * cross-wire the typed address onto the wrong chain.
 */
function operatorForm(): RevnetFormData {
  const form = validRevnetForm();
  form.chainIds = [baseSepolia.id, sepolia.id];
  form.operator = [];
  form.stages[0].initialOperator = "";
  return form;
}

function Harness({ initialValues }: { initialValues: RevnetFormData }) {
  const [show, setShow] = useState(true);
  return (
    <FormProvider
      initialValues={initialValues}
      isInitialValid={false}
      validate={withSchema(createSchema)}
      onSubmit={() => undefined}
    >
      {({ values }) => (
        <>
          {show ? <ChainOperator /> : null}
          <button type="button" onClick={() => setShow(false)}>
            hide-operator
          </button>
          <output data-testid="operator-state">{JSON.stringify(values.operator)}</output>
        </>
      )}
    </FormProvider>
  );
}

function operatorState(): RevnetFormData["operator"] {
  return JSON.parse(screen.getByTestId("operator-state").textContent ?? "[]");
}

function deployOperatorFor(form: RevnetFormData, chainId: number) {
  const request = parseDeployData(form, {
    metadataCid: "bafy-metadata",
    chainId: chainId as RevnetFormData["chainIds"][number],
    suckerDeployerConfig: EMPTY_SUCKER_CONFIG,
    timestamp: TEST_TIMESTAMP,
    salt: TEST_SALT,
    creationFee: 123n,
  });
  return (request.args[1] as { operator: string }).operator;
}

describe("ChainOperator per-chain binding", () => {
  it("binds each typed address to the chain it is rendered beside, not the selection index", () => {
    render(<Harness initialValues={operatorForm()} />);

    fireEvent.change(screen.getByLabelText("Sepolia operator address"), {
      target: { value: TEST_ACCOUNT },
    });
    fireEvent.change(screen.getByLabelText("Base Sepolia operator address"), {
      target: { value: TEST_BENEFICIARY },
    });

    const operators = operatorState();
    expect(operators).toContainEqual({ chainId: String(sepolia.id), address: TEST_ACCOUNT });
    expect(operators).toContainEqual({
      chainId: String(baseSepolia.id),
      address: TEST_BENEFICIARY,
    });

    // The deploy encoding receives the address typed next to each chain.
    const form = { ...operatorForm(), operator: operators };
    expect(deployOperatorFor(form, sepolia.id)).toBe(TEST_ACCOUNT);
    expect(deployOperatorFor(form, baseSepolia.id)).toBe(TEST_BENEFICIARY);
  });

  it("does not seed entries on mount and never rewrites existing entries", () => {
    const form = operatorForm();
    // A pre-existing entry, e.g. set from the stage dialog.
    form.operator = [{ chainId: String(baseSepolia.id), address: TEST_BENEFICIARY }];
    render(<Harness initialValues={form} />);

    // Untouched on mount: same single entry, same chainId.
    expect(operatorState()).toEqual([
      { chainId: String(baseSepolia.id), address: TEST_BENEFICIARY },
    ]);

    // The pre-existing entry backs its chain's input; the other starts empty.
    expect(screen.getByLabelText("Base Sepolia operator address")).toHaveValue(TEST_BENEFICIARY);
    expect(screen.getByLabelText("Sepolia operator address")).toHaveValue("");

    // Typing on the other chain appends without touching the existing entry.
    fireEvent.change(screen.getByLabelText("Sepolia operator address"), {
      target: { value: TEST_ACCOUNT },
    });
    expect(operatorState()).toEqual([
      { chainId: String(baseSepolia.id), address: TEST_BENEFICIARY },
      { chainId: String(sepolia.id), address: TEST_ACCOUNT },
    ]);
  });

  it("starts with no entries and removes empty ones when the section unmounts", () => {
    render(<Harness initialValues={operatorForm()} />);

    // No empty seeding on mount (empty entries would dead-end validation
    // after the section disappears).
    expect(operatorState()).toEqual([]);

    fireEvent.change(screen.getByLabelText("Sepolia operator address"), {
      target: { value: TEST_ACCOUNT },
    });
    fireEvent.change(screen.getByLabelText("Base Sepolia operator address"), {
      target: { value: TEST_BENEFICIARY },
    });
    // Clearing leaves an empty entry behind…
    fireEvent.change(screen.getByLabelText("Sepolia operator address"), {
      target: { value: "" },
    });

    // …which is cleaned up when the section unmounts.
    fireEvent.click(screen.getByText("hide-operator"));
    expect(operatorState()).toEqual([
      { chainId: String(baseSepolia.id), address: TEST_BENEFICIARY },
    ]);
  });
});
