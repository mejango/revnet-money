"use client";

import { useFormContext } from "@/lib/forms";
import { RevnetFormData } from "../types";

export function useCreateForm() {
  const context = useFormContext<RevnetFormData>();

  const revnetTokenSymbol =
    context.values.tokenSymbol?.length > 0
      ? context.values.tokenSymbol.replace(/^\$+/, "")
      : "token";

  return {
    ...context,
    revnetTokenSymbol,
  };
}
