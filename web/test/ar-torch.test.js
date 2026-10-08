import { expect, it, vi } from "vitest";
import { ARSession } from "../src/ar.js";

function setup() {
  const track = { getCapabilities: () => ({ torch: true }), applyConstraints: vi.fn(async () => {}) };
  const session = new ARSession({ onState: vi.fn(), onTorchChange: vi.fn() });
  session.mindar = {
    controller: { stopProcessVideo() {}, processVideo() {} },
    video: { pause() {}, play: async () => {}, srcObject: { getVideoTracks: () => [track] } },
    renderer: { setAnimationLoop() {} },
  };
  session.hideAnchor = session.updateLabels = session.loop = () => {};
  return { session, track };
}
const commands = (track) => track.applyConstraints.mock.calls.map(([c]) => c.advanced[0].torch);

it("pause выключает фонарик после незавершённого включения", async () => {
  const { session, track } = setup();
  let finish;
  track.applyConstraints.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  const toggle = session.toggleTorch();
  await Promise.resolve();
  session.pause();
  finish();
  await toggle;
  await session.torchQueue;
  expect(commands(track)).toEqual([true, false]);
  expect(session.torchOn).toBe(false);
  expect(session.torchWanted).toBe(true);
});

it("быстрый resume согласован с выключением при паузе", async () => {
  const { session, track } = setup();
  await session.toggleTorch();
  let finish;
  track.applyConstraints.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  session.pause();
  await Promise.resolve();
  const resume = session.resume();
  finish();
  await resume;
  expect(commands(track)).toEqual([true, false, true]);
  expect(session.torchOn).toBe(true);
});

it("неудачное включение при resume обновляет состояние кнопки", async () => {
  const { session, track } = setup();
  await session.toggleTorch();
  session.pause();
  await session.torchQueue;
  track.applyConstraints.mockRejectedValueOnce(new Error("torch failed"));
  session.onTorchChange.mockClear();
  await session.resume();
  expect(session.torchWanted).toBe(false);
  expect(session.torchOn).toBe(false);
  expect(session.onTorchChange).toHaveBeenCalledOnce();
});

it("неудачное выключение оставляет кнопку включённой", async () => {
  const { session, track } = setup();
  await session.toggleTorch();
  track.applyConstraints.mockRejectedValueOnce(new Error("torch failed"));
  await session.toggleTorch();
  expect(session.torchWanted).toBe(true);
  expect(session.torchOn).toBe(true);
});

it("pause не отправляет torch:false, если свет не включали", async () => {
  const { session, track } = setup();
  session.pause();
  await session.torchQueue;
  expect(track.applyConstraints).not.toHaveBeenCalled();
});

it("два быстрых переключения выполняются последовательно", async () => {
  const { session, track } = setup();
  await Promise.all([session.toggleTorch(), session.toggleTorch()]);
  expect(commands(track)).toEqual([true, false]);
  expect(session.torchWanted).toBe(false);
  expect(session.torchOn).toBe(false);
});
