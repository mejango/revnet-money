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
  // Settlement (chains + reserve asset) comes before every chain-dependent
  // section, so each one can specialize per selected chain at the point of
  // input. "Look" carries no chain-dependent field, so it leads.
  const sectionHeadings = page.getByRole("heading", { level: 2 });
  await expect(sectionHeadings).toHaveText(["1. Look", "2. Settlement", "3. Terms", "4. Deploy"]);
  await expect(page.getByRole("combobox", { name: "Deployment environment" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Ethereum", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ticker", exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "USDC" }).check();
  await expect(page.getByRole("checkbox", { name: "ETH", exact: true })).toBeChecked();
  await expect(page.getByText("backed by both ETH and USDC", { exact: false })).toBeVisible();

  // The issuance denomination is one global value edited at its point of use:
  // inline in the stage's issuance row, not in a standalone block.
  await expect(page.getByRole("combobox", { name: "Issuance currency" })).toHaveCount(0);

  await page.getByRole("button", { name: "Add stage" }).click();
  const stageDialog = page.getByRole("dialog");
  await expect(stageDialog).toBeVisible();
  const issuanceAmount = page.locator("#initialIssuance");
  const issuanceSuffix = page.locator("#initialIssuance + span");
  const issuanceCurrency = issuanceSuffix.getByRole("combobox", { name: "Issuance currency" });
  await expect(issuanceCurrency).toHaveCount(1);
  await expect(issuanceCurrency).toHaveValue("ETH");
  await expect(issuanceCurrency.locator("option")).toHaveText(["ETH", "USD"]);
  await issuanceCurrency.selectOption("USD");
  await expect(issuanceCurrency).toHaveValue("USD");

  // The caret is a background image the option text has to clear. Padding
  // narrower than the caret occupies draws one on top of the other.
  const caret = await issuanceCurrency.evaluate((element: HTMLSelectElement) => {
    const styles = getComputedStyle(element);
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = `${styles.fontStyle} ${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
    // `background-position` computes to `calc(100% - Npx) 50%` when the caret
    // is inset from the right edge, and to `100% 50%` when it is flush.
    const inset = Number.parseFloat(/-\s*([\d.]+)px/.exec(styles.backgroundPosition)?.[1] ?? "0");
    return {
      reserved: Number.parseFloat(styles.backgroundSize) + inset,
      paddingRight: Number.parseFloat(styles.paddingRight),
      textWidth: context.measureText(element.options[element.selectedIndex].text).width,
      contentWidth:
        element.getBoundingClientRect().width -
        Number.parseFloat(styles.paddingLeft) -
        Number.parseFloat(styles.paddingRight),
    };
  });
  expect(caret.reserved).toBeGreaterThan(0);
  expect(caret.paddingRight).toBeGreaterThanOrEqual(caret.reserved);
  expect(caret.textWidth).toBeLessThanOrEqual(caret.contentWidth);

  await issuanceAmount.fill("1000000");
  const amountBox = await issuanceAmount.boundingBox();
  const suffixBox = await issuanceSuffix.boundingBox();
  expect(amountBox).not.toBeNull();
  expect(suffixBox).not.toBeNull();
  expect(amountBox!.x + amountBox!.width).toBeLessThanOrEqual(suffixBox!.x + 0.5);
  await page.getByRole("checkbox", { name: "add automatic cuts?" }).check();
  const dialogBox = await page.getByRole("dialog").boundingBox();
  const enabledSuffixBox = await issuanceSuffix.boundingBox();
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

test("only the first stage offers the issuance denomination; later stages quote it", async ({
  page,
}) => {
  const boundary = await openCreatePage(page);

  // The first stage owns the one global denomination.
  await page.getByRole("button", { name: "Add stage" }).click();
  const firstStage = page.getByRole("dialog");
  await firstStage.getByRole("combobox", { name: "Issuance currency" }).selectOption("USD");
  await firstStage.getByRole("button", { name: "Save stage" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // A second stage quotes it as text: no control, no disabled control.
  await page.getByRole("button", { name: "Add stage" }).click();
  const laterStage = page.getByRole("dialog");
  await expect(laterStage).toBeVisible();
  await expect(laterStage.getByRole("combobox", { name: "Issuance currency" })).toHaveCount(0);
  await expect(laterStage.locator("select")).toHaveCount(0);
  const laterSuffix = laterStage.locator("#initialIssuance + span");
  await expect(laterSuffix).toHaveText(/\/\s*USD/);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  expectBoundaryToStayLocal(boundary);
});

test("the first stage card starts level with the Terms heading", async ({ page }) => {
  const boundary = await openCreatePage(page);

  await page.getByRole("button", { name: "Add stage" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save stage" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const heading = page.getByRole("heading", { name: "3. Terms" });
  const firstCard = page.getByText("Stage 1", { exact: true });
  const headingBox = (await heading.boundingBox())!;
  const cardBox = (await firstCard.boundingBox())!;
  expect(headingBox).not.toBeNull();
  expect(cardBox).not.toBeNull();

  // Two columns only above the md breakpoint; below it they stack and there is
  // nothing to line up with.
  if (cardBox.x > headingBox.x + headingBox.width) {
    // Leading padding on the card would drop it a line below the heading.
    expect(Math.abs(cardBox.y - headingBox.y)).toBeLessThanOrEqual(8);
  }

  await page.waitForTimeout(250);
  expectBoundaryToStayLocal(boundary);
});

test("environment flip swaps the chain list and prunes hidden-environment picks", async ({
  page,
}) => {
  const boundary = await openCreatePage(page);
  const environment = page.getByRole("combobox", { name: "Deployment environment" });

  await page.getByRole("checkbox", { name: "Ethereum", exact: true }).check();
  await expect(page.getByRole("checkbox", { name: "Ethereum", exact: true })).toBeChecked();

  await environment.click();
  await page.getByRole("option", { name: "Testnets" }).click();
  await expect(page.getByRole("checkbox", { name: "Ethereum", exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Sepolia", exact: true })).toBeVisible();

  // The hidden environment's pick was dropped, not silently kept.
  await environment.click();
  await page.getByRole("option", { name: "Production" }).click();
  await expect(page.getByRole("checkbox", { name: "Ethereum", exact: true })).not.toBeChecked();

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
