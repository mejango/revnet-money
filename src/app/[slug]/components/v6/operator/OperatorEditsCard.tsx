"use client";

import { EditMetadataDialog } from "@/app/[slug]/about/components/EditMetadataDialog";
import { ChangeSplitRecipientsDialog } from "@/app/[slug]/owners/components/ChangeSplitRecipientsDialog";
import { useFetchProjectRulesets } from "@/hooks/useFetchProjectRulesets";
import { useJBChainId, useSuckers } from "@bananapus/nana-sdk-react";
import { BuildPromptFooter } from "../BuildPromptFooter";
import { ProjectItem } from "../shared";

/**
 * website/-parity renderEditsCard: the operator's edit actions, each reusing
 * the app's existing dialog. "Set token metadata" is intentionally absent —
 * revnet-app has no setTokenMetadataOf/deployERC20 flow to reuse.
 */
export function OperatorEditsCard({ projects }: { projects: ProjectItem[] }) {
  const chainId = useJBChainId();
  const { data: suckers } = useSuckers();
  const { suckerPairsWithRulesets } = useFetchProjectRulesets(suckers);

  // The current stage on the page's chain, mirroring SplitsSection: the stage
  // before the first one that hasn't started yet (lower-bounded at stage 1).
  const rulesets = suckerPairsWithRulesets?.find(
    (sucker) => sucker.peerChainId === chainId,
  )?.rulesets;
  const nextStageIdx = Math.max(
    rulesets?.findIndex((stage) => stage.start > Date.now() / 1000) ?? -1,
    1,
  );
  const currentStageIdx = nextStageIdx - 1;

  return (
    <div>
      <h3 className="text-sm font-medium text-zinc-500 mb-2">Edits</h3>
      <div className="max-w-screen-sm space-y-4">
        <div className="border border-zinc-200 rounded p-4">
          <p className="text-sm font-medium">Set project metadata</p>
          <p className="text-xs text-zinc-500 mt-1 mb-3">
            Update the project&apos;s name, logo, description, links, and tags. Requires the
            operator&apos;s SET_PROJECT_URI permission.
          </p>
          <EditMetadataDialog projects={projects} />
        </div>
        <div className="border border-zinc-200 rounded p-4">
          <p className="text-sm font-medium">Set reserved splits</p>
          <p className="text-xs text-zinc-500 mt-1 mb-3">
            Edit the reserved token recipients for the current stage. Requires the
            operator&apos;s SET_SPLIT_GROUPS permission.
          </p>
          {chainId ? (
            <ChangeSplitRecipientsDialog
              stageId={currentStageIdx}
              initialChainId={chainId}
            />
          ) : (
            <p className="text-xs text-zinc-500">Loading chain context…</p>
          )}
        </div>
        <BuildPromptFooter title="Edit project" concept="edit-project" />
      </div>
    </div>
  );
}
