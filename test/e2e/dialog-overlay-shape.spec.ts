import { expect, test } from "@playwright/test";
import { expectSecurityHeaders, installBrowserBoundary } from "./browser-support";

/**
 * jsdom implements neither `inert` nor its semantics, so this is the only place
 * the freeze is provable: a real browser refuses to deliver clicks inside an
 * inert subtree. The shape mirrors production, where the transaction review
 * renders as a body child above the dialog that started the transaction while
 * that dialog's parent keeps re-rendering.
 */
test("an open dialog never freezes a body-level overlay above it", async ({ page }) => {
  await installBrowserBoundary(page);
  const response = await page.goto("/create", { waitUntil: "domcontentloaded" });
  expectSecurityHeaders(response);
  await expect(page.getByRole("heading", { name: "Create a revnet" })).toBeVisible();

  await page.getByRole("button", { name: "Add stage" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.evaluate(() => {
    const overlay = document.createElement("div");
    overlay.id = "review-probe";
    overlay.style.cssText = "position:fixed;top:8px;left:8px;z-index:1000";
    const button = document.createElement("button");
    button.id = "review-probe-button";
    button.textContent = "Agree and continue";
    button.addEventListener("click", () => {
      button.dataset.clicked = "true";
    });
    overlay.appendChild(button);
    document.body.appendChild(overlay);
  });

  // Both controls are backed by state owned by the component that renders the
  // dialog, so every keystroke re-renders it with fresh inline callbacks —
  // the same churn the payment card produces while quoting.
  await page.getByRole("checkbox", { name: "add automatic cuts?" }).check();
  const cutPercentage = page.locator("#uiCutPercentage");
  await cutPercentage.click();
  await page.keyboard.type("12345");

  await expect(page.locator("#review-probe")).not.toHaveAttribute("inert", /.*/);
  const probe = page.locator("#review-probe-button");
  await probe.click();
  await expect(probe).toHaveAttribute("data-clicked", "true");

  // The same churn must not yank focus back into the dialog's first control.
  await cutPercentage.click();
  await page.keyboard.type("7");
  await expect(cutPercentage).toBeFocused();

  await page.evaluate(() => document.getElementById("review-probe")?.remove());
});
