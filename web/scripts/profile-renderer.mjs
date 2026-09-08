import { spawn } from "node:child_process";
import process from "node:process";

import { chromium } from "@playwright/test";

const renderer = process.argv[2];
if (renderer !== "three" && renderer !== "wgpu") {
  throw new Error("renderer argument must be 'three' or 'wgpu'");
}

const frames = boundedInteger(process.env.RENDERER_PROFILE_FRAMES, 180, 30, 1200);
const objects = boundedInteger(process.env.RENDERER_PROFILE_OBJECTS, 1000, 40, 5000);
const port = boundedInteger(process.env.RENDERER_PROFILE_PORT, 4174, 1024, 65535);
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  "python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", "out"],
  { stdio: "ignore" },
);

let browser;
try {
  await waitForServer(`${origin}/renderers/`);
  const softwareCi = process.env.CI === "true";
  browser = await chromium.launch({
    headless: !softwareCi,
    args: softwareCi
      ? [
          "--enable-unsafe-webgpu",
          "--enable-unsafe-swiftshader",
          "--ignore-gpu-blocklist",
          "--enable-gpu",
          "--enable-features=Vulkan",
          "--use-angle=swiftshader",
          "--use-vulkan=swiftshader",
          "--use-webgpu-adapter=swiftshader",
          "--disable-vulkan-surface",
        ]
      : ["--enable-unsafe-webgpu"],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
  page.on("console", (message) => {
    if (message.type() === "error") {
      process.stderr.write(`[browser] ${message.text()}\n`);
    }
  });
  page.on("pageerror", (error) => {
    process.stderr.write(`[browser] ${error.message}\n`);
  });

  const url = `${origin}/renderers/?renderer=${renderer}&profile=1&objects=${objects}&frames=${frames}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
  await page.waitForFunction(
    () => window.__collisionRendererProfile?.done === true,
    undefined,
    { timeout: 60_000 },
  );
  const result = await page.evaluate(() => window.__collisionRendererProfile);
  validateResult(result, renderer, objects, frames);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}

function validateResult(result, expectedRenderer, expectedObjects, expectedFrames) {
  if (!result || result.done !== true) throw new Error("browser profile did not produce a completed result");
  if (result.renderer !== expectedRenderer) throw new Error(`renderer mismatch: ${result.renderer}`);
  if (result.objects !== expectedObjects) throw new Error(`object-count mismatch: ${result.objects}`);
  if (result.measuredFrames !== expectedFrames) throw new Error(`frame-count mismatch: ${result.measuredFrames}`);
  for (const metric of [result.renderCpuMs, result.simulationTransferMs, result.frameIntervalMs]) {
    for (const value of [metric?.mean, metric?.median, metric?.p95]) {
      if (!Number.isFinite(value) || value < 0) throw new Error("browser profile emitted an invalid timing metric");
    }
  }
}

async function waitForServer(url) {
  const deadline = Date.now() + 15_000;
  let lastError;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`static server exited with code ${server.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`static server returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error("static server did not become ready");
}

function boundedInteger(raw, fallback, minimum, maximum) {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
