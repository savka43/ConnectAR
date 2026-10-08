// Гомография плоскости платы: мм платы → координаты снимка. Матрица 3×3 — массив из 9 чисел по строкам.
// DLT с нормализацией Хартли, RANSAC по точкам MindAR, проверка четырёхугольника углов платы.

export function applyHomography(H, [x, y]) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

export function multiply(A, B) {
  const C = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      for (let k = 0; k < 3; k++) C[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c];
    }
  }
  return C;
}

/** Масштаб осей: пиксели снимка W × H → нормированные 0…1 (и обратно с обратными множителями). */
export const scaling = (sx, sy) => [sx, 0, 0, 0, sy, 0, 0, 0, 1];

// Хартли: центр в 0, среднее расстояние до центра √2. Для вырожденного набора (все точки совпали) — null.
function normalization(points) {
  const n = points.length;
  const cx = points.reduce((s, p) => s + p[0], 0) / n;
  const cy = points.reduce((s, p) => s + p[1], 0) / n;
  const d = points.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / n;
  if (!(d > 0)) return null;
  const k = Math.SQRT2 / d;
  return { T: [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1], Tinv: [1 / k, 0, cx, 0, 1 / k, cy, 0, 0, 1] };
}

const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function hasCollinearTriple(points) {
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      for (let k = j + 1; k < points.length; k++) {
        if (Math.abs(cross(points[i], points[j], points[k])) < 1e-6) return true;
      }
    }
  }
  return false;
}

// Собственные числа и векторы симметричной матрицы (метод Якоби); векторы — столбцы V.
function jacobiEigen(matrix) {
  const n = matrix.length;
  const a = matrix.map((row) => row.slice());
  const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  const scale = a.reduce((s, row) => s + row.reduce((t, x) => t + x * x, 0), 0);
  for (let sweep = 0; sweep < 64; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off <= 1e-30 * scale) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (a[p][q] === 0) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return a.map((row, i) => ({ value: row[i], vector: V.map((r) => r[i]) })).sort((x, y) => x.value - y.value);
}

const det3 = (H) => H[0] * (H[4] * H[8] - H[5] * H[7]) - H[1] * (H[3] * H[8] - H[5] * H[6]) + H[2] * (H[3] * H[7] - H[4] * H[6]);

/**
 * Гомография по парам точек src[i] → dst[i] (≥ 4 пар), DLT с нормализацией Хартли.
 * Вырожденный вход (у четырёх точек три на одной прямой, все точки на прямой, неоднозначное решение) → null.
 */
export function homographyFromPoints(src, dst) {
  if (src.length < 4 || src.length !== dst.length) return null;
  const ns = normalization(src);
  const nd = normalization(dst);
  if (!ns || !nd) return null;
  const a = src.map((p) => applyHomography(ns.T, p));
  const b = dst.map((p) => applyHomography(nd.T, p));
  if (src.length === 4 && (hasCollinearTriple(a) || hasCollinearTriple(b))) return null;

  // AᵀA для уравнений DLT: по две строки на пару точек.
  const M = Array.from({ length: 9 }, () => new Array(9).fill(0));
  const addRow = (row) => {
    for (let i = 0; i < 9; i++) for (let j = i; j < 9; j++) M[i][j] += row[i] * row[j];
  };
  a.forEach(([x, y], i) => {
    const [u, v] = b[i];
    addRow([-x, -y, -1, 0, 0, 0, u * x, u * y, u]);
    addRow([0, 0, 0, -x, -y, -1, v * x, v * y, v]);
  });
  for (let i = 0; i < 9; i++) for (let j = 0; j < i; j++) M[i][j] = M[j][i];

  const eigen = jacobiEigen(M);
  const largest = eigen[8].value;
  // Второе по малости собственное число ≈ 0 — решение не единственно (например, все точки на одной прямой).
  if (!(largest > 0) || eigen[1].value <= 1e-10 * largest) return null;
  const Hn = eigen[0].vector;
  const norm = Math.hypot(...Hn);
  if (Math.abs(det3(Hn)) < 1e-6 * norm ** 3) return null;

  const H = multiply(nd.Tinv, multiply(Hn, ns.T));
  const s = H[8] !== 0 ? H[8] : Math.hypot(...H);
  return H.map((x) => x / s);
}

