#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cinema_trailers.py — C:\afishiru\
Берёт фильмы из cinema.html на GitHub, скачивает трейлеры,
заливает на @afishiru, прописывает trailerYT обратно.

  python cinema_trailers.py --dry-run        # тест, ничего не меняет
  python cinema_trailers.py                  # только фильмы без trailerYT
  python cinema_trailers.py --force          # перезалить ВСЕ 12 фильмов
  python cinema_trailers.py --force --dry-run
"""
import os, re, json, sys, time, base64, logging, subprocess
from datetime import datetime

# ══════════════════════════════════════════════════════════════
# КОНФИГ
# ══════════════════════════════════════════════════════════════
CONFIG = {
    # Те же ключи что в run_pipeline.py
    "YT_API_KEYS": [
        "AIzaSy...",   # ключ 1
        "AIzaSy...",   # ключ 2 (резервный)
    ],
    # Запусти yt_auth.py один раз → файл появится сам
    "YT_OAUTH_TOKEN_FILE": r"C:\afishiru\yt_token_afishiru.json",
    # youtube.com/@afishiru → ПКМ → Просмотр кода → найди "channelId"
    "AFISHIRU_CHANNEL_ID": "UCxxxxxxxxxxxxxxxxxxxxxxxx",
    # GitHub
    "GH_TOKEN":  "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",
    "GH_OWNER":  "strote34-arch",
    "GH_REPO":   "nextjs-boilerplate",
    "GH_FILE":   "cinema.html",
    "GH_BRANCH": "main",
    # Временная папка для скачанных видео
    "TMP_DIR": r"C:\afishiru\cinema_tmp",
    "LOG_FILE": r"C:\afishiru\logs\cinema_trailers.log",
}

# ── логгер ────────────────────────────────────────────────────
os.makedirs(os.path.dirname(CONFIG["LOG_FILE"]), exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(CONFIG["LOG_FILE"], encoding="utf-8"),
        logging.StreamHandler(),
    ]
)
log = logging.getLogger("cinema")

# ══════════════════════════════════════════════════════════════
# 1. GITHUB
# ══════════════════════════════════════════════════════════════
def gh_get():
    import urllib.request
    url = (f"https://api.github.com/repos/{CONFIG['GH_OWNER']}/"
           f"{CONFIG['GH_REPO']}/contents/{CONFIG['GH_FILE']}"
           f"?ref={CONFIG['GH_BRANCH']}")
    req = urllib.request.Request(url, headers={
        "Authorization": f"token {CONFIG['GH_TOKEN']}",
        "Accept": "application/vnd.github.v3+json",
    })
    with urllib.request.urlopen(req) as r:
        d = json.loads(r.read())
    return base64.b64decode(d["content"]).decode("utf-8"), d["sha"]

def gh_push(html, sha, msg):
    import urllib.request
    url = (f"https://api.github.com/repos/{CONFIG['GH_OWNER']}/"
           f"{CONFIG['GH_REPO']}/contents/{CONFIG['GH_FILE']}")
    body = json.dumps({
        "message": msg,
        "content": base64.b64encode(html.encode()).decode(),
        "sha": sha, "branch": CONFIG["GH_BRANCH"],
    }).encode()
    req = urllib.request.Request(url, data=body, method="PUT", headers={
        "Authorization": f"token {CONFIG['GH_TOKEN']}",
        "Content-Type": "application/json",
        "Accept": "application/vnd.github.v3+json",
    })
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

# ══════════════════════════════════════════════════════════════
# 2. РАЗБОР ФИЛЬМОВ
# ══════════════════════════════════════════════════════════════
def parse_films(html):
    pos = html.find("const FILMS = [")
    if pos < 0:
        log.error("const FILMS не найден!")
        return []
    films, depth, start = [], 0, None
    for i, ch in enumerate(html[pos:], pos):
        if ch == '{':
            if depth == 0: start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and start:
                obj = html[start:i+1]
                f = _obj(obj)
                if f: films.append(f)
                start = None
        elif ch == ']' and depth == 0:
            break
    return films

def _obj(s):
    def g(k): m = re.search(rf"{k}:\s*'([^']*)'", s); return m.group(1) if m else ''
    t = g('title')
    return None if not t else {
        'title': t, 'id': g('id'), 'year': g('year'),
        'trailerYT': g('trailerYT'), '_obj': s,
    }

# ══════════════════════════════════════════════════════════════
# 3. YOUTUBE API
# ══════════════════════════════════════════════════════════════
_ki = 0
def yt(ep, params):
    import urllib.request, urllib.parse
    global _ki
    for _ in range(len(CONFIG["YT_API_KEYS"])):
        key = CONFIG["YT_API_KEYS"][_ki % len(CONFIG["YT_API_KEYS"])]
        params["key"] = key
        url = f"https://www.googleapis.com/youtube/v3/{ep}?" + urllib.parse.urlencode(params)
        try:
            with urllib.request.urlopen(url) as r:
                return json.loads(r.read())
        except Exception as e:
            if "quota" in str(e).lower() or "403" in str(e):
                log.warning(f"Квота ключа #{_ki}, переключаю")
                _ki += 1
            else:
                log.error(f"YT API: {e}")
                return {}
    return {}

def find_trailer(film):
    t, y = film['title'], film.get('year', '')
    for q in [f"{t} {y} трейлер на русском", f"{t} {y} official trailer", f"{t} трейлер"]:
        log.info(f"  🔍 {q!r}")
        d = yt("search", {"part":"id,snippet","q":q,"type":"video","videoDuration":"short","maxResults":5})
        ids = [it["id"]["videoId"] for it in d.get("items", [])]
        if not ids: continue
        vd = yt("videos", {"part":"contentDetails","id":",".join(ids)})
        for v in vd.get("items", []):
            s = _iso(v["contentDetails"]["duration"])
            if 60 <= s <= 300:
                log.info(f"  ✅ https://youtu.be/{v['id']} ({s}s)")
                return v["id"]
    return ""

def _iso(s):
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", s)
    if not m: return 0
    h, mn, sc = (int(x or 0) for x in m.groups())
    return h*3600 + mn*60 + sc

# ══════════════════════════════════════════════════════════════
# 4. СКАЧАТЬ
# ══════════════════════════════════════════════════════════════
def download(vid, out):
    os.makedirs(out, exist_ok=True)
    tmpl = os.path.join(out, f"{vid}.%(ext)s")
    r = subprocess.run([
        "yt-dlp", f"https://youtube.com/watch?v={vid}",
        "-o", tmpl,
        "-f", "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4", "--no-playlist", "--quiet",
    ], capture_output=True, text=True)
    if r.returncode != 0:
        log.error(f"yt-dlp: {r.stderr[:150]}")
        return ""
    for f in os.listdir(out):
        if f.startswith(vid) and f.endswith(".mp4"):
            p = os.path.join(out, f)
            log.info(f"  ⬇️  {f} ({os.path.getsize(p)//1024//1024}MB)")
            return p
    return ""

# ══════════════════════════════════════════════════════════════
# 5. ЗАГРУЗИТЬ НА @afishiru
# ══════════════════════════════════════════════════════════════
def upload(film, path):
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload
    except ImportError:
        log.error("pip install google-auth-oauthlib google-api-python-client")
        return ""
    tf = CONFIG["YT_OAUTH_TOKEN_FILE"]
    if not os.path.exists(tf):
        log.error(f"Нет токена: {tf}  →  запусти yt_auth.py")
        return ""
    with open(tf) as f: td = json.load(f)
    creds = Credentials(
        token=td.get("access_token"), refresh_token=td.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=td.get("client_id"), client_secret=td.get("client_secret"),
        scopes=["https://www.googleapis.com/auth/youtube.upload"],
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        td["access_token"] = creds.token
        with open(tf, "w") as f: json.dump(td, f, indent=2)
    yt_svc = build("youtube", "v3", credentials=creds)
    title = f"🎬 {film['title']} — Официальный трейлер ({film.get('year','2026')})"
    desc  = (f"{film.get('desc','')}\n\n"
             f"📅 В прокате: {film.get('date','')}\n\n"
             f"🍿 Афиша Волгограда → https://афи.рф/cinema\n\n"
             f"#трейлер #{film['title'].replace(' ','')} #кино #Волгоград")
    log.info(f"  ⬆️  Загружаю: {title[:60]!r}")
    media = MediaFileUpload(path, mimetype="video/mp4", resumable=True, chunksize=5*1024*1024)
    req = yt_svc.videos().insert(
        part="snippet,status",
        body={
            "snippet": {"title": title[:100], "description": desc[:5000],
                        "tags": ["трейлер", film['title'], "кино", "Волгоград"],
                        "categoryId": "1", "defaultLanguage": "ru"},
            "status": {"privacyStatus": "public", "selfDeclaredMadeForKids": False},
        },
        media_body=media,
    )
    resp = None
    while resp is None:
        st, resp = req.next_chunk()
        if st: log.info(f"    {int(st.progress()*100)}%")
    vid = resp["id"]
    log.info(f"  ✅ https://youtu.be/{vid}")
    return vid

# ══════════════════════════════════════════════════════════════
# 6. ОБНОВИТЬ HTML
# ══════════════════════════════════════════════════════════════
def patch(html, film, new_id):
    obj = film["_obj"]
    if "trailerYT:" in obj:
        new_obj = re.sub(r"trailerYT:'[^']*'", f"trailerYT:'{new_id}'", obj)
    else:
        new_obj = obj.rstrip().rstrip("}") + f"\n    trailerYT:'{new_id}'\n  }}"
    return html.replace(obj, new_obj, 1)

# ══════════════════════════════════════════════════════════════
# 7. ГЛАВНАЯ ФУНКЦИЯ
# ══════════════════════════════════════════════════════════════
def run(dry_run=False, force=False):
    log.info("=" * 60)
    log.info(f"🎬 Cinema Trailers" +
             (" [DRY RUN]" if dry_run else "") +
             (" [FORCE]"   if force   else ""))
    log.info("=" * 60)

    log.info("📥 GitHub → cinema.html...")
    html, sha = gh_get()
    log.info(f"   {len(html)//1024} KB, SHA {sha[:8]}")

    films = parse_films(html)
    log.info(f"🎥 Фильмов: {len(films)}")
    for f in films:
        log.info(f"   {'✅' if f['trailerYT'] else '❌'} {f['title']}: {f['trailerYT'] or 'нет'}")

    # Что обрабатываем
    if force:
        todo = films
        log.info(f"\n🔴 FORCE: перезаливаем все {len(todo)} фильмов на @afishiru")
    else:
        todo = [f for f in films if not f["trailerYT"]]
        log.info(f"\n🎯 Без trailerYT: {len(todo)}")

    if not todo:
        log.info("\n✅ Нечего делать.")
        log.info("   Хочешь залить все трейлеры на @afishiru?")
        log.info("   → python cinema_trailers.py --force --dry-run  (тест)")
        log.info("   → python cinema_trailers.py --force            (боевой)")
        return

    updated = False
    for film in todo:
        log.info(f"\n{'─'*50}")
        log.info(f"🎬 {film['title']} ({film.get('year','')})")

        # Найти трейлер (использовать существующий если есть)
        src = film["trailerYT"] or find_trailer(film)
        if not src:
            log.warning("  ⚠️ Трейлер не найден, пропускаю")
            continue

        if dry_run:
            log.info(f"  [DRY RUN] Источник: https://youtu.be/{src}")
            log.info(f"  [DRY RUN] Скачал бы и залил бы на @afishiru")
            continue

        # Скачать
        path = download(src, CONFIG["TMP_DIR"])
        if not path:
            log.warning("  ⚠️ Не удалось скачать")
            continue

        # Залить на @afishiru
        new_id = upload(film, path)
        try: os.remove(path)
        except: pass

        if not new_id:
            log.warning("  ⚠️ Не удалось загрузить")
            continue

        html = patch(html, film, new_id)
        updated = True
        log.info(f"  📝 trailerYT → '{new_id}'")
        time.sleep(3)

    if updated:
        msg = f"auto: cinema trailers @afishiru [{datetime.now().strftime('%Y-%m-%d %H:%M')}]"
        log.info(f"\n📤 GitHub push...")
        try:
            gh_push(html, sha, msg)
            log.info("  ✅ Vercel задеплоит автоматически")
        except Exception as e:
            log.error(f"  ❌ Push: {e}")
            bak = os.path.join(CONFIG["TMP_DIR"], "cinema_backup.html")
            open(bak, "w", encoding="utf-8").write(html)
            log.info(f"  💾 Backup: {bak}")

    log.info("\n✅ Готово")

# ══════════════════════════════════════════════════════════════
# yt_auth.py текст (создаётся автоматически)
# ══════════════════════════════════════════════════════════════
YT_AUTH = r'''#!/usr/bin/env python3
"""
yt_auth.py — авторизация для загрузки на @afishiru
---------------------------------------------------
ПОДГОТОВКА (один раз):
1. Перейди на https://console.cloud.google.com/apis/credentials
2. Нажми "+ СОЗДАТЬ УЧЁТНЫЕ ДАННЫЕ" → "Идентификатор клиента OAuth"
3. Тип приложения: "Приложение для компьютеров" → Создать
4. Скачай JSON → переименуй в client_secrets.json
5. Положи в C:\afishiru\client_secrets.json
6. Запусти этот файл: python yt_auth.py

