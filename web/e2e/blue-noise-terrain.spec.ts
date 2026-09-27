import { expect, test, type Locator } from "@playwright/test";

test("blue-noise terrain exposes deterministic mesh contact and regeneration", async ({ page }) => {
  await page.goto("/scenarios/blue-noise-terrain/?seed=73");

  const scenario = page.getByRole("application", {
    name: "Blue-noise triangle terrain collision scenario",
  });
  await expect(scenario).toBeVisible();
  await expect(page.getByText(/8,192 triangles · 84 sites/)).toBeVisible();
  await expect(page.getByText(/Rust triangle \d+ · grounded/)).toBeVisible();

  const initialTriangle = await activeTriangle(page.getByText(/8,192 triangles · 84 sites/));
  await page.keyboard.down("d");
  await page.waitForTimeout(600);
  await page.keyboard.up("d");
  await expect
    .poll(() => activeTriangle(page.getByText(/8,192 triangles · 84 sites/)))
    .not.toBe(initialTriangle);

  await page.keyboard.press("Space");
  await expect(page.getByText(/Rust triangle \d+ · airborne/)).toBeVisible();

  await page.getByLabel("Terrain seed").fill("91");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page).toHaveURL(/seed=91/);
  await page.getByText("Deterministic generation evidence").click();
  await expect(page.getByText(/minimum wrapped site spacing/)).toBeVisible();
});

async function activeTriangle(locator: Locator) {
  const text = await locator.textContent();
  const match = text?.match(/active triangle (\d+)/);
  if (!match) throw new Error(`Could not read active terrain triangle from: ${text ?? "<missing>"}`);
  return Number(match[1]);
}