/** Детерминированный генератор для тестов RANSAC (mulberry32). */
export function seededRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Устойчивая гомография по парам с выбросами. threshold — допуск ошибки перепроекции в единицах dst
 * (пиксели снимка), rng — источник случайных чисел (в тестах — seededRandom).
 * @returns {{ H: number[], inliers: number[] } | null}
 */
export function ransacHomography(src, dst, { threshold, iterations = 500, minInliers = 8, rng = Math.random } = {}) {
  const n = src.length;
  if (n < 4) return null;
  const inliersOf = (H) => {
    const result = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = applyHomography(H, src[i]);
      if (Math.hypot(x - dst[i][0], y - dst[i][1]) <= threshold) result.push(i);
    }
    return result;
  };

  let best = [];
  for (let it = 0; it < iterations; it++) {
    const sample = new Set();
    while (sample.size < 4) sample.add(Math.floor(rng() * n));
    const idx = [...sample];
    const H = homographyFromPoints(idx.map((i) => src[i]), idx.map((i) => dst[i]));
    if (!H) continue;
    const inliers = inliersOf(H);
    if (inliers.length > best.length) best = inliers;
    if (best.length === n) break;
  }
  if (best.length < Math.max(4, minInliers)) return null;

  // Уточнение по всем согласным точкам; повторяем, пока набор растёт.
  let H = null;
  for (let round = 0; round < 3; round++) {
    const refined = homographyFromPoints(best.map((i) => src[i]), best.map((i) => dst[i]));
    if (!refined) break;
    H = refined;
    const inliers = inliersOf(H);
    if (inliers.length <= best.length) break;
    best = inliers;
  }
  return H && { H, inliers: best };
}

/** Углы платы в мм по часовой стрелке от верхнего левого (у задней панели I/O). */
export const boardCorners = ({ widthMm, heightMm }) => [[0, 0], [widthMm, 0], [widthMm, heightMm], [0, heightMm]];

const segmentsCross = (p1, p2, p3, p4) =>
  cross(p1, p2, p3) * cross(p1, p2, p4) < 0 && cross(p3, p4, p1) * cross(p3, p4, p2) < 0;

/**
 * Проверка четырёхугольника углов платы на снимке (углы по часовой стрелке от верхнего левого, px; ось y вниз).
 * Углы за краем снимка допустимы. reason: "crossed" — самопересечение («бантик», перепутаны соседние углы),
 * "mirrored" — обход против часовой (порядок перепутан), "concave", "small" — меньше minArea снимка,
 * "aspect" — пропорции далеки от physical.
 */
export function checkQuad(corners, [W, H], physical, { minArea = 0.03, maxAspectError = 2 } = {}) {
  const [a, b, c, d] = corners;
  if (segmentsCross(a, b, c, d) || segmentsCross(b, c, d, a)) return { ok: false, reason: "crossed" };
  const turns = corners.map((p, i) => cross(p, corners[(i + 1) % 4], corners[(i + 2) % 4]));
  if (turns.every((t) => t < 0)) return { ok: false, reason: "mirrored" };
  if (!turns.every((t) => t > 0)) return { ok: false, reason: "concave" };
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = corners[i];
    const [x2, y2] = corners[(i + 1) % 4];
    area += x1 * y2 - x2 * y1;
  }
  if (Math.abs(area) / 2 < minArea * W * H) return { ok: false, reason: "small" };
  const len = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
  const ratio = ((len(a, b) + len(d, c)) / (len(b, c) + len(a, d))) / (physical.widthMm / physical.heightMm);
  if (ratio > maxAspectError || ratio < 1 / maxAspectError) return { ok: false, reason: "aspect" };
  return { ok: true };
}
