import { expect, test } from "@playwright/test";
import protocolRollout from "../../src/lib/protocol-rollout.json";
import {
  expectBoundaryToStayLocal,
  expectContained,
  expectSecurityHeaders,
  FIXTURE_ORIGIN,
  installBrowserBoundary,
} from "./browser-support";

test("pending routing shows ready, cooldown, and final attempts above activity", async ({
  page,
  request,
}, testInfo) => {
  const boundary = await installBrowserBoundary(page);
  const fixture = await request.get(`${FIXTURE_ORIGIN}/__fixture/pending-routing`);
  expect(fixture.status()).toBe(200);
  const pending = await fixture.json();
  let pendingReads = 0;
  await page.route("**/api/bendystraw/mainnet/query", async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation !== "router-pending-calls.v1") {
      await route.fallback();
      return;
    }
    expect(body.variables).toEqual({
      chainId: 1,
      sourceProjectId: 1,
      gateway: protocolRollout.chains["1"].contracts.JBRouterTerminalGateway.toLowerCase(),
      limit: 100,
      offset: 0,
    });
    pendingReads += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pending),
    });
  });
  expectSecurityHeaders(await page.goto("/eth:1", { waitUntil: "domcontentloaded" }));
  const section = page.getByRole("region", { name: "Payments awaiting routing" });
  await expect(section).toBeVisible();
  await expect(section.getByText("0.01 ETH", { exact: true })).toBeVisible();
  await expect(section.getByText("12.5 USDC", { exact: true })).toBeVisible();
  await expect(section.getByText("0.03 ETH", { exact: true })).toBeVisible();
  await expect(section.getByText(/Available after/)).toHaveCount(1);
  await expect(
    section.getByText("Includes 2 ready payments. Payments in cooldown must wait."),
  ).toBeVisible();

  // Browser builds deliberately have no wallet connectors. These are the real
  // action controls with their wallet gate; the cooldown still disables its row.
  const actions = section.getByRole("button", { name: "Connect Wallet", exact: true });
  await expect(actions).toHaveCount(4);
  await expect(actions.nth(0)).toBeEnabled();
  await expect(actions.nth(1)).toBeDisabled();
  await expect(actions.nth(2)).toBeEnabled();
  await expect(actions.nth(3)).toBeEnabled();
  const latest = page.getByRole("heading", { name: "Latest", exact: true });
  await expect(latest).toBeVisible();
  const [pendingBox, latestBox] = await Promise.all([section.boundingBox(), latest.boundingBox()]);
  expect(pendingBox).not.toBeNull();
  expect(latestBox).not.toBeNull();
  expect(pendingBox!.y + pendingBox!.height).toBeLessThanOrEqual(latestBox!.y);
  await expectContained(page, ["main", "section[aria-labelledby='pending-routing-heading']"]);

  const statusResponse = await request.get(`${FIXTURE_ORIGIN}/__fixture/status`);
  const status = await statusResponse.json();
  expect(pendingReads).toBeGreaterThan(0);
  for (const name of [
    "pendingCallCommitmentOf",
    "pendingCallFailureOf",
    "RETRY_DELAY",
    "maximumQualifiedCallGas",
  ]) {
    expect(
      status.contractFunctions[name],
      `${name} must use the real RPC read path`,
    ).toBeGreaterThan(0);
  }
  expect(status.rpcMethods.eth_getBlockByNumber).toBeGreaterThan(0);
  expect(status.unknownRequests).toEqual([]);
  expectBoundaryToStayLocal(boundary);

  const screenshot = testInfo.outputPath("pending-routing-above-activity.png");
  await section.locator("..").screenshot({ path: screenshot });
  await testInfo.attach("Pending routing above activity", {
    path: screenshot,
    contentType: "image/png",
  });
});
