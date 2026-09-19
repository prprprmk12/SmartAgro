# SmartAgro AI Advisor

Веб-дашборд для мониторинга полей Акмолинской области: спутниковые индексы NDVI/NDWI/EVI, прогноз урожайности, климатические риски, агрономические задачи и экономика хозяйства.

---

## Быстрый старт

```powershell
# 1. Установить зависимости
npm install

# 2. Скопировать конфигурацию
copy .env.example .env

# 3. Прописать в .env нужные ключи (минимум — MONGODB_URI)
# Для demo без Sentinel Hub и OpenAI ключи не нужны

# 4. Запустить всё одной командой
npm run dev:full
```

Открой **http://localhost:5173/** в браузере.

---

## Переменные окружения

Скопируй `.env.example` → `.env` и заполни нужные строки:

| Переменная | Обязательна | Описание |
|---|---|---|
| `MONGODB_URI` | ✅ | URI подключения к MongoDB. Пример: `mongodb://localhost:27017` или Atlas SRV |
| `MONGODB_DB` | Нет | Имя базы данных (по умолчанию `smartagro`) |
| `PORT` | Нет | Порт backend (по умолчанию `3001`) |
| `OPENAI_API_KEY` | Нет | Ключ OpenAI. Без него AI работает в demo-режиме с rule-based ответами |
| `OPENAI_MODEL` | Нет | Модель OpenAI (по умолчанию `gpt-4o-mini`) |
| `SENTINEL_INSTANCE_ID` | Нет | Instance ID Sentinel Hub. Без него индексы — demo-данные |
| `SENTINEL_CLIENT_ID` | Нет | Client ID OAuth Sentinel Hub |
| `SENTINEL_CLIENT_SECRET` | Нет | Client Secret OAuth Sentinel Hub |
| `VITE_YANDEX_MAPS_API_KEY` | Нет | Ключ Яндекс.Карт. Без него карта не отображается |

> ⚠️ Никогда не коммить `.env` в git. Файл уже добавлен в `.gitignore`.

### Получение ключей

**MongoDB Atlas (бесплатный tier):**
1. Зарегистрируйся на [cloud.mongodb.com](https://cloud.mongodb.com)
2. Создай кластер M0 (Free)
3. Database Access → Add user
4. Network Access → Allow from anywhere (0.0.0.0/0)
5. Скопируй SRV строку: `mongodb+srv://user:pass@cluster.mongodb.net/?appName=App`

**Яндекс.Карты:**
1. [developer.tech.yandex.ru](https://developer.tech.yandex.ru/) → Подключить API
2. Выбери «JavaScript API и HTTP Геокодер»
3. Скопируй ключ в `VITE_YANDEX_MAPS_API_KEY`

**Sentinel Hub:**
1. Зарегистрируйся на [apps.sentinel-hub.com](https://apps.sentinel-hub.com/dashboard/)
2. User Settings → OAuth Clients → Create client
3. Скопируй `Client ID` и `Client Secret`
4. Создай Configuration (Instance) → скопируй Instance ID

**OpenAI:**
1. [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create new secret key → скопируй в `OPENAI_API_KEY`

---

## Запуск по частям

```powershell
# Только backend API (порт 3001)
npm run server

# Только frontend Vite dev-server (порт 5173)
npm run dev

# Оба вместе
npm run dev:full

# Production build
npm run build
npm run preview
```

---

## Demo-режим (без ключей)

Приложение полностью работает без платных ключей:

| Функция | Без ключей | С ключами |
|---|---|---|
| Карта полей | Текстовая заглушка | Яндекс.Карты со спутником |
| NDVI/NDWI/EVI | Demo-данные (расчётные) | Реальные снимки Sentinel Hub |
| AI-агент | Rule-based ответы на RU | GPT-4o-mini через OpenAI |
| База данных | Требуется MongoDB | — |
| Погода | Open-Meteo (бесплатно) | — |

Для входа без регистрации нажми **«Войти в demo-режиме»** на экране авторизации.

---

## Архитектура

```
SmartAgro/
├── src/
│   ├── App.tsx          # Весь frontend (React + TypeScript)
│   └── styles.css       # Стили
├── server/
│   └── index.mjs        # Express backend + MongoDB
├── .env.example         # Шаблон переменных окружения
├── vite.config.ts       # Vite + proxy /api → :3001
└── package.json
```

**Стек:**
- Frontend: React 19 + TypeScript + Vite
- Backend: Node.js + Express + MongoDB
- Карты: Яндекс.Карты JS API 2.1
- Погода: Open-Meteo API (без ключа)
- Спутник: Sentinel Hub Statistics API (опционально)
- AI: OpenAI API через backend (опционально)

---

## API endpoints

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/health` | Статус сервера и БД |
| `GET` | `/api/regions` | Список регионов |
| `GET` | `/api/companies?region=...` | Список ТОО |
| `POST` | `/api/auth/register` | Регистрация |
| `POST` | `/api/auth/login` | Вход |
| `GET` | `/api/fields/indices` | Временной ряд индекса (demo) |
| `POST` | `/api/sentinel/indices` | Индексы через Sentinel Hub |
| `POST` | `/api/yield-forecast` | Прогноз урожайности |
| `POST` | `/api/risks` | Климатические риски |
| `POST` | `/api/decision-calendar` | Календарь агрономических решений |
| `POST` | `/api/economics` | Экономика поля |
| `GET` | `/api/tasks` | Список задач |
| `POST` | `/api/tasks` | Создать задачу |
| `PATCH` | `/api/tasks/:id` | Обновить задачу |
| `DELETE` | `/api/tasks/:id` | Удалить задачу |
| `POST` | `/api/ai/chat` | AI-ответ (OpenAI или demo fallback) |

---

## Функционал MVP

- **Обзор** — KPI, карта полей, AI-инсайт, таблица полей, климатические риски, прогноз урожая, экономика
- **Поля** — карта со слоями NDVI / NDWI / EVI / Истинный цвет + таблица
- **Аналитика** — временные ряды индексов, Crop Health Score, риски по декадам, календарь решений, прогноз с доверительным интервалом
- **Погода** — 7-дневный прогноз (день/ночь/ветер/осадки), погодные предупреждения, полный список рисков
- **Операции** — полный CRUD задач, фильтр по полю и статусу, сохранение в MongoDB
- **Сравнение** — мультипольный просмотр: таблица, барчарты NDVI/NDWI/EVI по всем полям
- **Отчёт** — HTML-отчёт (открывается в новой вкладке, печатается как PDF) + `.txt` скачивание
- **AI-агент** — диалог с контекстом выбранного поля, факты и источники в ответе

---

## Demo-поля (тестовые координаты)

| Поле | Координаты | Культура |
|---|---|---|
| Поле 01 | 51.094° с.ш., 71.466° в.д. | Пшеница |
| Поле 02 | 51.097° с.ш., 71.472° в.д. | Пшеница |
| Поле 03 | 51.090° с.ш., 71.460° в.д. | Ячмень |

Все поля находятся в Целиноградском районе Акмолинской области.

---

## Ограничения

- Прогноз урожайности — ориентир, не гарантия урожая
- Спутниковые индексы в demo-режиме — расчётные значения, не реальные снимки
- AI-агент не назначает химические препараты без регистрации и инструкции
- Для страхования и кредитования нужна валидация на исторических данных хозяйства
- Поддерживается только Акмолинская область

---

## Полное техническое задание

[ТЗ_SmartAgro_MVP.md](ТЗ_SmartAgro_MVP.md)
