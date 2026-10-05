import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nativeAnchorPosition, nativeCorners, rectCenterOffsetMm, webAnchorPosition, webCorners } from "../src/layout.js";

const fixtures = JSON.parse(readFileSync(new URL("../../shared_boards/fixtures/layout-cases.json", import.meta.url), "utf8"));
const digits = -Math.log10(fixtures.tolerance);

const expectClose = (actual, expected) => {
  expect(actual.flat()).toHaveLength(expected.flat().length);
  actual.flat().forEach((v, i) => expect(v).toBeCloseTo(expected.flat()[i], digits));
};

describe.each(fixtures.cases)("BoardLayout: $name", ({ physical, rectMm, expected }) => {
  it("смещение центра в мм", () => {
    const { dx, dz } = rectCenterOffsetMm(physical, rectMm);
    expectClose([dx, dz], [expected.offsetMm.dx, expected.offsetMm.dz]);
  });

  it("позиция и углы для ARKit / ARCore", () => {
    expectClose(nativeAnchorPosition(physical, rectMm), expected.anchorM);
    expectClose(nativeCorners(physical, rectMm), expected.cornersM);
  });

  it("позиция и углы для MindAR", () => {
    expectClose(webAnchorPosition(physical, rectMm), expected.web.center);
    expectClose(webCorners(physical, rectMm), expected.web.corners);
  });
});
