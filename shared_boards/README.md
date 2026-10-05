# shared_boards — общий источник истины

Размеченные данные плат, которые используют все клиенты (`ios/`, `android/`, `web/`). Правки содержимого (шаги, тексты, разъёмы, разметка) делаются **только здесь**; клиенты их не дублируют вручную.

```
shared_boards/
├── index.json                  # список поддерживаемых плат
├── schema/board.schema.json    # JSON Schema формата платы
├── scripts/validate.mjs        # проверка данных (Node ≥ 18, без зависимостей)
└── boards/<board-id>/
    ├── board.json              # компоненты, разъёмы, шаги сборки
    └── targets/                # (опционально) эталонное фото и цели распознавания
        ├── board.jpg           # фото платы, к которому привязаны region разъёмов
        └── board.mind          # цель MindAR, скомпилированная из board.jpg
```

## Формат `board.json`

- `components` — что устанавливается (`id`, `name`, `icons.{ios,android,web}`).
- `connectors` — разъёмы на плате; `componentId` ссылается на компонент, `region` — необязательная область на `targets/board.jpg` в нормированных координатах 0…1.
- `steps` — шаги сценария в порядке выполнения; `connectorId` ссылается на разъём, `manualPage` — печатная страница руководства.

Все `id` — kebab-case, уникальны в пределах своего списка.

## Добавить плату

1. Создать `boards/<board-id>/board.json` по схеме.
2. Добавить `<board-id>` в `index.json`.
3. Для AR в web: положить `targets/board.jpg`, скомпилировать `targets/board.mind` в [MindAR Image Targets Compiler](https://hiukim.github.io/mind-ar-js-doc/tools/compile) и разметить `region` разъёмов.
4. `node shared_boards/scripts/validate.mjs`.
