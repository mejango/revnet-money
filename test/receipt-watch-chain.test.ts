import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lineOf, parseSource, sourceFiles } from "./support/source-scan";

/*
 * A receipt watcher names the chain its transaction was sent on. Without one,
 * wagmi watches the wallet's current chain, and a wallet moved to another
 * chain mid-wait leaves the flow waiting on a receipt that chain never has.
 *
 * The check is lexical: it finds calls to an identifier named
 * useWaitForTransactionReceipt. A call through an aliased import, or a member
 * call such as wagmi.useWaitForTransactionReceipt, is not seen.
 */

const root = resolve(import.meta.dirname, "..");

/** Every useWaitForTransactionReceipt call in a file, and whether it names a chain. */
function receiptWatchers(file: string): Array<{ at: string; namesChain: boolean }> {
  const text = readFileSync(file, "utf8");
  // Parse only files that call it: the suite runs this beside other source scans.
  if (!text.includes("useWaitForTransactionReceipt")) return [];
  const source = parseSource(file, text);
  const found: Array<{ at: string; namesChain: boolean }> = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "useWaitForTransactionReceipt"
    ) {
      const [parameters] = node.arguments;
      const namesChain =
        parameters !== undefined &&
        ts.isObjectLiteralExpression(parameters) &&
        parameters.properties.some((property) => property.name?.getText(source) === "chainId");
      found.push({ at: `${relative(root, file)}:${lineOf(node, source)}`, namesChain });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("receipt watchers", () => {
  const watchers = sourceFiles(join(root, "src")).flatMap(receiptWatchers);

  it("reads the watchers it checks", () => {
    expect(watchers.length).toBeGreaterThan(8);
  });

  it("name the chain their transaction was sent on", () => {
    expect(watchers.filter(({ namesChain }) => !namesChain).map(({ at }) => at)).toEqual([]);
  });
});
