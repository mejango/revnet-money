import { expect, test } from "@playwright/test";
import { installBrowserBoundary } from "./browser-support";

// The 404's home link is a plain anchor (next/link there put the home bundle on every route), so
// it goes home with a full document load.
test("the 404 page's Return Home link loads the home page", async ({ page }) => {
  await installBrowserBoundary(page);
  const response = await page.goto("/no-such-page/x/y", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Revnet Not Found" })).toBeVisible();
  await page.getByRole("button", { name: "Return Home" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/u);
  await expect(page.getByRole("region", { name: "Markee advertisement" })).toBeVisible();
});
