// E2E в headless Chromium: WebGL через SwiftShader, three и MindAR — из node_modules (e2e/fixtures.mjs),
// камера — фейковая, из кадра e2e/.scenes/camera.y4m. Локально на NixOS: CHROMIUM_PATH=$(which chromium).
import { defineConfig } from "@playwright/test";

const scenes = new URL("./e2e/.scenes/", import.meta.url).pathname;

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.js",
  timeout: 240_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.mjs",
  webServer: {
    command: "node e2e/server.mjs 4173",
    url: "http://localhost:4173/web/index.html",
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://localhost:4173/web/",
    viewport: { width: 412, height: 860 },
    permissions: ["camera"],
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: [
        "--enable-unsafe-swiftshader",
        "--use-angle=swiftshader",
        "--ignore-gpu-blocklist",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-video-capture=${scenes}camera.y4m`,
      ],
    },
  },
});
