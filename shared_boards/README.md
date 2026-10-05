# shared_boards — общий источник истины

Размеченные данные плат, которые используют все клиенты (`ios/`, `android/`, `web/`). Правки содержимого (шаги, тексты, разъёмы, разметка) делаются **только здесь**; клиенты их не дублируют вручную.

```
shared_boards/
├── index.json                  # список поддерживаемых плат
├── schema/board.schema.json    # JSON Schema формата платы
├── scripts/validate.mjs        # проверка данных (Node ≥ 18, без зависимостей)
├── fixtures/layout-cases.json  # входы и ожидаемые выходы BoardLayout для тестов всех клиентов
└── boards/<board-id>/
    ├── board.json              # компоненты, разъёмы, шаги сборки
    └── target.jpg              # (опционально) эталон для image tracking
```

## Формат `board.json`

- `components` — что устанавливается (`id`, `name`, `icons.{ios,android,web}`).
- `physical` — реальный размер платы в мм (`widthMm`, `heightMm`); задаёт масштаб для AR.
- `target.image` — эталонное фото: строго сверху, без бликов, обрезано точно по краю платы, задняя I/O-панель слева; пропорции совпадают с `physical` (±3 %). Без `target` AR для платы недоступен, клиенты открывают фото-режим.
- `connectors` — разъёмы на плате; `componentId` ссылается на компонент, `rectMm` — прямоугольник разъёма в мм от левого верхнего угла платы (`x`, `y` — левый верхний угол разъёма). У каждого разъёма, на который ссылается шаг, `rectMm` обязателен.
- `steps` — шаги сценария в порядке выполнения; `connectorId` ссылается на разъём, `manualPage` — печатная страница руководства.

Все `id` — kebab-case, уникальны в пределах своего списка.

## Добавить плату

1. Создать `boards/<board-id>/board.json` по схеме.
2. Добавить `<board-id>` в `index.json`.
3. Снять `rectMm` разъёмов линейкой с платы. Для AR положить `target.jpg` и указать `"target": { "image": "target.jpg" }`; `targets.mind` для web компилируется в CI (`web/scripts/compile-targets.mjs`).
4. `node shared_boards/scripts/validate.mjs`.
