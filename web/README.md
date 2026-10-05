# ConnectAR — Web (GitHub Pages)

Статическая версия без сборщика: ES-модули, [MindAR](https://github.com/hiukim/mind-ar-js) + three.js с CDN (грузятся только при открытии камеры), данные — из [`../shared_boards`](../shared_boards). Реализует [дизайн AR-распознавания](../docs/design-doc.md).

- **Сборка** — выбор компонентов, чек-лист шагов, экран инструкции. Прогресс и выбор хранятся в `localStorage`.
- **Камера** — AR по эталону платы: подсветки разъёмов (three.js) и HTML-метки поверх видео; текущий шаг ярче, выполненные приглушены. «Заморозить» — снимок кадра с метками в перспективе, дальше зум и тапы как в фото-режиме.
- **Фото-режим** — запасной путь при любой ошибке (нет эталона, нет доступа к камере, браузер без WebGL, долгий поиск): снимок или фото из галереи, метки ставятся вручную.

```
src/
├── app.js          # вкладки, чек-лист, экран инструкции
├── session.js      # сессия сборки (выбранные компоненты, выполненные шаги)
├── layout.js       # BoardLayout: rectMm → координаты якоря
├── markers.js      # состояния меток current/done/pending, попадание тапа
├── ar.js           # Tracker + Highlight + Labels на MindAR, снимок кадра
├── camera.js       # вкладка «Камера»: состояния, ошибки, таймеры, заморозка
└── photo-view.js   # BoardPhotoView(image, markers): зум, перемещение, тапы
```

## Локальный запуск

Нужен HTTP-сервер из корня репозитория (камера требует `localhost` или HTTPS):

```sh
npx serve .        # затем открыть http://localhost:3000/web/
```

AR включается, если у платы в `board.json` есть `target` и рядом лежит скомпилированный `targets.mind`:

```sh
cd web && npm ci
npm run compile-targets   # target.jpg → shared_boards/boards/<id>/targets.mind (в git не коммитится)
```

## Тесты

```sh
cd web && npm test        # Vitest: общие фикстуры BoardLayout, логика меток, сессия
```

## Публикация

Workflow `.github/workflows/web.yml`: валидация `shared_boards` → `npm test` → сборка `_site` из `web/` и `shared_boards/` → компиляция `targets.mind` офлайн-компилятором MindAR под Node → деплой на GitHub Pages. В настройках репозитория: Settings → Pages → Source: **GitHub Actions**.
