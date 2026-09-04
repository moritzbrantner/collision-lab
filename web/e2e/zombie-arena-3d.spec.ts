import { expect, test, type Page } from "@playwright/test";

const ARENA_NAME = "Third-person 3D Zombie Arena";

async function frameNumber(page: Page) {
  const text = await page.getByText(/fixed dt .* frame \d+/).textContent();
  const match = text?.match(/frame (\d+)/);
  if (!match) throw new Error(`Could not read arena frame from: ${text ?? "<missing>"}`);
  return Number(match[1]);
}

async function expectCaptured(page: Page) {
  const arena = page.getByRole("application", { name: ARENA_NAME });
  await expect.poll(() => arena.evaluate((element) => document.pointerLockElement === element)).toBe(true);
  await expect.poll(() => arena.evaluate((element) => document.fullscreenElement === element)).toBe(true);
}

async function escapeToMenu(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Paused" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement === null)).toBe(true);
}

async function startArena(page: Page) {
  await page.goto("/scenarios/zombie-arena-3d/");
  const arena = page.getByRole("application", { name: ARENA_NAME });
  await expect(arena).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ready to play" })).toBeVisible();

  const readyMenu = page.getByRole("heading", { name: "Ready to play" }).locator("..");
  await readyMenu.getByRole("button", { name: "Play fullscreen" }).click();
  await expectCaptured(page);
  await expect.poll(() => frameNumber(page)).toBeGreaterThan(5);
  return arena;
}

test("Zombie Arena captures mouse-look, pauses on Escape, and resumes", async ({ page }) => {
  const arena = await startArena(page);
  const canvas = arena.locator("canvas");
  await expect(canvas).toBeVisible();
  const beforeLook = await canvas.screenshot();

  await arena.evaluate((element) => {
    const event = new PointerEvent("pointermove", { bubbles: true });
    Object.defineProperty(event, "movementX", { value: 96 });
    Object.defineProperty(event, "movementY", { value: 0 });
    element.dispatchEvent(event);
  });

  await page.waitForTimeout(100);
  const afterLook = await canvas.screenshot();
  expect(afterLook.equals(beforeLook)).toBe(false);
  await expectCaptured(page);

  await escapeToMenu(page);
  const pausedFrame = await frameNumber(page);
  await page.waitForTimeout(120);
  expect(await frameNumber(page)).toBe(pausedFrame);

  const pausedMenu = page.getByRole("heading", { name: "Paused" }).locator("..");
  await pausedMenu.getByRole("button", { name: "Resume" }).click();
  await expectCaptured(page);
  await expect.poll(() => frameNumber(page)).toBeGreaterThan(pausedFrame);

  await escapeToMenu(page);
  const finalMenu = page.getByRole("heading", { name: "Paused" }).locator("..");
  await finalMenu.getByRole("button", { name: "Back to explanations" }).click();
  await expect(page.getByRole("heading", { name: "Third-person shooting with dynamic A* navigation." })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
});

test("Zombie Arena Restart resets the deterministic run", async ({ page }) => {
  await startArena(page);
  await expect.poll(() => frameNumber(page)).toBeGreaterThan(25);
  const beforeRestart = await frameNumber(page);

  await escapeToMenu(page);
  const restartMenu = page.getByRole("heading", { name: "Paused" }).locator("..");
  await restartMenu.getByRole("button", { name: "Restart" }).click();

  await expect.poll(() => frameNumber(page)).toBeLessThan(beforeRestart);
  await expect.poll(() => frameNumber(page)).toBeLessThan(10);
});
