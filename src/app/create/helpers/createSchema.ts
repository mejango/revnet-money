import { isRecord, issue, schema, ValidationIssue } from "@/lib/formValidation";
import { isAddress } from "viem";
import type { RevnetFormData } from "../types";
import { validateStage } from "./stageSchema";

function requiredTrimmedString(
  value: unknown,
  path: string,
  message: string,
  issues: ValidationIssue[],
  maxLength?: number,
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    issue(issues, [path], message);
  } else if (maxLength !== undefined && value.trim().length > maxLength) {
    issue(issues, [path], `${path === "name" ? "Name" : "Value"} is too long`);
  }
}

function optionalString(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value !== undefined && typeof value !== "string") {
    issue(issues, [path], "Invalid value");
  }
}

export const createSchema = schema<RevnetFormData>((input) => {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    issue(issues, [], "Invalid form");
    return issues;
  }

  requiredTrimmedString(input.name, "name", "Name is required", issues, 50);
  requiredTrimmedString(input.description, "description", "Description is required", issues);

  if (typeof input.tokenSymbol !== "string" || input.tokenSymbol.length < 2) {
    issue(issues, ["tokenSymbol"], "Token symbol must be at least 2 characters");
  } else if (input.tokenSymbol.length > 10) {
    issue(issues, ["tokenSymbol"], "Token symbol is too long");
  }

  optionalString(input.logoUri, "logoUri", issues);
  optionalString(input.twitter, "twitter", issues);
  optionalString(input.telegram, "telegram", issues);
  optionalString(input.discord, "discord", issues);
  optionalString(input.infoUri, "infoUri", issues);

  if (input.reserveAsset !== "ETH" && input.reserveAsset !== "USDC") {
    issue(issues, ["reserveAsset"], "Invalid reserve asset");
  }

  if (!Array.isArray(input.stages) || input.stages.length === 0) {
    issue(issues, ["stages"], "At least one stage is required");
  } else {
    input.stages.forEach((stage, index) =>
      issues.push(...validateStage(stage, ["stages", index], { requireAutoIssuanceChain: true })),
    );
  }

  const selectedChainIds: Array<string | number> = [];
  if (!Array.isArray(input.chainIds) || input.chainIds.length === 0) {
    issue(issues, ["chainIds"], "At least one chain must be selected");
  } else {
    input.chainIds.forEach((chainId, index) => {
      if (!(
        (typeof chainId === "string" && chainId.length > 0) ||
        (typeof chainId === "number" && Number.isFinite(chainId))
      )) {
        issue(issues, ["chainIds", index], "Invalid chain");
      } else {
        selectedChainIds.push(chainId);
      }
    });
  }

  if (!Array.isArray(input.operator)) {
    issue(issues, ["operator"], "Invalid operators");
  } else {
    input.operator.forEach((operator, index) => {
      if (!isRecord(operator)) {
        issue(issues, ["operator", index], "Invalid operator");
        return;
      }
      const chainId = operator.chainId;
      if (!(
        (typeof chainId === "string" && chainId.length > 0) ||
        (typeof chainId === "number" && Number.isFinite(chainId))
      )) {
        issue(issues, ["operator", index, "chainId"], "Invalid chain");
      }
      const address = String(operator.address ?? "");
      if (!address) {
        issue(issues, ["operator", index, "address"], "Address is required");
      } else if (!isAddress(address, { strict: false })) {
        issue(issues, ["operator", index, "address"], "Invalid address");
      }
    });
  }

  if (selectedChainIds.length > 0) {
    const operators = Array.isArray(input.operator) ? input.operator : [];
    const firstStage =
      Array.isArray(input.stages) && isRecord(input.stages[0]) ? input.stages[0] : {};

    for (const chainId of selectedChainIds) {
      const perChainOperator = operators.find(
        (operator) => isRecord(operator) && Number(operator.chainId) === Number(chainId),
      );
      const effectiveOperator = isRecord(perChainOperator)
        ? perChainOperator.address
        : firstStage.initialOperator;
      if (
        typeof effectiveOperator !== "string" ||
        !isAddress(effectiveOperator, { strict: false })
      ) {
        if (!isRecord(perChainOperator)) {
          issue(issues, ["operator"], `Set a valid operator for chain ${chainId}`);
        }
      }
    }

    if (Array.isArray(input.stages)) {
      input.stages.forEach((stage, stageIndex) => {
        if (!isRecord(stage) || !Array.isArray(stage.autoIssuance)) return;
        stage.autoIssuance.forEach((entry, entryIndex) => {
          if (
            isRecord(entry) &&
            !selectedChainIds.some((chainId) => Number(chainId) === Number(entry.chainId))
          ) {
            issue(
              issues,
              ["stages", stageIndex, "autoIssuance", entryIndex, "chainId"],
              "Auto issuance chain must be selected for deployment",
            );
          }
        });
      });
    }
  }

  return issues;
});
