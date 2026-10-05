import { CameraTab } from "./camera.js";
import { stepStates, visibleSteps } from "./markers.js";
import { createSession } from "./session.js";

// В GitHub Pages данные лежат рядом (./shared_boards), при локальном запуске из корня репозитория — уровнем выше.
const DATA_ROOTS = ["./shared_boards", "../shared_boards"];

const $ = (id) => document.getElementById(id);
const boardsById = new Map();
let dataRoot;
let board;
let session;
let dialogStepId;

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function resolveDataRoot() {
  for (const root of DATA_ROOTS) {
    try {
      if ((await fetch(`${root}/index.json`, { method: "HEAD" })).ok) return root;
    } catch {
      // Пробуем следующий путь.
    }
  }
  throw new Error("Не найдены данные shared_boards");
}

function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3000);
}

// ——— Сборка: компоненты и чек-лист ———

function renderComponents() {
  $("components").replaceChildren(...board.components.map((component) => {
    const label = document.createElement("label");
    label.className = "chip";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = session.selected.has(component.id);
    input.addEventListener("change", () => session.setComponent(component.id, input.checked));
    label.append(input, ` ${component.name}`);
    return label;
  }));
}

function renderSteps() {
  const connectors = new Map(board.connectors.map((c) => [c.id, c]));
  const components = new Map(board.components.map((c) => [c.id, c]));
  const steps = visibleSteps(board, session.selected);
  const states = stepStates(board, session.selected, session.done);
  const template = $("step-template");

  $("steps").replaceChildren(...steps.map((step) => {
    const connector = connectors.get(step.connectorId);
    const item = template.content.firstElementChild.cloneNode(true);
    const checkbox = item.querySelector("input");
    item.className = states.get(step.id);
    item.querySelector(".title").textContent = step.title;
    item.querySelector(".connector").textContent = `${components.get(connector.componentId).name} → ${connector.name}`;
    checkbox.checked = session.done.has(step.id);
    checkbox.setAttribute("aria-label", step.title);
    checkbox.addEventListener("change", () => session.setStepDone(step.id, checkbox.checked));
    item.querySelector(".open").addEventListener("click", () => openStep(step));
    return item;
  }));

  const doneCount = steps.filter((s) => session.done.has(s.id)).length;
  $("progress").textContent = steps.length === 0
    ? "Выберите компоненты, которые устанавливаете."
    : doneCount === steps.length ? "Все шаги выполнены." : `Выполнено ${doneCount} из ${steps.length}`;
}

// ——— Экран инструкции ———

function openStep(step) {
  dialogStepId = step.id;
  renderDialog();
  const dialog = $("step-dialog");
  if (!dialog.open) dialog.showModal();
}

function renderDialog() {
  const step = board.steps.find((s) => s.id === dialogStepId);
  if (!step) return;
  const connector = board.connectors.find((c) => c.id === step.connectorId);
  const component = board.components.find((c) => c.id === connector.componentId);
  const state = stepStates(board, session.selected, session.done).get(step.id);
  const done = session.done.has(step.id);

  $("dialog-title").textContent = step.title;
  $("dialog-badge").hidden = state !== "current";
  $("dialog-connector").textContent = `${component.name} → ${connector.name}`;
  $("dialog-instruction").textContent = step.instruction;
  $("dialog-manual").href = `${board.manualURL}#page=${step.manualPage}`;
  $("dialog-manual").textContent = `Руководство, стр. ${step.manualPage}`;
  $("dialog-toggle").textContent = done ? "Снять отметку" : "Отметить выполненным";
  $("dialog-toggle").classList.toggle("primary", !done);
}

$("dialog-toggle").addEventListener("click", () => {
  const done = !session.done.has(dialogStepId);
  session.setStepDone(dialogStepId, done);
  if (done) $("step-dialog").close();
});
$("dialog-close").addEventListener("click", () => $("step-dialog").close());

// ——— Вкладки ———

const camera = new CameraTab({ openStep, toast });

function showTab(name) {
  const isCamera = name === "camera";
  for (const tab of document.querySelectorAll("[role=tab]")) {
    tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
  }
  $("tab-assembly").hidden = isCamera;
  $("tab-camera").hidden = !isCamera;
  document.body.classList.toggle("camera-open", isCamera);
  if (isCamera) camera.show();
  else camera.hide();
}

for (const tab of document.querySelectorAll("[role=tab]")) {
  tab.addEventListener("click", () => {
    history.replaceState(null, "", tab.dataset.tab === "camera" ? "#camera" : "#");
    showTab(tab.dataset.tab);
  });
}

// ——— Плата ———

function selectBoard(boardId) {
  board = boardsById.get(boardId);
  session = createSession(board);
  session.subscribe(() => {
    renderSteps();
    if ($("step-dialog").open) renderDialog();
  });
  $("reset").onclick = () => session.reset();
  renderComponents();
  renderSteps();
  camera.setBoard(board, session, board.target ? `${dataRoot}/boards/${board.id}/targets.mind` : null);
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
  select.addEventListener("change", () => selectBoard(select.value));
  selectBoard(select.value);
  showTab(location.hash === "#camera" ? "camera" : "assembly");
}

main().catch(showError);
