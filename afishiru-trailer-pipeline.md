# Архитектура YouTube Trailer Pipeline — afishiru

## Схема работы (ежедневно в 13:00)

1. Vercel Cron Job → /api/trailer-sync.js
2. → TMDB API: фильмы в кинотеатрах РФ (ближайшие 2 месяца)
3. → YouTube Data API: проверить @afishiru канал
4. → Если трейлер есть на @afishiru → взять ссылку
5. → Если нет → найти русский трейлер на YouTube → сохранить ссылку
6. → Обновить базу фильмов (Cloudflare KV или Worker)

## Что НУЖНО для запуска:
- TMDB API Key (бесплатно: themoviedb.org/settings/api)  
- YouTube Data API Key (бесплатно: console.cloud.google.com)
- YouTube OAuth2 (для загрузки на @afishiru канал)
