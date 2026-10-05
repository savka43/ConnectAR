// Сессия сборки: выбранные компоненты и выполненные шаги, хранятся в localStorage по плате.

const progressKey = (boardId) => `connectar.progress.${boardId}`;
const componentsKey = (boardId) => `connectar.components.${boardId}`;

function readIds(storage, key) {
  try {
    const ids = JSON.parse(storage?.getItem(key) ?? "null");
    return Array.isArray(ids) ? ids : null;
  } catch {
    return null;
  }
}

function writeIds(storage, key, ids) {
  try {
    storage?.setItem(key, JSON.stringify([...ids]));
  } catch {
    // Без хранилища сессия живёт до перезагрузки страницы.
  }
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createSession(board, storage = defaultStorage()) {
  const componentIds = new Set(board.components.map((c) => c.id));
  const stepIds = new Set(board.steps.map((s) => s.id));
  const storedComponents = readIds(storage, componentsKey(board.id));
  const selected = new Set(storedComponents ? storedComponents.filter((id) => componentIds.has(id)) : componentIds);
  const done = new Set((readIds(storage, progressKey(board.id)) ?? []).filter((id) => stepIds.has(id)));
  const listeners = new Set();

  const changed = () => listeners.forEach((fn) => fn());

  return {
    board,
    selected,
    done,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setComponent(id, isSelected) {
      isSelected ? selected.add(id) : selected.delete(id);
      writeIds(storage, componentsKey(board.id), selected);
      changed();
    },
    setStepDone(id, isDone) {
      isDone ? done.add(id) : done.delete(id);
      writeIds(storage, progressKey(board.id), done);
      changed();
    },
    reset() {
      done.clear();
      writeIds(storage, progressKey(board.id), done);
      changed();
    },
  };
}
