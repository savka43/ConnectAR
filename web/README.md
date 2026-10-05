# ConnectAR — Web (GitHub Pages)

Статическая версия без сборки: [MindAR](https://github.com/hiukim/mind-ar-js) + A-Frame с CDN, данные — из [`../shared_boards`](../shared_boards).

- Если у платы есть `targets/board.mind`, страница запускает камеру и показывает метки разъёмов (по `region`) поверх распознанной платы.
- Без цели MindAR работает режим инструкций и чек-листа; прогресс хранится в `localStorage`.

## Локальный запуск

Нужен HTTP-сервер из корня репозитория (камера требует `localhost` или HTTPS):

```sh
npx serve .        # затем открыть http://localhost:3000/web/
```

## Публикация

Workflow `.github/workflows/web.yml` собирает `_site` из `web/` и `shared_boards/` и публикует на GitHub Pages. В настройках репозитория: Settings → Pages → Source: **GitHub Actions**.
