import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  expectBoundaryToStayLocal,
  expectContained,
  expectNoBlockingAccessibilityFindings,
  expectSecurityHeaders,
  FIXTURE_ORIGIN,
  installBrowserBoundary,
  type BrowserBoundary,
} from "./browser-support";

type FixtureStatus = {
  graphqlOperations: Record<string, number>;
  rpcMethods: Record<string, number>;
  contractFunctions: Record<string, number>;
  multicallBatches: number;
  unknownRequests: Array<{ kind: string; detail: string }>;
};

async function fixtureStatus(request: APIRequestContext): Promise<FixtureStatus> {
  const response = await request.get(`${FIXTURE_ORIGIN}/__fixture/status`);
  expect(response.status()).toBe(200);
  return response.json() as Promise<FixtureStatus>;
}

async function openFixtureProject(page: Page): Promise<BrowserBoundary> {
  const boundary = await installBrowserBoundary(page);
  const response = await page.goto("/eth:1", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(response);

  await expect(page.getByRole("heading", { level: 1, name: "Fixture Revnet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "FREV", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "$1,250.00 balance" })).toBeVisible();
  await expect(page.getByText("2 owners", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Amount")).toBeEnabled();
  await expect(page.getByLabel("Payment mode")).toHaveValue("pay");
  await expect(page.getByText("USDC", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Ethereum", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay", exact: true })).toBeDisabled();
  return boundary;
}

test("fixture project renders its contract-hydrated production shape", async ({
  page,
  request,
}) => {
  const boundary = await openFixtureProject(page);

  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Terms" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Owners", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.getByText("No activity yet")).toBeVisible();

  const about = page.getByRole("heading", { name: "About", exact: true });
  const viewport = page.viewportSize();
  if ((viewport?.width ?? 0) <= 600) {
    await expect(about).toBeHidden();
    await page.getByRole("link", { name: "Overview" }).click();
  }
  await expect(about).toBeVisible();
  await expect(
    page.getByText(
      "A deterministic, contract-hydrated revnet used to protect the production project shape.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Other info" })).toBeVisible();
  await expect(page.getByRole("link", { name: "#1" })).toBeVisible();

  await expectContained(page, [
    "nav",
    "header",
    ...((viewport?.width ?? 0) > 600 ? ["aside"] : []),
    "main",
    "h1",
    "input[aria-label='Amount']",
  ]);

  await expect
    .poll(async () => {
      const status = await fixtureStatus(request);
      return (
        (status.graphqlOperations.Project ?? 0) > 0 &&
        (status.graphqlOperations.SuckerGroup ?? 0) > 0 &&
        (status.graphqlOperations.Participants ?? 0) > 0 &&
        (status.contractFunctions.currentRulesetOf ?? 0) > 0 &&
        (status.contractFunctions.accountingContextsOf ?? 0) > 0 &&
        (status.contractFunctions.tokenOf ?? 0) > 0 &&
        (status.contractFunctions.symbol ?? 0) > 0 &&
        status.multicallBatches > 0
      );
    })
    .toBe(true);
  const status = await fixtureStatus(request);
  expect(status.unknownRequests).toEqual([]);
  expect(status.graphqlOperations.Project).toBeGreaterThan(0);
  expect(status.graphqlOperations.SuckerGroup).toBeGreaterThan(0);
  expect(status.graphqlOperations.Participants).toBeGreaterThan(0);
  expect(status.contractFunctions.currentRulesetOf).toBeGreaterThan(0);
  expect(status.contractFunctions.accountingContextsOf).toBeGreaterThan(0);
  expect(status.contractFunctions.tokenOf).toBeGreaterThan(0);
  expect(status.contractFunctions.symbol).toBeGreaterThan(0);
  expect(status.multicallBatches).toBeGreaterThan(0);

  await page.waitForTimeout(250);
  expectBoundaryToStayLocal(boundary);
});

test("fixture project remains keyboard-usable and accessible", async ({ page, request }) => {
  const boundary = await openFixtureProject(page);
  const amount = page.getByLabel("Amount");

  await amount.focus();
  await page.keyboard.type("0");
  await expect(amount).toHaveValue("0");
  await page.keyboard.press("Tab");
  await expect(page.getByPlaceholder("Add a note")).toBeFocused();

  await expectNoBlockingAccessibilityFindings(page);
  const status = await fixtureStatus(request);
  expect(status.unknownRequests).toEqual([]);
  await page.waitForTimeout(250);
  expectBoundaryToStayLocal(boundary);
});

test("project terms stay contract-backed, contained, and accessible", async ({ page, request }) => {
  const boundary = await openFixtureProject(page);

  await page.getByRole("link", { name: "Terms" }).click();
  await expect(page).toHaveURL(/\/eth:1\/terms$/);
  await expect(page.getByRole("heading", { name: "Token issuance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stages" })).toBeVisible();
  await expectContained(page, ["nav", "main"]);
  await expectNoBlockingAccessibilityFindings(page);

  await expect
    .poll(async () => (await fixtureStatus(request)).contractFunctions.allOf ?? 0)
    .toBeGreaterThan(0);
  const status = await fixtureStatus(request);
  expect(status.unknownRequests).toEqual([]);
  await page.waitForTimeout(250);
  expectBoundaryToStayLocal(boundary);
});

test("secondary project surfaces stay hydrated, contained, and accessible", async ({
  page,
  request,
}) => {
  const boundary = await installBrowserBoundary(page);

  const ownersResponse = await page.goto("/eth:1/owners", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(ownersResponse);
  await expect(page.getByRole("heading", { level: 1, name: "Fixture Revnet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Token", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accounts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "You", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "All", exact: true })).toBeVisible();
  await expectContained(page, ["nav", "main"]);
  await expectNoBlockingAccessibilityFindings(page);

  const shopResponse = await page.goto("/eth:1/shop", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(shopResponse);
  await expect(page.getByText("This project has no shop.")).toBeVisible();
  await expectContained(page, ["nav", "main"]);

  const extrasResponse = await page.goto("/eth:1/extras", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(extrasResponse);
  await expect(page.getByRole("heading", { name: "Payer address", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create payer address" })).toBeVisible();
  await expect(page.getByText("No deployed payer addresses indexed yet.")).toBeVisible();
  await expectContained(page, ["nav", "main"]);

  const operatorResponse = await page.goto("/eth:1/operator", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(operatorResponse);
  for (const heading of ["Account", "Edits", "Buyback & swap router", "Permissions"]) {
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByText("No operator permissions found.")).toBeVisible();
  await expectContained(page, ["nav", "main"]);
  await expectNoBlockingAccessibilityFindings(page);

  const status = await fixtureStatus(request);
  expect(status.unknownRequests).toEqual([]);
  expect(status.graphqlOperations.V6ProjectPayers).toBeGreaterThan(0);
  expect(status.graphqlOperations.V6PermissionHolders).toBeGreaterThan(0);
  expect(status.contractFunctions.ownerOf).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  expectBoundaryToStayLocal(boundary);
});

test("home and discover shells stay contained and deterministic", async ({ page, request }) => {
  const boundary = await installBrowserBoundary(page);

  const homeResponse = await page.goto("/", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(homeResponse);
  await expect(page.getByText("A business model for the open web. 100% autonomous.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Create yours" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Fixture Revnet/ })).toBeVisible();
  await expect(page.getByText("$1,250", { exact: true })).toBeVisible();
  await expectContained(page, ["main", "footer"]);
  await expectNoBlockingAccessibilityFindings(page);

  const discoverResponse = await page.goto("/discover", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(discoverResponse);
  await expect(page.getByRole("heading", { name: "Funding opportunities" })).toBeVisible();
  await expect(page.getByText("Tokenize revenues and fundraises. 100% autonomous.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Fixture Revnet/ })).toBeVisible();
  await expect(page.getByText("Protocol-backed and deterministic.")).toBeVisible();
  await expectContained(page, ["main", "footer", "h2"]);
  await expectNoBlockingAccessibilityFindings(page);

  await expect
    .poll(async () => (await fixtureStatus(request)).graphqlOperations.Projects ?? 0)
    .toBeGreaterThan(0);
  const status = await fixtureStatus(request);
  expect(status.unknownRequests).toEqual([]);
  await page.waitForTimeout(250);
  expectBoundaryToStayLocal(boundary);
});
