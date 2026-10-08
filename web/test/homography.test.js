import { describe, expect, it } from "vitest";
import {
  applyHomography, boardCorners, checkQuad, homographyFromPoints, ransacHomography, seededRandom,
} from "../src/homography.js";

const physical = { widthMm: 244, heightMm: 244 };
// Плата 244 × 244 мм на снимке 4000 × 3000 px в перспективе.
const TRUE_H = [12.1, 2.3, 820, -1.4, 10.6, 410, 0.0009, 0.0011, 1];

const grid = (n, size) => Array.from({ length: n * n }, (_, i) => [((i % n) + 0.5) * size / n, (Math.floor(i / n) + 0.5) * size / n]);
const maxError = (H, src, dst) => Math.max(...src.map((p, i) => {
  const [x, y] = applyHomography(H, p);
  return Math.hypot(x - dst[i][0], y - dst[i][1]);
}));

describe("homographyFromPoints", () => {
  it("по четырём точкам восстанавливает гомографию точно", () => {
    const src = boardCorners(physical);
    const dst = src.map((p) => applyHomography(TRUE_H, p));
    const H = homographyFromPoints(src, dst);
    expect(maxError(H, grid(5, 244), grid(5, 244).map((p) => applyHomography(TRUE_H, p)))).toBeLessThan(1e-6);
  });

  it("сохраняет точность на разном масштабе: мм (0–244) → пиксели (0–4000)", () => {
    const src = grid(6, 244);
    const dst = src.map((p) => applyHomography(TRUE_H, p));
    const H = homographyFromPoints(src, dst);
    expect(maxError(H, src, dst)).toBeLessThan(1e-6);
    // Тот же масштаб с шумом в полпикселя: ошибка остаётся порядка шума.
    const rng = seededRandom(7);
    const noisy = dst.map(([x, y]) => [x + rng() - 0.5, y + rng() - 0.5]);
    expect(maxError(homographyFromPoints(src, noisy), src, dst)).toBeLessThan(1);
  });

  it("вырожденный вход → null", () => {
    const line = [[0, 0], [100, 0], [200, 0], [50, 80]]; // три точки на одной прямой
    expect(homographyFromPoints(line, boardCorners(physical))).toBeNull();
    expect(homographyFromPoints(boardCorners(physical), line)).toBeNull();
    expect(homographyFromPoints(grid(3, 244).map(([x]) => [x, x]), grid(3, 244))).toBeNull(); // все на прямой
    expect(homographyFromPoints(boardCorners(physical).slice(0, 3), boardCorners(physical).slice(0, 3))).toBeNull();
  });
});

describe("ransacHomography", () => {
  it("находит гомографию при 30 % выбросов (детерминированный RNG)", () => {
    const rng = seededRandom(42);
    const src = grid(10, 244);
    const dst = src.map((p) => applyHomography(TRUE_H, p).map((v) => v + (rng() - 0.5)));
    const outliers = new Set();
    while (outliers.size < 30) outliers.add(Math.floor(rng() * src.length));
    for (const i of outliers) dst[i] = [rng() * 4000, rng() * 3000];

    const result = ransacHomography(src, dst, { threshold: 4, rng: seededRandom(1) });
    expect(result).not.toBeNull();
    expect(result.inliers.some((i) => outliers.has(i))).toBe(false);
    expect(result.inliers.length).toBe(70);
    const clean = src.map((p) => applyHomography(TRUE_H, p));
    expect(maxError(result.H, boardCorners(physical), boardCorners(physical).map((p) => applyHomography(TRUE_H, p)))).toBeLessThan(2);
    expect(maxError(result.H, src.filter((_, i) => !outliers.has(i)), clean.filter((_, i) => !outliers.has(i)))).toBeLessThan(1.5);
  });

  it("без согласованного набора — null", () => {
    const rng = seededRandom(3);
    const src = grid(5, 244);
    const dst = src.map(() => [rng() * 4000, rng() * 3000]);
    expect(ransacHomography(src, dst, { threshold: 4, rng: seededRandom(1) })).toBeNull();
  });
});

describe("checkQuad", () => {
  const image = [1000, 800];
  const good = [[200, 150], [800, 180], [760, 700], [230, 650]];

  it("обычный четырёхугольник платы проходит", () => {
    expect(checkQuad(good, image, physical)).toEqual({ ok: true });
  });

  it("«бантик» (перепутаны соседние углы) — crossed", () => {
    const bowtie = [good[0], good[1], good[3], good[2]];
    expect(checkQuad(bowtie, image, physical).reason).toBe("crossed");
  });

  it("обход против часовой — mirrored", () => {
    expect(checkQuad([...good].reverse(), image, physical).reason).toBe("mirrored");
  });

  it("невыпуклый, слишком маленький, вытянутый — отклоняются", () => {
    expect(checkQuad([[200, 150], [800, 180], [400, 300], [230, 650]], image, physical).reason).toBe("concave");
    expect(checkQuad([[10, 10], [60, 10], [60, 60], [10, 60]], image, physical).reason).toBe("small");
    expect(checkQuad([[0, 300], [1000, 300], [1000, 420], [0, 420]], image, physical).reason).toBe("aspect");
  });

  it("плата частично за кадром: углы вне снимка допустимы", () => {
    expect(checkQuad([[-150, -80], [700, -60], [680, 760], [-120, 740]], image, physical)).toEqual({ ok: true });
  });
});
