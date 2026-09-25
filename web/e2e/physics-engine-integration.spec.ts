import { expect, test } from "@playwright/test";

test("physics-engine primitive and CCD evidence is rendered from WASM", async ({ page }) => {
  await page.goto("/explain/");

  const integration = page.getByTestId("physics-engine-integration");
  await expect(integration).toBeVisible();
  await expect(page.getByTestId("physics-engine-specialization-summary")).toHaveText("10 / 10 specialized");

  const ccd = page.getByTestId("physics-engine-ccd");
  await expect(ccd.getByText("Swept contact")).toBeVisible();
  await expect(ccd.getByText("detected")).toBeVisible();
  await expect(ccd.getByText("Projectile retired")).toBeVisible();
  await expect(ccd.getByText("yes")).toBeVisible();
});