Откроется браузер → войди как @afishiru → разреши доступ.
Токен сохранится и cinema_trailers.py будет его использовать.
"""
import json
from google_auth_oauthlib.flow import InstalledAppFlow

CLIENT_SECRETS = r"C:\afishiru\client_secrets.json"
TOKEN_FILE     = r"C:\afishiru\yt_token_afishiru.json"
SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]

flow  = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRETS, SCOPES)
creds = flow.run_local_server(port=0)

data = {
    "access_token":  creds.token,
    "refresh_token": creds.refresh_token,
    "client_id":     creds.client_id,
    "client_secret": creds.client_secret,
}
with open(TOKEN_FILE, "w") as f:
    json.dump(data, f, indent=2)
print(f"✅ Токен сохранён: {TOKEN_FILE}")
print("Теперь запускай: python cinema_trailers.py --force")
'''

if __name__ == "__main__":
    dry   = "--dry-run" in sys.argv or "-d" in sys.argv
    force = "--force"   in sys.argv or "-f" in sys.argv

    # Создать yt_auth.py если нет
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "yt_auth.py")
    if not os.path.exists(p):
        open(p, "w", encoding="utf-8").write(YT_AUTH)
        print(f"📝 Создан {p}")
        print("   Прочитай инструкцию внутри файла перед запуском!")

    if dry:   print("🔵 DRY RUN — без реальных загрузок")
    if force: print("🔴 FORCE — перезаливаем ВСЕ трейлеры на @afishiru")

    run(dry_run=dry, force=force)
