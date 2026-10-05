#!/usr/bin/env node
// Компилирует target.jpg каждой платы в targets.mind (цель MindAR) рядом с board.json.
// Использование: node scripts/compile-targets.mjs <папка shared_boards>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadImage } from "canvas";
import { OfflineCompiler } from "mind-ar/src/image-target/offline-compiler.js";

const root = resolve(process.argv[2] ?? "../shared_boards");
const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
let failed = false;

for (const boardId of index.boards) {
  const boardDir = join(root, "boards", boardId);
  const board = JSON.parse(readFileSync(join(boardDir, "board.json"), "utf8"));
  if (!board.target) {
    console.log(`– ${boardId}: нет target, AR недоступен`);
    continue;
  }
  const imagePath = join(boardDir, board.target.image);
  if (!existsSync(imagePath)) {
    console.error(`✗ ${boardId}: нет ${board.target.image}`);
    failed = true;
    continue;
  }
  try {
    const compiler = new OfflineCompiler();
    await compiler.compileImageTargets([await loadImage(imagePath)], () => {});
    writeFileSync(join(boardDir, "targets.mind"), Buffer.from(compiler.exportData()));
    console.log(`✓ ${boardId}: targets.mind`);
  } catch (e) {
    console.error(`✗ ${boardId}: ${e.message}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
