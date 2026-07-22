import type { FormikErrors } from "formik";
import type { ZodType } from "zod";

type ErrorNode = Record<string | number, unknown> | unknown[];

function setIssue(root: ErrorNode, path: PropertyKey[], message: string): void {
  if (!path.length) {
    (root as Record<string, unknown>)._form = message;
    return;
  }

  let cursor = root;
  for (const [index, segment] of path.entries()) {
    const key = String(segment);
    if (index === path.length - 1) {
      (cursor as Record<string, unknown>)[key] = message;
      return;
    }

    const next = path[index + 1];
    const existing = (cursor as Record<string, unknown>)[key];
    if (typeof existing === "object" && existing !== null) {
      cursor = existing as ErrorNode;
      continue;
    }

    const child: ErrorNode = typeof next === "number" ? [] : {};
    (cursor as Record<string, unknown>)[key] = child;
    cursor = child;
  }
}

/** Adapt a Zod 4 schema to Formik's synchronous `validate` contract. */
export function withZodSchema<Values>(schema: ZodType<Values>) {
  return (values: unknown): FormikErrors<Values> => {
    const result = schema.safeParse(values);
    if (result.success) return {};

    const errors: ErrorNode = {};
    for (const issue of result.error.issues) {
      setIssue(errors, issue.path, issue.message);
    }
    return errors as FormikErrors<Values>;
  };
}
