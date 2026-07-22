import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type SourceExpectation = { file: string; contains: string[] };

const actionExpectations: Array<{
  marker: string;
  sources: SourceExpectation[];
}> = [
  {
    marker: "wallet-action:repay",
    sources: [
      {
        file: "src/app/[slug]/components/Value/RepayDialog.tsx",
        contains: [
          'functionName: "approve"',
          'functionName: "repayLoan"',
          "requireOnchainExecution",
        ],
      },
    ],
  },
  {
    marker: "wallet-action:claim-credits",
    sources: [
      {
        file: "src/app/[slug]/components/v6/owners/accounts/V6ClaimCreditsDialog.tsx",
        contains: ["buildClaimTokensTx", "simulateContract", "writeContractAsync(tx)"],
      },
    ],
  },
  {
    marker: "wallet-action:split-hook",
    sources: [
      {
        file: "src/app/[slug]/components/v6/owners/market/SplitHookCard.tsx",
        contains: ['"deployPool"', '"collectAndRouteLPFees"', "simulateContract"],
      },
    ],
  },
  {
    marker: "wallet-action:auto-issuance",
    sources: [
      {
        file: "src/app/[slug]/components/v6/owners/V6AutoIssuanceSubtab.tsx",
        contains: ["buildAutoIssueTx", "writeContractAsync"],
      },
    ],
  },
  {
    marker: "wallet-action:token-admin",
    sources: [
      {
        file: "src/app/[slug]/components/v6/owners/V6TokenPanel.tsx",
        contains: ['functionName: "setTokenMetadataOf"', 'functionName: "deployERC20For"'],
      },
    ],
  },
  {
    marker: "wallet-action:reserved-distribution",
    sources: [
      {
        file: "src/app/[slug]/owners/components/DistributeReservedTokensButton.tsx",
        contains: ['functionName: "sendReservedTokensToSplitsOf"'],
      },
    ],
  },
  {
    marker: "wallet-action:split-groups",
    sources: [
      {
        file: "src/app/[slug]/owners/components/hooks/useSetSplitGroups.ts",
        contains: ['functionName: "setSplitGroupsOf"', "getRelayrTxQuote", "writeContractAsync"],
      },
    ],
  },
  {
    marker: "wallet-action:metadata",
    sources: [
      {
        file: "src/app/[slug]/about/components/EditMetadataDialog.tsx",
        contains: ['functionName: "setUriOf"', "getRelayrTxQuote", "writeContractAsync"],
      },
    ],
  },
  {
    marker: "wallet-action:project-payer",
    sources: [
      {
        file: "src/app/[slug]/components/v6/extras/PayerDeployForm.tsx",
        contains: ["buildDeployProjectPayerTx", "simulateContract", "writeContractAsync"],
      },
    ],
  },
  {
    marker: "wallet-action:operator-writes",
    sources: [
      {
        file: "src/app/[slug]/components/v6/operator/BuybackRouterCard.tsx",
        contains: ['functionName: "setHookFor"', 'functionName: "setTerminalFor"'],
      },
      {
        file: "src/app/[slug]/components/v6/operator/OperatorAccountCard.tsx",
        contains: ['functionName: "setOperatorOf"'],
      },
      {
        file: "src/app/[slug]/components/v6/operator/operatorLib.ts",
        contains: ["simulateContract", "writeContractAsync"],
      },
    ],
  },
  {
    marker: "wallet-action:settlement-sync",
    sources: [
      {
        file: "src/app/[slug]/components/v6/owners/settlement/GossipCard.tsx",
        contains: ["buildSyncAccountingDataTx", "simulateContract", "writeContractAsync"],
      },
    ],
  },
  {
    marker: "wallet-action:queued-movements",
    sources: [
      {
        file: "src/app/[slug]/components/v6/owners/settlement/QueuedMovementsCard.tsx",
        contains: ["buildV6ClaimTxFromRow", 'functionName: "toRemote"', "simulateContract"],
      },
    ],
  },
  {
    marker: "wallet-action:shop-items",
    sources: [
      {
        file: "src/app/[slug]/components/v6/shop/AddItemsModal.tsx",
        contains: ['functionName: "adjustTiers"', "simulateContract", "writeContractAsync"],
      },
    ],
  },
];

for (const { marker, sources } of actionExpectations) {
  describe(marker, () => {
    for (const { file, contains } of sources) {
      it(`${file} retains its reviewed contract operation and simulation boundary`, () => {
        const source = readFileSync(resolve(process.cwd(), file), "utf8");
        for (const fragment of contains) expect(source).toContain(fragment);
      });
    }
  });
}
