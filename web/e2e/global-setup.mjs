// Сцены с известной гомографией и кадр фейковой камеры генерируются до запуска браузера.
import { existsSync } from "node:fs";
import { generateScenes } from "./scenes.mjs";

export default async function globalSetup() {
  const targets = new URL("../../shared_boards/boards/gigabyte-b450-aorus-m/targets.mind", import.meta.url);
  if (!existsSync(targets)) throw new Error("Нет targets.mind: npm run compile-targets");
  await generateScenes();
}
