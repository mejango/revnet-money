import { expect, test, type Page } from "@playwright/test";
import {
  expectBoundaryToStayLocal,
  expectContained,
  expectNoBlockingAccessibilityFindings,
  expectSecurityHeaders,
  installBrowserBoundary,
  type BrowserBoundary,
} from "./browser-support";

async function openCreatePage(page: Page): Promise<BrowserBoundary> {
  const boundary = await installBrowserBoundary(page);

  const response = await page.goto("/create", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(response);
  await expect(page.getByRole("heading", { name: "Create a revnet" })).toBeVisible();
  return boundary;
}

test("standalone health endpoint exposes immutable build identity", async ({ request }) => {
  const response = await request.get("/api/healthz");

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.json()).toEqual({
    revision: "browser-test",
    status: "ok",
  });
});

test("production create surface stays visible and contained", async ({ page }) => {
  const boundary = await openCreatePage(page);

  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "1. Look" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "2. Assets" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "3. Terms" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "4. Deploy" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ticker", exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "USDC" }).check();
  await expect(page.getByRole("checkbox", { name: "ETH", exact: true })).toBeChecked();
  await expect(page.getByText("backed by both ETH and USDC", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Add stage" }).click();
  const issuanceAmount = page.locator("#initialIssuance");
  const issuanceCurrency = page.getByRole("combobox", { name: "Issuance currency" });
  await issuanceAmount.fill("1000000");
  await expect(issuanceCurrency).toHaveValue("ETH");
  const amountBox = await issuanceAmount.boundingBox();
  const suffixBox = await issuanceCurrency.locator("xpath=../..").boundingBox();
  expect(amountBox).not.toBeNull();
  expect(suffixBox).not.toBeNull();
  expect(amountBox!.x + amountBox!.width).toBeLessThanOrEqual(suffixBox!.x + 0.5);
  await issuanceCurrency.selectOption("USD");
  await expect(issuanceCurrency).toHaveValue("USD");
  await page.getByRole("checkbox", { name: "add automatic cuts?" }).check();
  const dialogBox = await page.getByRole("dialog").boundingBox();
  const enabledSuffixBox = await issuanceCurrency.boundingBox();
  const cutLabelBox = await page.locator('label[for="uiCutPercentage"]').boundingBox();
  const cutToggleBox = await page.locator("#enableCut").boundingBox();
  const cutPercentageBox = await page.locator("#uiCutPercentage").boundingBox();
  const cutFrequencyBox = await page.locator("#uiCutFrequency").boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(enabledSuffixBox).not.toBeNull();
  expect(cutLabelBox).not.toBeNull();
  expect(cutToggleBox).not.toBeNull();
  expect(cutPercentageBox).not.toBeNull();
  expect(cutFrequencyBox).not.toBeNull();
  expect(cutLabelBox!.y).toBeGreaterThanOrEqual(enabledSuffixBox!.y + enabledSuffixBox!.height);
  expect(cutPercentageBox!.x - (cutToggleBox!.x + cutToggleBox!.width)).toBeGreaterThanOrEqual(7);
  expect(cutFrequencyBox!.x + cutFrequencyBox!.width).toBeLessThanOrEqual(
    dialogBox!.x + dialogBox!.width - 8,
  );
  await page.getByRole("button", { name: "add split +" }).click();
  await page.locator("#splits\\.0\\.percentage").fill("10");
  await page.getByRole("button", { name: "add split +" }).click();
  await page.locator("#splits\\.1\\.percentage").fill("10");
  const splitPercentageBoxes = await page
    .locator('[id^="splits."][id$=".percentage"]')
    .evaluateAll((fields) => fields.map((field) => field.getBoundingClientRect().width));
  expect(splitPercentageBoxes).toHaveLength(2);
  expect(splitPercentageBoxes.every((width) => width >= 80)).toBe(true);
  await page.keyboard.press("Escape");

  await page.getByRole("checkbox", { name: "Custom token" }).check();
  await expect(page.getByRole("textbox", { name: "ERC-20 token address" })).toBeVisible();
  await expect(page.getByText("A custom reserve is exclusive.", { exact: false })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "ETH", exact: true })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "USDC" })).not.toBeChecked();
  await expect(page.locator('a[href*="/undefined/"]')).toHaveCount(0);

  await expectContained(page, ["nav", "main", "footer", "h1", "#name", "#tokenSymbol"]);
  await page.waitForTimeout(250);
  expectBoundaryToStayLocal(boundary);
});

test("create form remains keyboard-usable and free of severe accessibility regressions", async ({
  page,
}) => {
  const boundary = await openCreatePage(page);
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  const ticker = page.getByRole("textbox", { name: "Ticker", exact: true });

  await name.focus();
  await page.keyboard.type("Keyboard Revnet");
  await expect(name).toHaveValue("Keyboard Revnet");
  await page.keyboard.press("Tab");
  await expect(ticker).toBeFocused();
  await page.keyboard.type("KEYS");
  await expect(ticker).toHaveValue("KEYS");

  await expectNoBlockingAccessibilityFindings(page);
  await page.waitForTimeout(250);
  expectBoundaryToStayLocal(boundary);
});
