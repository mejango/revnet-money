"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { loadProjectDiagnostics } from "@/lib/projectDiagnostics";
import { projectIndexMessage, type ProjectIndexStatus } from "@/lib/projectIndexStatus";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import {
  describeProjectDataStatus,
  type ProjectDeploymentCheck,
} from "@bananapus/nana-sdk-core/v6";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, useTransition, type PropsWithChildren } from "react";
import { isAddress, type Address } from "viem";
import { CheckDeploymentButton, DiagnosticsContext } from "./CheckDeploymentButton";

const statusLabels = {
  passed: "Verified",
  mismatch: "Needs attention",
  unsupported: "Custom or unsupported",
  unavailable: "Unavailable",
  info: "Information",
} satisfies Record<ProjectDeploymentCheck["status"], string>;

export function ProjectDiagnosticsProvider({
  children,
  chainId,
  projectId,
}: PropsWithChildren<{
  chainId: JBChainId;
  projectId: bigint;
}>) {
  const [open, setOpen] = useState(false);
  const [operatorInput, setOperatorInput] = useState("");
  const [operator, setOperator] = useState<Address>();
  const [operatorError, setOperatorError] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const query = useQuery({
    queryKey: ["project-deployment-diagnostics", chainId, projectId.toString(), operator ?? null],
    queryFn: () => loadProjectDiagnostics(chainId, projectId, operator),
    enabled: open,
    retry: false,
    staleTime: 0,
  });
  const report = query.isError ? undefined : query.data;

  async function copyDiagnostics() {
    try {
      // Drop the query and hash: a shared report needs project identity, not browser state.
      const projectUrl = new URL(window.location.pathname, window.location.origin).href;
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            projectUrl,
            chainId,
            projectId: projectId.toString(),
            operator: operator ?? null,
            ...report,
          },
          null,
          2,
        ),
      );
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <DiagnosticsContext.Provider
      value={() => {
        setCopyState("idle");
        setOpen(true);
      }}
    >
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>Check deployment</DialogTitle>
          <DialogDescription>
            Read-only checks for project #{projectId.toString()} on chain {chainId}.
          </DialogDescription>
          <form
            className="space-y-1 text-sm"
            onSubmit={(event) => {
              event.preventDefault();
              const value = operatorInput.trim();
              if (value && !isAddress(value)) {
                setOperatorError(true);
                return;
              }
              setOperatorError(false);
              setCopyState("idle");
              const next = value ? (value as Address) : undefined;
              if (next === operator) void query.refetch();
              else setOperator(next);
            }}
          >
            <label htmlFor="diagnostic-operator">Operator address (optional)</label>
            <div className="flex flex-wrap gap-2">
              <input
                id="diagnostic-operator"
                value={operatorInput}
                onChange={(event) => {
                  setOperatorInput(event.target.value);
                  setOperatorError(false);
                }}
                placeholder="0x…"
                className="min-h-11 min-w-0 flex-1 border border-zinc-300 px-2"
                aria-invalid={operatorError}
                aria-describedby={operatorError ? "diagnostic-operator-error" : undefined}
              />
              <button type="submit" className="min-h-11 underline" disabled={query.isFetching}>
                Check operator
              </button>
            </div>
            <p className="text-zinc-500">Include an address to check its shop permissions.</p>
            {operatorError ? (
              <p id="diagnostic-operator-error" role="alert">
                Enter a valid operator address.
              </p>
            ) : null}
          </form>
          {query.isFetching ? <p role="status">Checking deployment…</p> : null}
          {!query.isFetching && (query.isError || !report?.deployment) ? (
            <p role="alert">Deployment checks are unavailable. Try again shortly.</p>
          ) : null}
          {report && !query.isFetching ? (
            <div className="space-y-5 text-sm">
              <section aria-label="Project data service">
                <h3 className="font-semibold">Project data service</h3>
                <p>{projectIndexMessage(report.indexer)}</p>
                <p className="text-zinc-500">
                  Project record: {describeProjectDataStatus(report.indexer.project)} Related
                  project records: {describeProjectDataStatus(report.indexer.group)}
                </p>
              </section>
              {report.deployment ? (
                <section aria-label="Onchain deployment">
                  <h3 className="font-semibold">Onchain deployment</h3>
                  <p className="mb-3 text-zinc-500">
                    {report.deployment.checkedBlock
                      ? `Block ${report.deployment.checkedBlock} · `
                      : ""}
                    Checked {report.deployment.checkedAt}
                  </p>
                  {operator ? (
                    <p className="mb-3 break-all text-zinc-500">Operator checked: {operator}</p>
                  ) : null}
                  <ul className="space-y-4">
                    {report.deployment.checks.map((check) => (
                      <li key={check.id} className="border-t border-zinc-200 pt-3">
                        <p className="font-medium">
                          {check.label}{" "}
                          <span className="font-normal text-zinc-500">
                            · {statusLabels[check.status]}
                          </span>
                        </p>
                        <p>{check.message}</p>
                        {check.actual !== undefined || check.expected !== undefined ? (
                          <dl className="mt-1 break-all text-zinc-600">
                            {check.actual !== undefined ? (
                              <div>
                                <dt className="inline">Actual: </dt>
                                <dd className="inline">{check.actual}</dd>
                              </div>
                            ) : null}
                            {check.expected !== undefined ? (
                              <div>
                                <dt className="inline">Expected: </dt>
                                <dd className="inline">{check.expected}</dd>
                              </div>
                            ) : null}
                          </dl>
                        ) : null}
                        {check.action ? <p className="mt-1">{check.action}</p> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <button
              type="button"
              disabled={query.isFetching}
              className="min-h-11 underline disabled:opacity-50"
              onClick={() => {
                setCopyState("idle");
                void query.refetch();
              }}
            >
              Retry checks
            </button>
            <button
              type="button"
              disabled={!report || query.isFetching}
              className="min-h-11 underline disabled:opacity-50"
              onClick={() => void copyDiagnostics()}
            >
              Copy diagnostics
            </button>
            {copyState !== "idle" ? (
              <span role="status">
                {copyState === "copied"
                  ? "Diagnostics copied."
                  : "Could not copy diagnostics. Try again."}
              </span>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </DiagnosticsContext.Provider>
  );
}

export function ProjectDataNotice({ status }: { status: ProjectIndexStatus }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  return (
    <div className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <p>{projectIndexMessage(status)}</p>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          className="min-h-11 underline disabled:opacity-50"
          disabled={pending}
          onClick={() => {
            void Promise.all(
              [
                "bendystraw",
                "complete-participants",
                "complete-activity-events",
                "pending-routing-payments",
              ].map((family) => queryClient.invalidateQueries({ queryKey: [family] })),
            );
            startTransition(() => router.refresh());
          }}
        >
          {pending ? "Retrying…" : "Retry"}
        </button>
        <CheckDeploymentButton />
      </div>
    </div>
  );
}
