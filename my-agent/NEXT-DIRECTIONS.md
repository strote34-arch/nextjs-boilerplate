# Next Directions — план версий afisha-trailer-digest

v0 (сегодня) — утренний дайджест: афи.рф → мероприятия без роликов → подбор трейлеров на YouTube → отчёт digest.html с готовым текстом для карточек. Черновик, никаких записей во внешние системы.

## v1 — автозапись ссылок в карточки афи.рф

- **Что:** агент сам прописывает подобранную ссылку в карточку мероприятия через API сайта (у владельца есть API).
- **Почему не в v0:** write-действие во внешнюю систему + нужен ключ API сайта; сначала проверяем качество подбора на черновиках.
- **Как:** 🔐 vault-credential `environment_variable` (имя `AFIRF_API_KEY`, networking limited на хост API) → передать `vault_ids` в session/deployment → добавить в системный промпт шаг «после подбора запиши ссылку в карточку через API» → первое время держать bash за `always_ask`, чтобы подтверждать каждую запись.
- Docs: https://platform.claude.com/docs/en/managed-agents/vaults

## v2 — монтаж роликов (склейка)

- **Что:** агент скачивает подобранные ролики и склеивает их в один (ffmpeg), отдаёт готовые видеофайлы в outputs — владелец заливает на @afishiru вручную.
- **Почему не в v0:** тяжёлый шаг на каждый запуск + скачивание/перезаливка чужих трейлеров — зона Content ID; решение о правовом режиме за владельцем.
- **Как:** environment.packages: `{"apt": ["ffmpeg"], "pip": ["yt-dlp"]}` → шаг в промпте «скачай и склей» → файлы в /mnt/session/outputs/.

## v3 — автозаливка на канал @afishiru

- **Что:** агент сам загружает смонтированный ролик на YouTube-канал и вставляет обратную ссылку на карточку мероприятия в описание видео.
- **Почему не в v0:** нужно OAuth-приложение в Google Cloud (YouTube Data API v3) + refresh-токен аккаунта канала; плюс риск страйков за чужой контент.
- **Как:** 🔐 vault env-var с OAuth-токеном (limited networking: `www.googleapis.com`, `*.googleapis.com`) → загрузка `videos.insert` (part=snippet,status) → гейт `always_ask` на каждую заливку.
- Docs: https://developers.google.com/youtube/v3/docs/videos/insert

## v4 — хардненинг сети

- **Что:** ужать networking среды с unrestricted до списка хостов.
- **Почему не в v0:** пока агент только читает публичный веб, unrestricted допустим.
- **Как:** environment `networking: {"type": "limited", "allowed_hosts": ["xn--80ag3b.xn--p1ai", "www.youtube.com", "*.youtube.com", "*.googlevideo.com", "www.googleapis.com"]}`.

## Всегда

- Перед продвижением новой версии агента в 🗓️ deployment — прогнать `evals/` (`evals/run-evals.sh`) и обновлять деплой только при сохранении вердиктов.
