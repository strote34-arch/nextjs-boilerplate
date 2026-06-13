#!/usr/bin/env python3
"""
tmdb_filter.py — Фильтр TMDB для пайплайна @afishiru
Использование:
  python tmdb_filter.py > films_to_download.json
  python tmdb_filter.py --check  # проверить какие уже есть на канале
"""

import json
import urllib.request
import ssl
import sys
import os
from datetime import datetime, timedelta

# ── Настройки ────────────────────────────────────────────────
TMDB_KEY = "9b121a7c344eeb23baad7647d6b2eabe"
YT_KEY   = "AIzaSyDV8Fxtu4FwVvUOHcDeNoNXad5CKkpxi4E"
AFISHIRU_CHANNEL_ID = "UC6Lc1N2a72hWWroW6Afn2xA"
VERCEL_SYNC_URL = "https://afishiru-v12.vercel.app/api/trailer-sync"

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


def tmdb_get(path, params=""):
    url = f"https://api.themoviedb.org/3{path}?api_key={TMDB_KEY}&language=ru-RU{params}"
    r = urllib.request.urlopen(url, timeout=15, context=ctx)
    return json.loads(r.read())


def get_target_films():
    """Получить фильмы в кино + предстоящие (следующие 12 месяцев)"""
    films = {}

    # Сейчас в кино
    for page in range(1, 4):
        data = tmdb_get("/movie/now_playing", f"&page={page}")
        for m in data.get("results", []):
            films[m["id"]] = {
                "id": m["id"],
                "title_ru": m.get("title", ""),
                "title_en": m.get("original_title", ""),
                "year": (m.get("release_date") or "")[:4],
                "release_date": m.get("release_date", ""),
                "status": "now_playing",
                "poster": f"https://image.tmdb.org/t/p/w342{m['poster_path']}" if m.get("poster_path") else "",
                "rating": m.get("vote_average", 0),
            }

    # Скоро в кино (12 месяцев)
    today = datetime.now()
    end_date = (today + timedelta(days=365)).strftime("%Y-%m-%d")
    for page in range(1, 6):
        data = tmdb_get("/movie/upcoming", f"&page={page}&region=RU")
        for m in data.get("results", []):
            if m["id"] not in films:
                rel = m.get("release_date", "")
                if rel and rel <= end_date:
                    films[m["id"]] = {
                        "id": m["id"],
                        "title_ru": m.get("title", ""),
                        "title_en": m.get("original_title", ""),
                        "year": rel[:4],
                        "release_date": rel,
                        "status": "upcoming",
                        "poster": f"https://image.tmdb.org/t/p/w342{m['poster_path']}" if m.get("poster_path") else "",
                        "rating": m.get("vote_average", 0),
                    }

    all_films = list(films.values())
    print(f"[TMDB] Найдено фильмов до фильтрации: {len(all_films)}", file=sys.stderr)

    # Фильтр: оставить только с рейтингом >= 5.0 ИЛИ с кириллицей в названии
    import re as _re
    def is_relevant(f):
        rating = f.get("rating", 0) or 0
        title  = f.get("title_ru", "") or ""
        has_cyrillic = bool(_re.search(r"[а-яёА-ЯЁ]", title))
        return rating >= 5.0 or has_cyrillic

    filtered = [f for f in all_films if is_relevant(f)]
    skipped  = len(all_films) - len(filtered)
    if skipped:
        print(f"[TMDB] Отфильтровано {skipped} нерелевантных (рейтинг<5 и нет рус.названия)", file=sys.stderr)
    print(f"[TMDB] Итого после фильтрации: {len(filtered)} фильмов", file=sys.stderr)
    return filtered


def get_afishiru_videos():
    """Получить все видео с канала @afishiru"""
    videos = {}
    page_token = ""
    while True:
        url = (f"https://www.googleapis.com/youtube/v3/search"
               f"?part=snippet&channelId={AFISHIRU_CHANNEL_ID}"
               f"&maxResults=50&order=date&type=video&key={YT_KEY}"
               + (f"&pageToken={page_token}" if page_token else ""))
        try:
            r = urllib.request.urlopen(url, timeout=15, context=ctx)
            data = json.loads(r.read())
            for item in data.get("items", []):
                vid_id = item["id"].get("videoId", "")
                title = item["snippet"]["title"].lower()
                videos[vid_id] = {
                    "video_id": vid_id,
                    "title": item["snippet"]["title"],
                    "title_lower": title,
                    "url": f"https://www.youtube.com/watch?v={vid_id}",
                    "published": item["snippet"]["publishedAt"][:10],
                }
            page_token = data.get("nextPageToken", "")
            if not page_token:
                break
        except Exception as e:
            print(f"[YT] Ошибка: {e}", file=sys.stderr)
            break
    return videos


