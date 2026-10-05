// В GitHub Pages данные лежат рядом (./shared_boards), при локальном запуске из корня репозитория — уровнем выше.
const DATA_ROOTS = ["./shared_boards", "../shared_boards"];
const AFRAME_SRC = "https://cdn.jsdelivr.net/npm/aframe@1.5.0/dist/aframe-v1.5.0.min.js";
const MINDAR_SRC = "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js";

const $ = (id) => document.getElementById(id);
let dataRoot;
let board;
const boardsById = new Map();

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function exists(path) {
  try {
    return (await fetch(path, { method: "HEAD" })).ok;
  } catch {
    return false;
  }
}

async function resolveDataRoot() {
  for (const root of DATA_ROOTS) {
    if (await exists(`${root}/index.json`)) return root;
  }
  throw new Error("Не найдены данные shared_boards");
}

const storageKey = (boardId) => `connectar.progress.${boardId}`;

function loadProgress(boardId) {
  try {
    const ids = JSON.parse(localStorage.getItem(storageKey(boardId)) ?? "[]");
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

function saveProgress(boardId, done) {
  try {
    localStorage.setItem(storageKey(boardId), JSON.stringify([...done]));
  } catch {
    // Прогресс просто не сохранится между сеансами.
  }
}

function renderSteps() {
  const connectors = new Map(board.connectors.map((c) => [c.id, c]));
  const components = new Map(board.components.map((c) => [c.id, c]));
  const done = loadProgress(board.id);
  const list = $("steps");
  const template = $("step-template");

  const updateProgress = () => {
    $("progress").textContent = done.size === board.steps.length
      ? "Все шаги выполнены."
      : `Выполнено ${done.size} из ${board.steps.length}`;
  };

  list.replaceChildren(...board.steps.map((step) => {
    const connector = connectors.get(step.connectorId);
    const component = components.get(connector.componentId);
    const item = template.content.firstElementChild.cloneNode(true);
    const checkbox = item.querySelector("input");

    item.id = `step-${step.id}`;
    item.querySelector(".title").textContent = step.title;
    item.querySelector(".connector").textContent = `${component.name} → ${connector.name}`;
    item.querySelector(".instruction").textContent = step.instruction;
    const manual = item.querySelector(".manual");
    manual.href = `${board.manualURL}#page=${step.manualPage}`;
    manual.textContent = `Руководство, стр. ${step.manualPage}`;

    checkbox.checked = done.has(step.id);
    item.classList.toggle("done", checkbox.checked);
    checkbox.addEventListener("change", () => {
      checkbox.checked ? done.add(step.id) : done.delete(step.id);
      item.classList.toggle("done", checkbox.checked);
      saveProgress(board.id, done);
      updateProgress();
    });
    return item;
  }));

  $("reset").onclick = () => {
    done.clear();
    saveProgress(board.id, done);
    renderSteps();
  };
  updateProgress();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Не удалось загрузить ${src}`));
    document.head.append(script);
  });
}

function imageAspect(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalHeight / img.naturalWidth);
    img.onerror = () => reject(new Error(`Не удалось загрузить ${src}`));
    img.src = src;
  });
}

// MindAR кладёт цель в плоскость шириной 1 с центром в начале координат; region задан от левого верхнего угла фото.
function markerEntity(connector, aspect) {
  const { x, y, width, height } = connector.region;
  const plane = document.createElement("a-plane");
  plane.setAttribute("position", `${x + width / 2 - 0.5} ${(0.5 - (y + height / 2)) * aspect} 0.01`);
  plane.setAttribute("width", width);
  plane.setAttribute("height", height * aspect);
  plane.setAttribute("material", "color: #0f9d8f; opacity: 0.45; transparent: true");

  const label = document.createElement("a-text");
  label.setAttribute("value", connector.name);
  label.setAttribute("align", "center");
  label.setAttribute("width", 0.6);
  label.setAttribute("position", `0 ${height * aspect / 2 + 0.03} 0`);
  plane.append(label);
  return plane;
}

async function startAR(targetBase) {
  $("ar-start").disabled = true;
  try {
    const [aspect] = await Promise.all([
      imageAspect(`${targetBase}/board.jpg`),
      loadScript(AFRAME_SRC).then(() => loadScript(MINDAR_SRC)),
    ]);

    const scene = document.createElement("a-scene");
    scene.setAttribute("mindar-image", `imageTargetSrc: ${targetBase}/board.mind; uiScanning: yes; uiLoading: yes`);
    scene.setAttribute("vr-mode-ui", "enabled: false");
    scene.setAttribute("device-orientation-permission-ui", "enabled: false");
    scene.setAttribute("embedded", "");
    scene.style.cssText = "position:absolute;inset:0;width:100%;height:100%";

    const camera = document.createElement("a-camera");
    camera.setAttribute("position", "0 0 0");
    camera.setAttribute("look-controls", "enabled: false");

    const target = document.createElement("a-entity");
    target.setAttribute("mindar-image-target", "targetIndex: 0");
    board.connectors.filter((c) => c.region).forEach((c) => target.append(markerEntity(c, aspect)));

    scene.append(camera, target);
    $("ar-container").replaceChildren(scene);
    $("ar-start").hidden = true;
  } catch (e) {
    showError(e);
    $("ar-start").disabled = false;
  }
}

async function selectBoard(boardId) {
  stopAR();
  board = boardsById.get(boardId);
  renderSteps();

  const targetBase = `${dataRoot}/boards/${boardId}/targets`;
  const hasTarget = await exists(`${targetBase}/board.mind`);
  $("ar-panel").hidden = !hasTarget;
  $("ar-start").hidden = false;
  $("ar-start").disabled = false;
  $("ar-start").onclick = () => startAR(targetBase);
}

function stopAR() {
  const scene = document.querySelector("a-scene");
  scene?.systems?.["mindar-image-system"]?.stop();
  $("ar-container").replaceChildren();
}

function showError(e) {
  console.error(e);
  $("error").textContent = e.message;
  $("error").hidden = false;
}

async function main() {
  dataRoot = await resolveDataRoot();
  const index = await fetchJSON(`${dataRoot}/index.json`);
  const boards = await Promise.all(index.boards.map((id) => fetchJSON(`${dataRoot}/boards/${id}/board.json`)));

  boards.forEach((b) => boardsById.set(b.id, b));

  const select = $("board");
  select.replaceChildren(...boards.map((b) => new Option(b.name, b.id)));
  select.addEventListener("change", () => selectBoard(select.value).catch(showError));
  await selectBoard(select.value);
}

main().catch(showError);
