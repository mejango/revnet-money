import {
  CheckDeploymentButton,
  ProjectDataNotice,
  ProjectDiagnosticsProvider,
} from "@/app/[slug]/components/ProjectDiagnostics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn(), refresh: vi.fn(), copy: vi.fn() }));
vi.mock("@/lib/projectDiagnostics", () => ({ loadProjectDiagnostics: mocks.load }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
const report = {
  indexer: { project: "unavailable", group: "missing" },
  deployment: {
    version: 6,
    chainId: 1,
    projectId: "45",
    kind: "revnet",
    checkedBlock: "123",
    checkedAt: "2026-10-04T12:00:00.000Z",
    checks: [
      {
        id: "hook-project",
        category: "hook",
        status: "mismatch",
        label: "Hook project",
        message: "The hook belongs to another project.",
        actual: "44",
        expected: "45",
        action: "Use the hook created for this project.",
      },
    ],
  },
};
function mount(notice = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <ProjectDiagnosticsProvider chainId={1} projectId={45n}>
        {notice ? (
          <ProjectDataNotice status={{ project: "unavailable", group: "missing" }} />
        ) : (
          <CheckDeploymentButton />
        )}
      </ProjectDiagnosticsProvider>
    </QueryClientProvider>,
  );
  return { invalidate, client };
}

beforeEach(() => {
  mocks.load.mockReset();
  mocks.refresh.mockReset();
  mocks.copy.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.copy },
  });
});

describe("project diagnostics", () => {
  it("is opt-in, shows loading, and separates onchain findings from data-service failure", async () => {
    let resolve!: (value: typeof report) => void;
    mocks.load.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    mount();
    expect(mocks.load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
    expect(await screen.findByText("Checking deployment…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy diagnostics" })).toBeDisabled();
    resolve(report);
    expect(await screen.findByText("The hook belongs to another project.")).toBeInTheDocument();
    expect(screen.getByText("Needs attention", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("44")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getByText("Use the hook created for this project.")).toBeInTheDocument();
    expect(screen.getByText(/request failed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    expect(await screen.findByText("Diagnostics copied.")).toBeInTheDocument();
    expect(JSON.parse(mocks.copy.mock.calls[0][0])).toMatchObject({
      chainId: 1,
      projectId: "45",
      ...report,
    });
  });

  it("sanitizes errors and can retry checks and copying", async () => {
    mocks.load
      .mockRejectedValueOnce(new Error("https://secret-rpc.invalid/key-secret"))
      .mockResolvedValue(report);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Deployment checks are unavailable");
    expect(document.body.textContent).not.toContain("key-secret");
    fireEvent.click(screen.getByRole("button", { name: "Retry checks" }));
    expect(await screen.findByText("The hook belongs to another project.")).toBeInTheDocument();
    mocks.copy.mockRejectedValueOnce(new Error("clipboard disabled"));
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    expect(await screen.findByText("Could not copy diagnostics. Try again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    expect(await screen.findByText("Diagnostics copied.")).toBeInTheDocument();
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  it("retries the degraded page's server and client data and offers diagnostics", async () => {
    mocks.load.mockResolvedValue(report);
    const { invalidate, client } = mount(true);
    const readKeys = [
      ["bendystraw", "project", 1],
      ["complete-participants", { suckerGroupId: "group" }, 1],
      ["complete-activity-events", { suckerGroupId: "group" }, 1],
      ["pending-routing-payments", "1:45"],
    ];
    for (const key of readKeys) client.setQueryData(key, []);
    expect(screen.queryByText(/hasn't finished indexing/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["bendystraw"] });
    for (const key of readKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
    expect(await screen.findByRole("dialog", { name: "Check deployment" })).toBeInTheDocument();
  });
  it("validates optional operators and only switches the report after an explicit check", async () => {
    mocks.load.mockResolvedValue(report);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
    await screen.findByText("The hook belongs to another project.");
    const input = screen.getByRole("textbox", { name: "Operator address (optional)" });
    fireEvent.change(input, { target: { value: "invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Check operator" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid operator address.");
    expect(mocks.load).toHaveBeenCalledTimes(1);
    const operator = "0x1111111111111111111111111111111111111111";
    fireEvent.change(input, { target: { value: operator } });
    expect(mocks.load).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Check operator" }));
    await waitFor(() => expect(mocks.load).toHaveBeenLastCalledWith(1, 45n, operator));
  });
  it("does not present or copy an earlier report after a retry fails", async () => {
    mocks.load.mockResolvedValueOnce(report).mockRejectedValueOnce(new Error("RPC retry failed"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Check deployment" }));
    await screen.findByText("The hook belongs to another project.");
    fireEvent.click(screen.getByRole("button", { name: "Retry checks" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Deployment checks are unavailable");
    expect(screen.queryByText("The hook belongs to another project.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy diagnostics" })).toBeDisabled();
  });
});
