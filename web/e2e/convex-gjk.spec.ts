import { expect, test } from "@playwright/test";

test("convex lesson uses the Rust GJK trace for collision truth", async ({ page }) => {
  await page.goto("/convex/");

  const workbench = page.locator("section").filter({ hasText: "Rust-owned GJK trace" });
  await expect(workbench.getByText("authoritative support query")).toBeVisible();
  await expect(workbench.getByText("Witness points")).toBeVisible();
  await expect(workbench.getByText("terminal status")).toBeVisible();
  await expect(
    workbench.getByText(/^Rust · (intersecting|separated|no-progress|iteration-limit)$/),
  ).toBeVisible({ timeout: 15_000 });

  const moveX = workbench.getByLabel(/Move B · X/);
  await moveX.press("Home");
  await expect(workbench.getByText("Collision", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(workbench.getByText("Rust · intersecting")).toBeVisible();

  await moveX.press("End");
  await expect(workbench.getByText("Separated", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(workbench.getByText("Rust · separated")).toBeVisible();
});
