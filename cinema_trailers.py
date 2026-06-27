#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cinema_trailers.py — Модуль для afishiru pipeline
=====================================================
Что делает:
  1. Читает cinema.html из GitHub репозитория
  2. Находит фильмы без trailerYT (или с чужим трейлером)
  3. Ищет трейлер на YouTube по названию фильма
  4. Скачивает через yt-dlp
  5. Загружает на канал @afishiru
  6. Обновляет cinema.html — прописывает trailerYT: 'новый_id'
  7. Пушит изменения в GitHub → автодеплой на Vercel

Запуск отдельно:
  python cinema_trailers.py

Или из run_pipeline.py:
  from cinema_trailers import run_cinema_module
  run_cinema_module()

Настройка:
  Заполни CONFIG ниже под свои ключи
  (или вынеси в config.py / .env файл)
"""

import os
import re
import json
import time
import base64
import logging
import subprocess
import tempfile
from datetime import datetime

# ──────────────────────────────────────────────────────────────
# КОНФИГУРАЦИЯ — заполни свои значения
# ──────────────────────────────────────────────────────────────
CONFIG = {
    # YouTube Data API v3 (для поиска и загрузки)
    # Получить: https://console.cloud.google.com → APIs → YouTube Data API v3
    "YT_API_KEYS": [
        "AIza...",   # ключ 1 (основной)
        "AIza...",   # ключ 2 (резервный при превышении квоты)
    ],

    # OAuth2 токен для загрузки видео на @afishiru
    # Получить через yt_auth.py (OAuth flow, см. ниже)
    "YT_OAUTH_TOKEN_FILE": r"C:\afishiru\yt_token_afishiru.json",

    # GitHub
    "GH_TOKEN":  "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",
    "GH_OWNER":  "strote34-arch",
    "GH_REPO":   "nextjs-boilerplate",
    "GH_FILE":   "cinema.html",   # путь к файлу в репо
    "GH_BRANCH": "main",

    # Канал @afishiru (Channel ID)
    # Найти: https://www.youtube.com/@afishiru → ПКМ → Просмотр кода → "channelId"
    "AFISHIRU_CHANNEL_ID": "UCxxxxxxxxxxxxxxxxxxxxxxxx",

    # Папка для временных файлов
    "TMP_DIR": r"C:\afishiru\cinema_tmp",

    # Логи
    "LOG_FILE": r"C:\afishiru\logs\cinema_trailers.log",

    # Параметры поиска трейлера
    "SEARCH_SUFFIX": "официальный трейлер",   # добавляется к названию при поиске
    "PREFER_RUSSIAN": True,                   # предпочитать русский дублированный трейлер
    "MAX_DURATION_SEC": 300,                  # не брать видео длиннее 5 минут
    "MIN_DURATION_SEC": 60,                   # не брать видео короче 1 минуты
}

# ──────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(CONFIG["LOG_FILE"], encoding="utf-8"),
        logging.StreamHandler(),
    ] if os.path.isdir(os.path.dirname(CONFIG["LOG_FILE"])) else [
        logging.StreamHandler()
    ]
)
log = logging.getLogger("cinema_trailers")


# ══════════════════════════════════════════════════════════════
# 1. GITHUB — читаем / пишем cinema.html
# ══════════════════════════════════════════════════════════════

def gh_get_file(path=None):
    """Вернуть (content_str, sha) из GitHub."""
    import urllib.request
    path = path or CONFIG["GH_FILE"]
    url = f"https://api.github.com/repos/{CONFIG['GH_OWNER']}/{CONFIG['GH_REPO']}/contents/{path}?ref={CONFIG['GH_BRANCH']}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"token {CONFIG['GH_TOKEN']}",
        "Accept": "application/vnd.github.v3+json",
    })
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
    content = base64.b64decode(data["content"]).decode("utf-8")
    return content, data["sha"]


def gh_push_file(content, sha, commit_msg, path=None):
    """Обновить файл в GitHub."""
    import urllib.request
    path = path or CONFIG["GH_FILE"]
    url = f"https://api.github.com/repos/{CONFIG['GH_OWNER']}/{CONFIG['GH_REPO']}/contents/{path}"
    body = json.dumps({
        "message": commit_msg,
        "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
        "sha": sha,
        "branch": CONFIG["GH_BRANCH"],
    }).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="PUT", headers={
        "Authorization": f"token {CONFIG['GH_TOKEN']}",
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


# ══════════════════════════════════════════════════════════════
# 2. РАЗБОР cinema.html — извлечь фильмы
# ══════════════════════════════════════════════════════════════

def parse_films(html: str) -> list:
    """Вернуть список словарей с данными фильмов."""
    films = []
    # Найти const FILMS = [...]
    pos = html.find("const FILMS = [")
    if pos < 0:
        log.error("const FILMS не найден в cinema.html!")
        return []

    # Извлечь каждый объект {...}
    depth = 0
    start = None
    for i, ch in enumerate(html[pos:], pos):
        if ch == "[" and i == pos + len("const FILMS = "):
            depth = 1
        elif ch == "{" and depth >= 1:
            if depth == 1:
                start = i
            depth += 1
        elif ch == "}" and depth > 1:
            depth -= 1
            if depth == 1 and start is not None:
                obj_str = html[start:i + 1]
                film = _parse_film_obj(obj_str)
                if film:
                    films.append(film)
                start = None
        elif ch == "]" and depth == 1:
            break

    return films


def _parse_film_obj(obj: str) -> dict:
    """Разобрать один объект фильма."""
    def get(key):
        m = re.search(rf"{key}:\s*'([^']*)'", obj)
        return m.group(1) if m else ""

    def get_num(key):
        m = re.search(rf"{key}:\s*([\d.]+)", obj)
        return m.group(1) if m else ""

    title = get("title")
    if not title:
        return None
    return {
        "title":      title,
        "id":         get("id"),
        "year":       get_num("year"),
        "trailerYT":  get("trailerYT"),   # '' если нет
        "endDateISO": get("endDateISO"),
        "_obj_str":   obj,                # для замены
    }


def needs_trailer(film: dict) -> bool:
    """Нужен ли трейлер с @afishiru?"""
    # Нет трейлера вообще
    if not film["trailerYT"]:
        return True
    # Трейлер есть, но не с нашего канала (проверим ниже после загрузки)
    # Пока возвращаем True только если поле пустое
    return False


# ══════════════════════════════════════════════════════════════
# 3. YOUTUBE API — поиск трейлера
# ══════════════════════════════════════════════════════════════

_yt_key_index = 0

def yt_api(endpoint: str, params: dict) -> dict:
    """GET запрос к YouTube Data API с ротацией ключей."""
    import urllib.request
    import urllib.parse
    global _yt_key_index

    for attempt in range(len(CONFIG["YT_API_KEYS"])):
        key = CONFIG["YT_API_KEYS"][_yt_key_index % len(CONFIG["YT_API_KEYS"])]
        params["key"] = key
        url = f"https://www.googleapis.com/youtube/v3/{endpoint}?" + urllib.parse.urlencode(params)
        try:
            with urllib.request.urlopen(url) as resp:
                return json.loads(resp.read())
        except Exception as e:
            err_str = str(e)
            if "quotaExceeded" in err_str or "403" in err_str:
                log.warning(f"Квота API ключа #{_yt_key_index} исчерпана, переключаю")
                _yt_key_index += 1
            else:
                log.error(f"YouTube API ошибка: {e}")
                return {}
    return {}


def find_trailer_on_youtube(film: dict) -> str:
    """Найти YouTube video_id трейлера для фильма. Вернуть '' если не найдено."""
    title = film["title"]
    year  = film.get("year", "")

    # Варианты поисковых запросов (от специфичного к общему)
    queries = []
    if CONFIG["PREFER_RUSSIAN"]:
        queries.append(f"{title} {year} трейлер на русском")
        queries.append(f"{title} трейлер дублированный")
    queries.append(f"{title} {year} official trailer")
    queries.append(f"{title} {year} {CONFIG['SEARCH_SUFFIX']}")
    queries.append(f"{title} трейлер")

    for query in queries:
        log.info(f"  🔍 Поиск: {query!r}")
        data = yt_api("search", {
            "part": "id,snippet",
            "q": query,
            "type": "video",
            "videoDuration": "short",     # до 4 минут
            "maxResults": 10,
            "order": "relevance",
        })

        items = data.get("items", [])
        if not items:
            continue

        # Фильтруем по длительности
        video_ids = [it["id"]["videoId"] for it in items]
        vid_data = yt_api("videos", {
            "part": "contentDetails,statistics",
            "id": ",".join(video_ids),
        })

        for vid in vid_data.get("items", []):
            vid_id  = vid["id"]
            duration = _iso8601_to_sec(vid["contentDetails"]["duration"])
            if duration < CONFIG["MIN_DURATION_SEC"]:
                continue
            if duration > CONFIG["MAX_DURATION_SEC"]:
                continue
            log.info(f"  ✅ Найден трейлер: https://youtu.be/{vid_id} ({duration}s)")
            return vid_id

    log.warning(f"  ❌ Трейлер не найден для {title!r}")
    return ""


def _iso8601_to_sec(iso: str) -> int:
    """PT2M30S → 150"""
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso)
    if not m:
        return 0
    h, mn, s = (int(x or 0) for x in m.groups())
    return h * 3600 + mn * 60 + s


# ══════════════════════════════════════════════════════════════
# 4. yt-dlp — скачиваем трейлер
# ══════════════════════════════════════════════════════════════

def download_trailer(video_id: str, out_dir: str) -> str:
    """Скачать видео через yt-dlp. Вернуть путь к файлу."""
    os.makedirs(out_dir, exist_ok=True)
    out_tmpl = os.path.join(out_dir, f"{video_id}.%(ext)s")
    cmd = [
        "yt-dlp",
        f"https://www.youtube.com/watch?v={video_id}",
        "-o", out_tmpl,
        "-f", "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "--no-playlist",
        "--quiet",
    ]
    log.info(f"  ⬇️  Скачиваю {video_id}...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        log.error(f"  yt-dlp ошибка: {result.stderr[:200]}")
        return ""

    # Найти скачанный файл
    for f in os.listdir(out_dir):
        if f.startswith(video_id) and f.endswith(".mp4"):
            path = os.path.join(out_dir, f)
            size_mb = os.path.getsize(path) / 1024 / 1024
            log.info(f"  ✅ Скачано: {f} ({size_mb:.1f} MB)")
            return path
    return ""


# ══════════════════════════════════════════════════════════════
# 5. YouTube Upload — загружаем на @afishiru
# ══════════════════════════════════════════════════════════════

def upload_to_afishiru(film: dict, file_path: str) -> str:
    """
    Загрузить видео на канал @afishiru.
    Вернуть video_id нового видео.

    Использует google-auth-oauthlib + googleapiclient.
    Установить: pip install google-auth-oauthlib google-api-python-client
    """
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload
    except ImportError:
        log.error("Установите: pip install google-auth-oauthlib google-api-python-client")
        return ""

    # Загружаем сохранённый OAuth токен
    token_file = CONFIG["YT_OAUTH_TOKEN_FILE"]
    if not os.path.exists(token_file):
        log.error(f"OAuth токен не найден: {token_file}")
        log.error("Запусти yt_auth.py для авторизации")
        return ""

    with open(token_file) as f:
        token_data = json.load(f)

    creds = Credentials(
        token=token_data.get("access_token"),
        refresh_token=token_data.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=token_data.get("client_id"),
        client_secret=token_data.get("client_secret"),
        scopes=["https://www.googleapis.com/auth/youtube.upload"],
    )

    # Обновить токен если истёк
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        token_data.update({
            "access_token": creds.token,
            "expiry": creds.expiry.isoformat() if creds.expiry else None,
        })
        with open(token_file, "w") as f:
            json.dump(token_data, f, indent=2)

    youtube = build("youtube", "v3", credentials=creds)

    title_yt = f"🎬 {film['title']} — Официальный трейлер ({film.get('year', '2026')})"
    desc_yt = (
        f"{film.get('desc', '')}\n\n"
        f"🎭 Жанр: {film.get('genre', '')}\n"
        f"🎬 Режиссёр: {film.get('director', '')}\n"
        f"👥 В ролях: {film.get('cast', '')}\n\n"
        f"📅 В прокате: {film.get('date', '')}\n\n"
        f"🍿 Афиша Волгограда — всё о кино:\n"
        f"https://афи.рф/cinema\n\n"
        f"#трейлер #{film['title'].replace(' ', '')} #кино #афиши #Волгоград"
    )

    log.info(f"  ⬆️  Загружаю на @afishiru: {title_yt!r}")

    media = MediaFileUpload(file_path, mimetype="video/mp4", resumable=True, chunksize=5*1024*1024)
    request = youtube.videos().insert(
        part="snippet,status",
        body={
            "snippet": {
                "title":       title_yt[:100],
                "description": desc_yt[:5000],
                "tags":        ["трейлер", film["title"], "кино", "Волгоград", "афиши", str(film.get("year",""))],
                "categoryId":  "1",  # Film & Animation
                "defaultLanguage": "ru",
            },
            "status": {
                "privacyStatus": "public",
                "selfDeclaredMadeForKids": False,
            },
        },
        media_body=media,
    )

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            pct = int(status.progress() * 100)
            log.info(f"    Загрузка: {pct}%")

    new_id = response["id"]
    log.info(f"  ✅ Загружено! https://youtu.be/{new_id}")
    return new_id


# ══════════════════════════════════════════════════════════════
# 6. Обновляем cinema.html — прописываем trailerYT
# ══════════════════════════════════════════════════════════════

def update_trailer_in_html(html: str, film: dict, new_yt_id: str) -> str:
    """Обновить/добавить trailerYT для конкретного фильма в HTML."""
    obj = film["_obj_str"]

    if "trailerYT:" in obj:
        # Заменить существующий
        new_obj = re.sub(r"trailerYT:'[^']*'", f"trailerYT:'{new_yt_id}'", obj)
    else:
        # Добавить перед закрывающей скобкой }
        new_obj = obj.rstrip().rstrip("}") + f"\n    trailerYT:'{new_yt_id}'\n  }}"

    return html.replace(obj, new_obj, 1)


# ══════════════════════════════════════════════════════════════
# 7. ГЛАВНАЯ ФУНКЦИЯ
# ══════════════════════════════════════════════════════════════

def run_cinema_module(dry_run: bool = False):
    """
    Основная точка входа.
    dry_run=True — всё делает, кроме загрузки на YouTube и пуша в GitHub.
    """
    log.info("=" * 60)
    log.info("🎬 Cinema Trailers Module запущен")
    log.info("=" * 60)

    # 1. Получить cinema.html из GitHub
    log.info("📥 Читаю cinema.html из GitHub...")
    try:
        html, sha = gh_get_file()
        log.info(f"   Получено {len(html)//1024} KB, SHA: {sha[:8]}")
    except Exception as e:
        log.error(f"Ошибка GitHub: {e}")
        return

    # 2. Разобрать фильмы
    films = parse_films(html)
    log.info(f"🎥 Найдено фильмов: {len(films)}")

    # 3. Фильтровать — только те, которым нужен трейлер
    to_process = [f for f in films if needs_trailer(f)]
    log.info(f"🎯 Нужен трейлер: {len(to_process)} фильмов")

    if not to_process:
        log.info("✅ Все фильмы уже имеют трейлеры. Выход.")
        return

    updated = False
    tmp_dir = CONFIG["TMP_DIR"]

    for film in to_process:
        log.info(f"\n{'─'*50}")
        log.info(f"🎬 Обрабатываю: {film['title']} ({film.get('year', '')})")

        # 4. Найти трейлер на YouTube
        source_id = find_trailer_on_youtube(film)
        if not source_id:
            log.warning(f"   ⚠️  Пропускаю — трейлер не найден")
            continue

        if dry_run:
            log.info(f"   [DRY RUN] Нашёл source: {source_id}, пропускаю загрузку")
            # Обновляем как будто загрузили
            html = update_trailer_in_html(html, film, source_id)
            updated = True
            continue

        # 5. Скачать
        file_path = download_trailer(source_id, tmp_dir)
        if not file_path:
            log.warning(f"   ⚠️  Не удалось скачать")
            continue

        # 6. Загрузить на @afishiru
        new_yt_id = upload_to_afishiru(film, file_path)

        # Удалить временный файл
        try:
            os.remove(file_path)
        except Exception:
            pass

        if not new_yt_id:
            log.warning(f"   ⚠️  Не удалось загрузить на @afishiru")
            continue

        # 7. Обновить HTML
        html = update_trailer_in_html(html, film, new_yt_id)
        updated = True
        log.info(f"   📝 cinema.html обновлён: trailerYT='{new_yt_id}'")

        # Пауза между фильмами
        time.sleep(5)

    # 8. Пушим обновлённый cinema.html в GitHub
    if updated and not dry_run:
        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        commit_msg = f"auto: обновлены трейлеры в cinema.html [{now}]"
        log.info(f"\n📤 Пушу cinema.html в GitHub: {commit_msg!r}")
        try:
            gh_push_file(html, sha, commit_msg)
            log.info("   ✅ Запушено! Vercel задеплоит автоматически.")
        except Exception as e:
            log.error(f"   ❌ Ошибка пуша: {e}")
            # Сохранить локально как fallback
            backup = os.path.join(tmp_dir, "cinema_backup.html")
            with open(backup, "w", encoding="utf-8") as f:
                f.write(html)
            log.info(f"   💾 Сохранил локально: {backup}")
    elif updated and dry_run:
        log.info("\n[DRY RUN] В реальном режиме запушил бы в GitHub")

    log.info("\n✅ Cinema Trailers Module завершён")


# ══════════════════════════════════════════════════════════════
# ВСПОМОГАТЕЛЬНЫЙ СКРИПТ: yt_auth.py
# Запусти один раз для получения OAuth токена
# ══════════════════════════════════════════════════════════════
YT_AUTH_SCRIPT = '''#!/usr/bin/env python3
"""
yt_auth.py — Получить OAuth токен для загрузки на @afishiru
Запустить один раз на компьютере с браузером.

