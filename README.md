# Копейка 🪙

Telegram Mini App для учёта общих трат в компании: группы, траты с делением поровну, долями или точными суммами, балансы, минимальный план переводов и уведомления от бота.

## Как устроено

```
web/      Mini App: React + Vite + TypeScript, telegram-web-app.js
server/   API (Hono) + бот (grammY, long polling) + SQLite (встроенный node:sqlite)
shared/   Расчёты: деление суммы, балансы, план переводов (используются и сервером, и фронтом)
```

- Деньги хранятся целыми числами в копейках/центах.
- Пользователь авторизуется подписью Telegram `initData` (заголовок `Authorization: tma <initData>`), сервер проверяет её токеном бота.
- Приглашение — ссылка `t.me/<бот>/<short_name>?startapp=<код>`. По ней Mini App открывает экран вступления, где можно выбрать себя среди участников, добавленных по имени.
- В продакшене один контейнер: Node отдаёт статику фронта, API на `/api` и запускает бота.

## Локальная разработка

```bash
npm install
cp .env.example .env     # заполнить; для работы в браузере добавить DEV_AUTH=1 и BOT_POLLING=0
npm run dev:server       # API на :3000
npm run dev:web          # Mini App на :5173 (проксирует /api на :3000)
```

В обычном браузере открывай `http://localhost:5173/?dev=1`, второй пользователь — `?dev=2`, приглашение — `?dev=2&startapp=<код>`.

Git-хук pre-push ставится сам при `npm install` и гоняет `npm run check` перед каждым пушем. В крайнем случае обойти можно через `git push --no-verify`.

Чтобы проверить внутри Telegram, нужен HTTPS: например `cloudflared tunnel --url http://localhost:5173` и временно указать этот адрес в @BotFather (лучше на отдельном тестовом боте).

```bash
npm test          # тесты расчётов и проверки initData
npm run typecheck
```

## Деплой

Образ собирается GitHub Actions при каждом пуше в `main` и публикуется в GitHub Container Registry (amd64 и arm64):

- `ghcr.io/web-usov/kopeika:latest` — последняя версия из `main`;
- `ghcr.io/web-usov/kopeika:sha-<коммит>` — конкретная сборка, для отката;
- `ghcr.io/web-usov/kopeika:1.2.3` — если поставить git-тег `v1.2.3`.

```bash
cp .env.example .env   # BOT_TOKEN, APP_URL, APP_SHORT_NAME
docker compose pull && docker compose up -d
```

В Portainer можно вставить [docker-compose.yml](docker-compose.yml) как stack, а переменные из `.env.example` задать в Environment variables. Обновление: pull + redeploy стека.

Собрать образ локально: `docker build -t kopeika .`

Контейнер слушает порт `3000`, база лежит в volume `kopeika-data` (`/data/kopeika.db`). Для бэкапа достаточно скопировать этот файл. HTTPS и домен настраиваются в Traefik.

Проверка: `GET /healthz` → `ok`.

## Настройка бота в @BotFather

1. `/newbot` → токен в `BOT_TOKEN`.
2. `/newapp` → URL `https://kopeika.usov-home.ru`, short name → в `APP_SHORT_NAME`.
3. При старте сервер сам ставит кнопку меню бота, ведущую на `APP_URL`.
