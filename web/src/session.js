// Сессия сборки: ответы опроса «Ваша сборка», план и выполненные шаги; хранятся в localStorage по плате.
import { normalizeAnswers, resolvePlan } from "./plan.js";

const progressKey = (boardId) => `connectar.progress.${boardId}`;
const setupKey = (boardId) => `connectar.setup.${boardId}`;

function read(storage, key) {
  try {
    return JSON.parse(storage?.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function write(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value));
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
  const stored = read(storage, setupKey(board.id));
  const hasStored = stored !== null && typeof stored === "object" && !Array.isArray(stored);
  let answers = normalizeAnswers(board, hasStored ? stored : {});
  let configured = hasStored;
  let plan = resolvePlan(board, answers);
  const storedDone = read(storage, progressKey(board.id));
  const done = new Set(Array.isArray(storedDone) ? storedDone.filter((id) => typeof id === "string") : []);
  const listeners = new Set();

  const changed = () => listeners.forEach((fn) => fn());
  const saveAnswers = () => write(storage, setupKey(board.id), answers);

  return {
    board,
    done,
    get answers() { return answers; },
    /** Пользователь прошёл опрос (или ответы уже сохранены). */
    get configured() { return configured; },
    get plan() { return plan; },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setAnswer(questionId, optionId) {
      answers = normalizeAnswers(board, { ...answers, [questionId]: optionId });
      plan = resolvePlan(board, answers);
      if (configured) saveAnswers();
      changed();
    },
    completeSetup() {
      configured = true;
      saveAnswers();
      changed();
    },
    setStepDone(id, isDone) {
      isDone ? done.add(id) : done.delete(id);
      write(storage, progressKey(board.id), [...done]);
      changed();
    },
    reset() {
      done.clear();
      write(storage, progressKey(board.id), []);
      changed();
    },
  };
}
