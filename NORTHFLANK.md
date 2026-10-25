# SmartAgro на Northflank

Развёртывание текущего проекта: один постоянно работающий сервис Node.js
(API и React на одном домене) и новая пустая PostgreSQL. Миграция Railway не нужна.

## 1. Обновить исходники GitHub

Репозиторий: https://github.com/prprprmk12/SmartAgro, ветка `main`.
Загрузите текущую локальную версию: `src`, `server`, `package.json`,
`package-lock.json`, конфигурацию Vite/TypeScript, `index.html`, `Dockerfile`,
`.dockerignore` и документацию. Только добавления Dockerfile недостаточно,
если в GitHub остался старый backend с MongoDB.

Не загружайте `node_modules`, `.env` и ключи. `dist` собирается на Northflank.
Файлы Railway/Render не используются при сборке Dockerfile.

## 2. Создать PostgreSQL

В Northflank создайте проект `smartagro`, затем **Create new → Addon → PostgreSQL**.
Имя базы-сервиса: `smartagro-db`. Оставьте базу доступной только внутри проекта.
Создайте runtime secret group и подключите connection secret `POSTGRES_URI`
из этого addon с alias **DATABASE_URL**. Группу нужно привязать к приложению.
Используйте готовую строку подключения, сохраняя её параметры TLS.

Новая база пустая: таблицы создаст backend при первом запуске, затем
зарегистрируйте новый аккаунт и хозяйство. Старые аккаунты Railway здесь отсутствуют.

## 3. Создать приложение

**Create new → Service → Combined**. Подключите GitHub и выберите репозиторий выше.

| Настройка | Значение |
|---|---|
| Name | `smartagro` |
| Branch | `main` |
| Build | Dockerfile |
| Dockerfile path | `/Dockerfile` (файл в корне репозитория) |
| Build context / working directory | `/` (корень репозитория) |
| Command override | Не задавать: команда уже есть в Dockerfile |
| Public port | `3001`, протокол HTTP |
| Instances | `1` для начала |

Dockerfile собирает frontend, затем запускает `node server/index.mjs`.
Приложение слушает `0.0.0.0:3001`. HTTPS обслуживает Northflank.
Отдельный frontend-сервис, `VITE_API_URL` и постоянный диск приложения не нужны:
данные хранятся в PostgreSQL, фотографии — в S3.

## 4. Runtime variables

Обязательно подключите `DATABASE_URL` из secret group. `NODE_ENV=production`
и `PORT=3001` уже заданы в Dockerfile; если задаёте их в панели, значения должны совпадать.
Все секреты вводятся в runtime variables, не в build arguments и не в GitHub.

- `CDSE_CLIENT_ID`, `CDSE_CLIENT_SECRET`: включают спутниковые данные.
- `CDSE_AUTO_SYNC=true`, `CDSE_AUTO_SYNC_HOURS=24`: фоновое обновление.
- `OPENAI_API_KEY`: AI и анализ фото; без ключа работает ограниченный текстовый режим.
- `OPENAI_MODEL`: необязательная настройка модели, по умолчанию `gpt-4o-mini`.
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`: приватное S3-совместимое хранилище фото.
  Endpoint должен быть доступен и серверу, и браузеру: фото открываются по подписанным URL.
  `S3_FORCE_PATH_STYLE=true` нужен только если это требует ваш провайдер S3.

Первый запуск возможен только с PostgreSQL. Фото, CDSE и внешний AI можно подключить позже.
Не включайте сон/масштабирование до нуля, если требуется автообновление по расписанию.

## 5. Health check и проверка

В **Health checks** добавьте readiness probe: HTTP, порт `3001`,
путь `/api/health`, initial delay `15` секунд, period `30`, timeout `10`,
failure threshold `3`. Проверка подтверждает доступность PostgreSQL.
Docker HEALTHCHECK автоматически не предполагается: настройте probe в панели.

После успешной сборки откройте публичный URL сервиса:

1. `/api/health` должен вернуть `ok: true`, `mode: postgresql`.
2. Главная страница должна показать вход/регистрацию.
3. Создайте хозяйство и поле; после повторного входа данные должны сохраниться.
4. После подключения CDSE проверьте статус автообновления в «Аналитике».

Если запуск падает с `Set DATABASE_URL`, проверьте привязку runtime secret group.
Если страница недоступна, проверьте public HTTP port `3001`.
Если возникла ошибка TLS PostgreSQL, проверьте исходный `POSTGRES_URI` и параметры
сертификата в addon; не отключайте проверку сертификатов глобально.

## Документация Northflank

- [Сборка и публикация](https://northflank.com/docs/v1/application/getting-started/build-and-deploy-your-code)
- [PostgreSQL и connection secrets](https://northflank.com/docs/v1/application/databases-and-persistence/deploy-databases-on-northflank/deploy-postgresql-on-northflank)
- [Health checks](https://northflank.com/docs/v1/application/observe/configure-health-checks)
