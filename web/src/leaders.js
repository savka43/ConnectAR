// Выноски от точки на разъёме к сдвинутой подписи — общий слой SVG для AR и снимка.
const SVG_NS = "http://www.w3.org/2000/svg";
const drawn = new WeakMap(); // svg → ключ последней отрисовки

/**
 * lines: { from: [x, y], to: [x, y], size?: [w, h], state } в px слоя; рисует линию и точку на разъёме.
 * to — центр подписи; с size линия обрывается на её краю, а не уходит под текст.
 * Вызывается каждый кадр AR: узлы переиспользуются, при той же раскладке DOM не трогается.
 */
export function renderLeaders(svg, lines) {
  const segments = lines.map(({ from, to, size, state }) => {
    const [x1, y1] = from.map(round);
    const [x2, y2] = (size ? clipToBox(from, to, size) : to).map(round);
    return { x1, y1, x2, y2, state };
  });
  const key = segments.map((s) => `${s.x1},${s.y1},${s.x2},${s.y2},${s.state}`).join(";");
  if (drawn.get(svg) === key) return;
  drawn.set(svg, key);

  while (svg.childElementCount > segments.length * 2) svg.lastElementChild.remove();
  segments.forEach(({ x1, y1, x2, y2, state }, i) => {
    const line = svg.children[i * 2] ?? svg.appendChild(document.createElementNS(SVG_NS, "line"));
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    line.setAttribute("class", `leader ${state}`);
    const dot = svg.children[i * 2 + 1] ?? svg.appendChild(document.createElementNS(SVG_NS, "circle"));
    dot.setAttribute("cx", x1);
    dot.setAttribute("cy", y1);
    dot.setAttribute("r", 3);
    dot.setAttribute("class", `leader-dot ${state}`);
  });
}

const round = (v) => Math.round(v * 10) / 10;

/** Точка, где отрезок from → to (центр прямоугольника size) входит в этот прямоугольник. */
function clipToBox(from, to, [w, h]) {
  const dx = from[0] - to[0];
  const dy = from[1] - to[1];
  const t = Math.min(dx ? w / 2 / Math.abs(dx) : Infinity, dy ? h / 2 / Math.abs(dy) : Infinity);
  return t >= 1 ? to : [to[0] + dx * t, to[1] + dy * t];
}

export function createLeadersLayer() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "leaders");
  svg.setAttribute("aria-hidden", "true");
  return svg;
}