pip install google-auth-oauthlib google-api-python-client
"""
import json
from google_auth_oauthlib.flow import InstalledAppFlow

# Создай OAuth 2.0 Client ID в Google Cloud Console:
# https://console.cloud.google.com/apis/credentials
# Тип: Desktop App → скачать JSON → назвать client_secrets.json

CLIENT_SECRETS_FILE = r"C:\\afishiru\\client_secrets.json"
TOKEN_FILE = r"C:\\afishiru\\yt_token_afishiru.json"
SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]

flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRETS_FILE, SCOPES)
creds = flow.run_local_server(port=0)

# Сохранить токен
token_data = {
    "access_token":  creds.token,
    "refresh_token": creds.refresh_token,
    "client_id":     creds.client_id,
    "client_secret": creds.client_secret,
    "expiry":        creds.expiry.isoformat() if creds.expiry else None,
}
with open(TOKEN_FILE, "w") as f:
    json.dump(token_data, f, indent=2)

print(f"✅ Токен сохранён: {TOKEN_FILE}")
'''

# ══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import sys

    dry = "--dry-run" in sys.argv or "-d" in sys.argv
    if dry:
        print("🔵 DRY RUN режим — без реальных загрузок")

    # Создать yt_auth.py если не существует
    auth_file = os.path.join(os.path.dirname(__file__), "yt_auth.py")
    if not os.path.exists(auth_file):
        with open(auth_file, "w", encoding="utf-8") as f:
            f.write(YT_AUTH_SCRIPT)
        print(f"📝 Создан yt_auth.py — запусти его для OAuth авторизации")

    run_cinema_module(dry_run=dry)
