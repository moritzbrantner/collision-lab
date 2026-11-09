import { expect, test } from "@playwright/test";

test("authored triangle BVH teaches work counts and reference parity across inputs", async ({ page }) => {
  await page.goto("/explain/");
  const lesson = page.getByTestId("authored-mesh-bvh-lesson");
  await expect(lesson.getByText("Reference parity verified")).toBeVisible();
  await expect(lesson.getByText("168 tests")).toBeVisible();
  await expect(lesson.getByText("Traversal step 1", { exact: false })).toBeVisible();

  await lesson.getByRole("button", { name: "Next" }).click();
  await expect(lesson.getByText("Traversal step 2", { exact: false })).toBeVisible();

  const origin = lesson.getByRole("slider", { name: "Move the query origin along the cave" });
  await origin.focus();
  await origin.press("End");
  await expect(lesson.getByText("Reference parity verified")).toBeVisible();

  await lesson.getByRole("button", { name: "Capsule sweep" }).click();
  await expect(lesson.getByText("kernel exposes aggregate", { exact: false })).toBeVisible();
  await expect(lesson.getByText("Reference parity verified")).toBeVisible();
});
