import { expect, test } from "@playwright/test";

test("physics-engine primitive and CCD evidence is rendered from WASM", async ({
  page,
}) => {
  await page.goto("/explain/");

  const integration = page.getByTestId("physics-engine-integration");
  await expect(integration).toBeVisible();
  await expect(
    page.getByTestId("physics-engine-specialization-summary"),
  ).toHaveText("10 / 10 specialized");

  const ccd = page.getByTestId("physics-engine-ccd");
  await expect(ccd.getByText("Swept contact", { exact: true })).toBeVisible();
  await expect(ccd.getByText("detected")).toBeVisible();
  await expect(
    ccd.getByText("Projectile retired", { exact: true }),
  ).toBeVisible();
  await expect(ccd.getByText("yes")).toBeVisible();
});

test("engine capabilities keep dispatch evidence separate from reference acceptance", async ({
  page,
}) => {
  await page.goto("/explain/?physics-lang=en&physics-theme=light");
  const ledger = page.getByTestId("physics-engine-capabilities");
  await expect(ledger).toBeVisible();
  await expect(
    page.getByTestId("physics-engine-reference-acceptance"),
  ).toHaveText("partial");
  const wedge = ledger
    .getByRole("row")
    .filter({
      has: page.getByRole("rowheader", { name: "wedge", exact: true }),
    });
  await expect(wedge).toContainText("rotation-locked");
  await expect(wedge).toContainText("bounding-box-origin");
  const capabilities = page.getByTestId("physics-engine-capability-states");
  await expect(
    capabilities.getByRole("row").filter({ hasText: "rotationCcd" }),
  ).toContainText("unsupported");
  await expect(
    capabilities.getByRole("row").filter({ hasText: "shapeCastFeatures" }),
  ).toContainText("missing");
  await expect(
    capabilities
      .getByRole("row")
      .filter({ hasText: "chronologicalImpactResponse" }),
  ).toContainText("missing");
  const pairs = page.getByTestId("physics-engine-pair-capabilities");
  await expect(pairs.locator("tbody tr")).toHaveCount(10);
  await expect(
    pairs.locator("tbody tr").filter({ hasText: "capsule-row" }),
  ).toHaveCount(3);
  await expect(
    ledger.getByRole("link", { name: "e0c6be73c9" }),
  ).toHaveAttribute("href", /e0c6be73c9b34efd09220696a4151016b822b5e0/);
  const sphereCapsule = pairs
    .getByRole("row")
    .filter({ hasText: "sphere ↔ capsule" });
  await expect(
    sphereCapsule.getByTestId("physics-engine-segment-distances"),
  ).not.toHaveText("0");
  await expect(
    sphereCapsule.getByTestId("physics-engine-segment-features"),
  ).not.toHaveText("0");
});

test("capability language and appearance survive sharing, reload, and touch layouts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/explain/?physics-lang=de&physics-theme=dark");
  const ledger = page.getByTestId("physics-engine-capabilities");
  await expect(
    ledger.getByRole("heading", { name: "Fähigkeiten der Physics Engine" }),
  ).toBeVisible();
  await expect(ledger).toHaveAttribute("data-theme", "dark");
  await ledger
    .getByRole("combobox", { name: "Sprache", exact: true })
    .selectOption("es");
  await ledger
    .getByRole("combobox", { name: "Apariencia", exact: true })
    .selectOption("light");
  await expect(page).toHaveURL(/physics-lang=es&physics-theme=light/);
  await page.reload();
  await expect(
    ledger.getByRole("heading", { name: "Capacidades de Physics Engine" }),
  ).toBeVisible();
  await expect(ledger).toHaveAttribute("data-theme", "light");
  await expect(ledger).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.goto("/explain/");
  await expect(ledger).toHaveAttribute("lang", "es");
  await ledger
    .getByRole("combobox", { name: "Apariencia", exact: true })
    .selectOption("system");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(ledger).toHaveCSS("background-color", "rgb(9, 9, 11)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(ledger).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.goto(
    "/explain/?physics-lang=unsupported&physics-theme=unsupported",
  );
  await expect(
    ledger.getByRole("heading", { name: "Physics Engine capability ledger" }),
  ).toBeVisible();
  const language = ledger.getByRole("combobox", {
    name: "Language",
    exact: true,
  });
  await language.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(ledger).toHaveAttribute("lang", "de");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
