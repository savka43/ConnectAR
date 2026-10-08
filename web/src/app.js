import { CameraTab } from "./camera.js";
import { stepStates } from "./markers.js";
import { answersSummary, doneDependents, requiresHint, resolveCable } from "./plan.js";
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

// ——— Сборка: опрос и чек-лист ———

let editingSetup = false;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
}

function renderSetup() {
  const showForm = !session.configured || editingSetup;
  $("setup-form").hidden = !showForm;
  $("setup-intro").hidden = session.configured;
  $("setup-summary").hidden = showForm;
  $("setup-summary").textContent = answersSummary(board, session.answers);
  $("setup-edit").hidden = showForm;
  $("setup-done").textContent = session.configured ? "Готово" : "Построить чек-лист";
  $("checklist").hidden = !session.configured;

  $("setup-questions").replaceChildren(...board.setup.map((q) => {
    const options = q.options.map((o) => {
      const input = el("input", { type: "radio", name: `setup-${q.id}`, value: o.id, checked: session.answers[q.id] === o.id });
      input.addEventListener("change", () => session.setAnswer(q.id, o.id));
      return el("label", { className: "chip" }, input, o.title);
    });
    return el("fieldset", { className: "question" }, el("legend", {}, q.title), el("div", { className: "chips" }, ...options));
  }));
}

$("setup-form").addEventListener("submit", (e) => {
  e.preventDefault();
  editingSetup = false;
  if (session.configured) renderAssembly();
  else session.completeSetup();
});
$("setup-edit").addEventListener("click", () => {
  editingSetup = true;
  renderSetup();
});

function connectorNames(step) {
  const byId = new Map(board.connectors.map((c) => [c.id, c]));
  return step.connectorIds.map((id) => byId.get(id)?.name).filter(Boolean).join(", ");
}

function renderSteps() {
  const { plan, done } = session;
  const states = stepStates(plan, done);
  const template = $("step-template");

  const sections = board.phases.map((phase) => {
    const steps = plan.filter((s) => s.phaseId === phase.id);
    if (steps.length === 0) return null;
    const items = steps.map((step) => {
      const item = template.content.firstElementChild.cloneNode(true);
      const checkbox = item.querySelector("input");
      const state = states.get(step.id);
      item.className = state;
      item.querySelector(".title").textContent = step.title;
      item.querySelector(".connector").textContent = state === "locked"
        ? requiresHint(plan, step, done)
        : connectorNames(step) || "Без разметки на плате";
      checkbox.checked = done.has(step.id);
      checkbox.disabled = state === "locked";
      checkbox.setAttribute("aria-label", step.title);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) session.setStepDone(step.id, true);
        else uncheckStep(step);
      });
      item.querySelector(".open").addEventListener("click", () => openStep(step));
      return item;
    });
    const doneCount = steps.filter((s) => done.has(s.id)).length;
    return el("section", { className: "phase" },
      el("h3", {}, phase.title, el("span", { className: "muted" }, ` ${doneCount}/${steps.length}`)),
      el("ol", { className: "steps" }, ...items));
  });
  $("phases").replaceChildren(...sections.filter(Boolean));

  const doneCount = plan.filter((s) => done.has(s.id)).length;
  $("progress").textContent = doneCount === plan.length ? "Все шаги выполнены." : `Выполнено ${doneCount} из ${plan.length}`;
}

function renderAssembly() {
  renderSetup();
  renderSteps();
}

/** Снятие отметки: если от шага зависят отмеченные шаги, сначала подтверждение со списком. */
function uncheckStep(step) {
  const dependents = doneDependents(session.plan, session.done, step.id);
  if (dependents.length === 0) {
    session.setStepDone(step.id, false);
    return;
  }
  const dialog = $("uncheck-dialog");
  $("uncheck-title").textContent = `Снять отметку с «${step.title}»?`;
  $("uncheck-list").replaceChildren(...dependents.map((s) => el("li", {}, s.title)));
  dialog.returnValue = "";
  dialog.onclose = () => {
    if (dialog.returnValue === "confirm") session.setStepDone(step.id, false);
    else renderAssembly(); // вернуть галочку, снятую кликом
  };
  dialog.showModal();
}

$("uncheck-confirm").addEventListener("click", () => $("uncheck-dialog").close("confirm"));
$("uncheck-cancel").addEventListener("click", () => $("uncheck-dialog").close());

// ——— Экран инструкции ———

function openStep(step) {
  dialogStepId = step.id;
  renderDialog();
  const dialog = $("step-dialog");
  if (!dialog.open) dialog.showModal();
}

function renderDialog() {
  const step = session.plan.find((s) => s.id === dialogStepId);
  if (!step) {
    $("step-dialog").close();
    return;
  }
  const connectors = new Map(board.connectors.map((c) => [c.id, c]));
  const cables = new Map((board.cables ?? []).map((c) => [c.id, c]));
  const state = stepStates(session.plan, session.done).get(step.id);
  const done = session.done.has(step.id);

  $("dialog-title").textContent = step.title;
  $("dialog-badge").hidden = state !== "current";
  $("dialog-connector").textContent = step.connectorIds.length
    ? `На плате: ${step.connectorIds.map((id) => {
      const c = connectors.get(id);
      return c.hint ? `${c.name} (${c.hint})` : c.name;
    }).join(", ")}`
    : "Этот шаг без разметки на плате";
  $("dialog-instruction").textContent = step.instruction;
  $("dialog-substeps").replaceChildren(...step.substeps.map((text) => el("li", {}, text)));
  $("dialog-substeps").hidden = step.substeps.length === 0;
  $("dialog-warning").textContent = step.warning ?? "";
  $("dialog-warning").hidden = !step.warning;

  $("dialog-cables").replaceChildren(...step.cableIds.map((id) => {
    const cable = resolveCable(board, cables.get(id), session.answers);
    return el("section", { className: "cable" },
      el("h3", {}, cable.name),
      el("p", {}, el("span", { className: "muted" }, "Подключается: "), cable.deviceSide),
      cable.psuSide && el("p", {}, el("span", { className: "muted" }, "Со стороны блока питания: "), cable.psuSide),
      cable.warning && el("p", { className: "warning" }, cable.warning));
  }));

  const manual = $("dialog-manual");
  manual.hidden = !step.manualPage;
  if (step.manualPage) {
    manual.href = `${board.manualURL}#page=${step.manualPage}`;
    manual.textContent = `Руководство, стр. ${step.manualPage}`;
  }
  const locked = state === "locked";
  $("dialog-locked").textContent = locked ? requiresHint(session.plan, step, session.done) : "";
  $("dialog-locked").hidden = !locked;
  $("dialog-toggle").textContent = done ? "Снять отметку" : "Отметить выполненным";
  $("dialog-toggle").classList.toggle("primary", !done);
  $("dialog-toggle").disabled = locked;
}

$("dialog-toggle").addEventListener("click", () => {
  const step = session.plan.find((s) => s.id === dialogStepId);
  if (!step) return;
  if (session.done.has(step.id)) uncheckStep(step);
  else if (session.setStepDone(step.id, true)) $("step-dialog").close();
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
  editingSetup = false;
  session.subscribe(() => {
    renderAssembly();
    if ($("step-dialog").open) renderDialog();
  });
  $("reset").onclick = () => session.reset();
  renderAssembly();
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
