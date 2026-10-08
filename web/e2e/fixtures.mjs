// page с подменой CDN: three и MindAR отдаются из node_modules, тесты не зависят от сети и версии на CDN.
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";

const modules = new URL("../node_modules/", import.meta.url);

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route("https://cdn.jsdelivr.net/npm/**", async (route) => {
      const match = new URL(route.request().url()).pathname.match(/^\/npm\/(mind-ar|three)@[^/]+\/(.+)$/);
      if (!match) return route.abort();
      await route.fulfill({
        path: fileURLToPath(new URL(`${match[1]}/${match[2]}`, modules)),
        contentType: "text/javascript",
        headers: { "access-control-allow-origin": "*" },
      });
    });
    page.on("pageerror", (e) => console.error("pageerror:", e.message));
    await use(page);
  },
});

export { expect };

export const BOARD_DIR = "../shared_boards/boards/gigabyte-b450-aorus-m/";
export const SCENES_URL = "e2e/.scenes/";
