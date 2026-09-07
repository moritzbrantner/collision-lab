import { expect, test } from "@playwright/test";

test("closest-point primitive lesson switches Rust-backed relations", async ({ page }) => {
  await page.goto("/explain/");

  const lesson = page.locator("section").filter({
    hasText: "Capsules reduce curved collision to a segment-distance problem.",
  });

  await expect(lesson.getByText("Closest distance")).toBeVisible();
  await expect(lesson.getByText("Signed separation")).toBeVisible();

  await lesson.getByRole("button", { name: "Sphere ↔ capsule" }).click();
  await expect(lesson.getByText("Capsule parameter t")).toBeVisible();

  await lesson.getByRole("button", { name: "Capsule ↔ capsule" }).click();
  await expect(lesson.getByText("Left parameter t")).toBeVisible();
  await expect(lesson.getByText("Right parameter u")).toBeVisible();

  await lesson.getByLabel("Rotate B").fill("80");
  await expect(lesson.getByText("Right parameter u")).toBeVisible();
  await expect(
    lesson.getByText("Closest-point solving and overlap semantics remain in `geometry-kernels`."),
  ).toBeVisible();
});
