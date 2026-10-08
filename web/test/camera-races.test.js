import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraTab } from "../src/camera.js";
import { BoardPhotoView } from "../src/photo-view.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const images = [];
  vi.stubGlobal("Image", class {
    constructor() {
      this.ready = deferred();
      this.naturalWidth = this.naturalHeight = 100;
      this.replaceWith = vi.fn();
      images.push(this);
    }
    decode() { return this.ready.promise; }
  });
  vi.stubGlobal("document", { createElement: () => ({
    width: 0, height: 0, getContext: () => ({ drawImage() {} }),
    toBlob: (callback) => callback(new Blob(["photo"])),
  }) });
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 100, height: 100, close() {} })));
  const initial = { src: "C", alt: "photo", replaceWith: vi.fn() };
  const view = Object.assign(Object.create(BoardPhotoView.prototype), {
    img: initial, svg: { setAttribute() {} }, fit: vi.fn(),
  });
  const camera = Object.assign(Object.create(CameraTab.prototype), {
    mode: "photo", photoToken: 0, board: {}, photo: { url: "C", homography: "C" },
    photoView: view, render: vi.fn(), toast: vi.fn(),
    recognize: vi.fn(async () => null), clearSearchTimers() {}, dropFrozen() {},
    ar: { resume() {}, pause() {} },
  });
  return { camera, view, initial, images };
}

// Управляем порядком декодирования, а не скоростью машины.
describe("публикация снимков", () => {
  it("A не заменяет C, если B выбран, но ещё не дошёл до setImage", async () => {
    const { camera, view, initial, images } = setup();
    const a = camera.loadPhoto("A");
    await vi.waitFor(() => expect(images).toHaveLength(1));
    const bitmapB = deferred();
    createImageBitmap.mockImplementationOnce(() => bitmapB.promise);
    const b = camera.loadPhoto("B");
    images[0].ready.resolve();
    await a;
    expect(view.img).toBe(initial);
    expect(camera.photo.homography).toBe("C");
    bitmapB.resolve({ width: 100, height: 100, close() {} });
    await vi.waitFor(() => expect(images).toHaveLength(2));
    images[1].ready.resolve();
    await b;
    expect(view.img).toBe(images[1]);
    expect(camera.photo.url).toBe(images[1].src);
  });

  it("выход в AR отменяет декодирование, даже если сразу вернуться в фото", async () => {
    const { camera, view, images } = setup();
    const a = camera.loadPhoto("A");
    await vi.waitFor(() => expect(images).toHaveLength(1));
    camera.backToAR();
    camera.enterPhoto();
    images[1].ready.resolve();
    await Promise.resolve();
    images[0].ready.resolve();
    await a;
    expect(view.img.src).toBe("C");
    expect(camera.photo.url).toBe("C");
    expect(camera.recognize).not.toHaveBeenCalled();
  });

  it("смена платы во время decode замороженного кадра не меняет изображение", async () => {
    const { camera, view, initial, images } = setup();
    camera.mode = "ar";
    camera.ar.isTracking = true;
    camera.ar.freeze = async () => ({ url: "blob:frozen", homography: [] });
    const frozen = camera.freeze();
    await vi.waitFor(() => expect(images).toHaveLength(1));
    camera.photoToken++;
    camera.ar = null;
    camera.mode = "idle";
    images[0].ready.resolve();
    await frozen;
    expect(view.img).toBe(initial);
    expect(camera.frozen).toBeUndefined();
  });
});
