// BoardLayout: перевод rectMm в координаты якоря (docs/design-doc.md, «Перевод в координаты якоря»).
// Чистые функции; проверяются общими фикстурами shared_boards/fixtures/layout-cases.json.

/** Смещение точки платы (мм от левого верхнего угла) от центра платы. */
export function offsetMm(physical, x, y) {
  return { dx: x - physical.widthMm / 2, dz: y - physical.heightMm / 2 };
}

/** Углы прямоугольника по часовой стрелке от левого верхнего, в мм от левого верхнего угла платы. */
export function rectCorners(rect) {
  const { x, y, w, h } = rect;
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

export function rectCenterOffsetMm(physical, rect) {
  return offsetMm(physical, rect.x + rect.w / 2, rect.y + rect.h / 2);
}

/** ARKit: центр фото, плоскость XZ, метры. */
export function nativeAnchorPosition(physical, rect) {
  const { dx, dz } = rectCenterOffsetMm(physical, rect);
  return [dx / 1000, 0, dz / 1000];
}

export function nativeCorners(physical, rect) {
  return rectCorners(rect).map(([x, y]) => {
    const { dx, dz } = offsetMm(physical, x, y);
    return [dx / 1000, 0, dz / 1000];
  });
}

/** MindAR: центр, плоскость XY (Y вверх), ширина цели = 1. */
export function webPoint(physical, x, y) {
  const { dx, dz } = offsetMm(physical, x, y);
  return [dx / physical.widthMm, -dz / physical.widthMm || 0, 0];
}

export function webAnchorPosition(physical, rect) {
  return webPoint(physical, rect.x + rect.w / 2, rect.y + rect.h / 2);
}

export function webCorners(physical, rect) {
  return rectCorners(rect).map(([x, y]) => webPoint(physical, x, y));
}

/** Размер прямоугольника в единицах якоря MindAR. */
export function webSize(physical, rect) {
  return { width: rect.w / physical.widthMm, height: rect.h / physical.widthMm };
}
