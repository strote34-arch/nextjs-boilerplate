# Деплой afishiru.ru Backend

## Вариант A: Cloudflare Workers (рекомендуется)

### Шаги:
```bash
# 1. Установить Wrangler
npm install -g wrangler

# 2. Войти в аккаунт Cloudflare
wrangler login

# 3. Создать KV namespace
wrangler kv namespace create AFISHI_KV
wrangler kv namespace create AFISHI_KV --preview
# Скопировать id и preview_id → вставить в wrangler.toml

# 4. Установить секретный ключ API
wrangler secret put API_KEY
# Ввести: ваш_секретный_ключ (мин. 20 символов)

# 5. Задеплоить
cd afishiru-backend
wrangler deploy

# Получите URL вида: https://afishiru-backend.ИМЯ.workers.dev
```

### После деплоя — обновить index.html:
Найти строку:
```js
var BACKEND_URL = 'https://afishiru-backend.YOUR_SUBDOMAIN.workers.dev';
```
Заменить на реальный URL.

---

## Вариант B: Vercel API (если уже есть Vercel)

Файлы в папке `/api/` готовы:
- `api/geo.js` — определить город по IP
- `api/geo-set.js` — сохранить выбор пользователя
- `api/health.js` — проверка работоспособности

### Шаги:
```bash
# Установить Vercel CLI
npm install -g vercel

# Войти
vercel login

# Задеплоить из папки с файлами
vercel --prod

# URL будет: https://afishiru-deploy.vercel.app/api/geo
```

### После деплоя — обновить index.html:
```js
var BACKEND_URL = 'https://ВАШ-ПРОЕКТ.vercel.app';
```

### Тест API:
```
GET https://ВАШ-ПРОЕКТ.vercel.app/api/health
GET https://ВАШ-ПРОЕКТ.vercel.app/api/geo
```

---

## Что делает API

| Endpoint | Метод | Что делает |
|---|---|---|
| `/api/geo` | GET | Определить город по IP посетителя |
| `/api/geo-set` | POST | Сохранить выбор города пользователя |
| `/api/health` | GET | Проверка работоспособности |

## Бесплатные лимиты

| Платформа | Запросов/день | Хранилище |
|---|---|---|
| Cloudflare Workers | 100,000 | KV 1GB |
| Vercel Serverless | 100,000 | - |