def match_film_to_video(film, videos):
    """Найти трейлер фильма среди видео @afishiru"""
    title_ru = film["title_ru"].lower()
    title_en = film["title_en"].lower()
    # Убрать лишние слова
    for stop in [":", "—", "-", ".", ",", "!", "?"]:
        title_ru = title_ru.replace(stop, " ")
        title_en = title_en.replace(stop, " ")
    title_ru = " ".join(title_ru.split())
    title_en = " ".join(title_en.split())

    best = None
    for vid in videos.values():
        vt = vid["title_lower"]
        # Точное вхождение русского названия
        if len(title_ru) > 4 and title_ru in vt:
            return vid
        # Точное вхождение английского
        if len(title_en) > 4 and title_en in vt:
            return vid
        # Совпадение первых слов (для длинных названий)
        words_ru = title_ru.split()[:3]
        if len(words_ru) >= 2 and all(w in vt for w in words_ru):
            if best is None:
                best = vid
    return best


def notify_vercel():
    """Триггерим синхронизацию трейлеров на сайте"""
    try:
        r = urllib.request.urlopen(VERCEL_SYNC_URL, timeout=60, context=ctx)
        data = json.loads(r.read())
        print(f"[VERCEL] Синхронизация: total={data['stats']['total']}, "
              f"afishiru={data['stats']['afishiru']}")
        return data
    except Exception as e:
        print(f"[VERCEL] Ошибка синхронизации: {e}", file=sys.stderr)
        return None


def main():
    check_mode = "--check" in sys.argv
    notify_mode = "--notify" in sys.argv
    missing_only = "--missing" in sys.argv

    print("[TMDB] Получаем список фильмов...", file=sys.stderr)
    films = get_target_films()
    print(f"[TMDB] Найдено фильмов: {len(films)}", file=sys.stderr)

    if check_mode or missing_only:
        print("[YT] Получаем видео с @afishiru...", file=sys.stderr)
        videos = get_afishiru_videos()
        print(f"[YT] Видео на канале: {len(videos)}", file=sys.stderr)

        result = []
        for film in sorted(films, key=lambda x: x.get("release_date",""), reverse=True):
            matched = match_film_to_video(film, videos)
            film["trailer"] = {
                "video_id": matched["video_id"],
                "url": matched["url"],
                "source": "afishiru_channel",
                "yt_title": matched["title"],
            } if matched else None
            if missing_only and matched:
                continue
            result.append(film)

        # Только JSON в stdout — для pipe
        print(json.dumps(result, ensure_ascii=False, indent=2))

        if missing_only:
            missing = [f for f in result if not f.get("trailer")]
            print(f"\n[ОТЧЁТ] Нужен трейлер: {len(missing)} фильмов", file=sys.stderr)
            print("\nСписок для скачивания:", file=sys.stderr)
            for f in missing[:20]:
                search_q = f"{f['title_ru']} трейлер официальный {f['year']}"
                print(f"  • {f['title_ru']} ({f['year']}) [{f['status']}]", file=sys.stderr)
                print(f"    https://www.youtube.com/results?search_query={urllib.parse.quote(search_q)}", file=sys.stderr)

    elif notify_mode:
        print("[VERCEL] Запускаем синхронизацию трейлеров...", file=sys.stderr)
        notify_vercel()

    else:
        output = []
        for film in sorted(films, key=lambda x: x.get("release_date",""), reverse=True):
            output.append({
                "title_ru": film["title_ru"],
                "title_en": film["title_en"],
                "year": film["year"],
                "release_date": film["release_date"],
                "status": film["status"],
                "search_query": f"{film['title_ru']} трейлер официальный",
                "search_query_en": f"{film['title_en']} official trailer",
            })
        print(json.dumps(output, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    import urllib.parse
    main()
