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
    marker: "wallet-action:project-handle",
    sources: [
      {
        file: "src/app/[slug]/components/v6/operator/ProjectHandleEditor.tsx",
        contains: [
          'functionName: "setText"',
          'functionName: "setEnsNamePartsFor"',
          'functionName: "createProxyWithNonce"',
          "isLiveRevnetOperator",
          "simulateSafeProxyDeployment",
          "requireOnchainExecution",
        ],
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
        // Sucker extension must verify the target chain's config hash before
        // building the deploySuckersFor writes — pairing depends on it.
        file: "src/app/[slug]/components/v6/operator/SuckerExtensionCard.tsx",
        contains: [
          '"hashedEncodedConfigurationOf"',
          "buildSuckerExtensionWrites",
          "runSequentialWrites",
        ],
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

describe("project handle ENS authorization", () => {
  it("presents arbitrary .eth names as a tuple-scoped resumable self-service flow", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/operator/ProjectHandleEditor.tsx"),
      "utf8",
    );
    expect(source).toContain("Use any .eth name you control or are authorized to update.");
    expect(source).toContain("it can differ from");
    expect(source).toContain("the revnet operator");
    expect(source).toContain("This resumable flow sets its");
    expect(source).toContain("this viewed {chainName(project.chainId)} deployment only");
    expect(source).toContain('placeholder="banny.eth"');
    expect(source).toContain("onClick={textMatches ? publish : setEnsRecord}");
    expect(source).toContain("`Set ${parsed.handle.ensName} record`");
    expect(source).toContain("`Publish /@${parsed.handle.handle}`");
  });

  it("pins the exact resolver while leaving owner and delegate authorization to simulation", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/operator/ProjectHandleEditor.tsx"),
      "utf8",
    );
    expect(source).toContain("The exact resolver itself remains pinned");
    expect(source).toContain("approved delegates can also submit");
    expect(source).not.toContain("connectedIsEnsController");
    expect(source).not.toContain("fresh.ensController.toLowerCase()");
  });

  it("live-checks the server fallback across every Operator authority surface", () => {
    for (const file of [
      "src/app/[slug]/components/v6/operator/OperatorAccountCard.tsx",
      "src/app/[slug]/components/v6/operator/SafeQueueCard.tsx",
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).toContain("useLiveRevnetOperators");
      expect(source).toContain("fallbackOperator");
      expect(source).not.toContain("pickRevnetOperator");
    }
    const edits = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/operator/OperatorEditsCard.tsx"),
      "utf8",
    );
    expect(edits).toContain("fallbackOperator={fallbackOperator}");
  });

  it("registers the Safe App connector needed by an Ethereum operator Safe", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/wagmiConfig.ts"), "utf8");
    expect(source).toContain('import { safe } from "wagmi/connectors/safe"');
    expect(source).toContain("[safe(), injected({ shimDisconnect: true })");
  });

  it("rechecks the active ENS resolver and live cross-chain operator after receipts", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/operator/ProjectHandleEditor.tsx"),
      "utf8",
    );
    expect(source).toContain("confirmedResolver.toLowerCase() !== fresh.resolver.toLowerCase()");
    expect(source).toContain("const confirmedRecord = await readExactEnsText");
    expect(source).toContain("const confirmedAuthority = await readCrossChainHandleAuthority");
    expect(source).toContain("const confirmed = await readHandleSetup");
  });

  it("binds project-handle publish inputs and the exact ENS record after review", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/operator/ProjectHandleEditor.tsx"),
      "utf8",
    );
    expect(source).toContain('variables.functionName !== "setEnsNamePartsFor"');
    expect(source).toContain("encodedChainId !== BigInt(project.chainId)");
    expect(source).toContain("encodedProjectId !== BigInt(project.projectId)");
    expect(source).toContain("canonicalProjectHandleParts");
    expect(source).toContain("const record = await readExactEnsText");
    expect(source).toContain("record !== expectedRecord");
  });

  it("rechecks classified handle writes at every Safe queue wallet boundary", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/operator/SafeQueueCard.tsx"),
      "utf8",
    );
    expect(source.match(/verifyLiveQueuedTransaction/g)?.length ?? 0).toBeGreaterThanOrEqual(7);
    expect(source).toContain("target.handleOnly");
    expect(source).toContain("bindingMatchesProject(binding, target.handleSource)");
    expect(source).toContain("verifyQueuedProjectHandleBinding");
  });
});
