"use client";

import { useBendystrawQuery, useJBContractContext } from "@bananapus/nana-sdk-react";
import { useMemo } from "react";
import { BuildPromptFooter } from "../BuildPromptFooter";
import { ProjectItem } from "../shared";
import { PayerAddressList } from "./PayerAddressList";
import { PayerDeployForm } from "./PayerDeployForm";
import {
  ProjectPayersDocument,
  chainProjectRows,
  payersWhere,
} from "./projectPayers";

/**
 * website/-parity Extras tab (renderExtrasSection): the "Payer address"
 * deployment form (JBProjectPayerDeployer.deployProjectPayer per selected
 * chain, sequential simulate-first txs) with the sucker group's indexed payer
 * addresses from bendystraw below it.
 */
export function V6ExtrasTab({ projects }: { projects: ProjectItem[] }) {
  const { version } = useJBContractContext();
  const rows = useMemo(() => chainProjectRows(projects), [projects]);

  const payersQuery = useBendystrawQuery(
    ProjectPayersDocument,
    { where: payersWhere(rows, version) },
    { enabled: rows.length > 0 },
  );
  const payerRows = payersQuery.data?.projectPayers?.items ?? [];

  if (rows.length === 0) {
    return <div className="text-zinc-500">Nothing here yet.</div>;
  }

  return (
    <div className="flex flex-col min-w-0 gap-2">
      <h3 className="text-sm font-medium text-zinc-500 mb-2">Payer address</h3>
      <div className="max-w-screen-sm">
        <PayerDeployForm
          rows={rows}
          existingRows={payerRows}
          onDeployed={() => payersQuery.refetch()}
        />
        <BuildPromptFooter title="Payer address" concept="project-payer" />
        <PayerAddressList
          rows={payerRows}
          isLoading={payersQuery.isLoading}
          isError={payersQuery.isError}
        />
      </div>
    </div>
  );
}
