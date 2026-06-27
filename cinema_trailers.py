#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cinema_trailers.py — модуль для C:\afishiru\
Берёт фильмы из cinema.html на GitHub, скачивает трейлеры,
заливает на @afishiru, прописывает trailerYT обратно в HTML.

Запуск:
  python cinema_trailers.py --dry-run   # тест без загрузки
  python cinema_trailers.py             # боевой режим
"""

import os, re, json, time, base64, logging, subprocess
from datetime import datetime

# ══════════════════════════════════════════════════════════════
# КОНФИГ — заполни свои значения
# ══════════════════════════════════════════════════════════════
CONFIG = {
    # ── YouTube API ────────────────────────────────────────────
    # Те же ключи что в C:\afishiru\run_pipeline.py
    "YT_API_KEYS": [
        "AIzaSy...",   # ключ 1 (основной)
        "AIzaSy...",   # ключ 2 (резервный)
    ],

    # ── OAuth токен для @afishiru ──────────────────────────────
    # Запусти yt_auth.py один раз → файл появится автоматически
    "YT_OAUTH_TOKEN_FILE": r"C:\afishiru\yt_token_afishiru.json",

    # ── ID канала @afishiru ────────────────────────────────────
    # youtube.com/@afishiru → Правой кнопкой → Просмотр кода
    # Ctrl+F → "channelId" → скопировать "UCxxxxxxxxxxxxxxxxxxxxxxxx"
    "AFISHIRU_CHANNEL_ID": "UCxxxxxxxxxxxxxxxxxxxxxxxx",

    # ── GitHub ─────────────────────────────────────────────────
    "GH_TOKEN":  "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",
    "GH_OWNER":  "strote34-arch",
    "GH_REPO":   "nextjs-boilerplate",
    "GH_FILE":   "cinema.html",
    "GH_BRANCH": "main",

    # ── Временная папка ────────────────────────────────────────
    "TMP_DIR": r"C:\afishiru\cinema_tmp",

    # ── Логи ───────────────────────────────────────────────────
    "LOG_FILE": r"C:\afishiru\logs\cinema_trailers.log",
}

# ── Логгер ────────────────────────────────────────────────────
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
def gh_get_file():
    import urllib.request
    url = (f"https://api.github.com/repos/{CONFIG['GH_OWNER']}/"
           f"{CONFIG['GH_REPO']}/contents/{CONFIG['GH_FILE']}"
           f"?ref={CONFIG['GH_BRANCH']}")
    req = urllib.request.Request(url, headers={
        "Authorization": f"token {CONFIG['GH_TOKEN']}",
        "Accept": "application/vnd.github.v3+json",
    })
    with urllib.request.urlopen(req) as r:
        data = json.loads(r.read())
    content = base64.b64decode(data["content"]).decode("utf-8")
    return content, data["sha"]

def gh_push_file(content, sha, msg):
    import urllib.request
    url = (f"https://api.github.com/repos/{CONFIG['GH_OWNER']}/"
           f"{CONFIG['GH_REPO']}/contents/{CONFIG['GH_FILE']}")
    body = json.dumps({
        "message": msg,
        "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
        "sha": sha,
        "branch": CONFIG["GH_BRANCH"],
    }).encode()
    req = urllib.request.Request(url, data=body, method="PUT", headers={
        "Authorization": f"token {CONFIG['GH_TOKEN']}",
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json",
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
    films = []
    depth=0; start=None
    for i,ch in enumerate(html[pos:], pos):
        if ch=='{':
            if depth==0: start=i
            depth+=1
        elif ch=='}':
            depth-=1
            if depth==0 and start is not None:
                obj=html[start:i+1]
                f=_parse_obj(obj)
                if f: films.append(f)
                start=None
        elif ch==']' and depth==0:
            break
    return films

def _parse_obj(obj):
    def g(k):
        m=re.search(rf"{k}:\s*'([^']*)'",obj)
        return m.group(1) if m else ''
    t=g('title')
    if not t: return None
    return {
        'title':    t,
        'id':       g('id'),
        'year':     g('year'),
        'trailerYT':g('trailerYT'),  # '' если нет
        '_obj':     obj,
    }

# ══════════════════════════════════════════════════════════════
# 3. YOUTUBE API
# ══════════════════════════════════════════════════════════════
_ki = 0
def yt_api(ep, params):
    import urllib.request, urllib.parse
    global _ki
    for _ in range(len(CONFIG["YT_API_KEYS"])):
        key=CONFIG["YT_API_KEYS"][_ki % len(CONFIG["YT_API_KEYS"])]
        params["key"]=key
        url=f"https://www.googleapis.com/youtube/v3/{ep}?"+urllib.parse.urlencode(params)
        try:
            with urllib.request.urlopen(url) as r:
                return json.loads(r.read())
        except Exception as e:
            if "quotaExceeded" in str(e) or "403" in str(e):
                log.warning(f"Квота ключа #{_ki} исчерпана")
                _ki+=1
            else:
                log.error(f"YT API: {e}")
                return {}
    return {}

def video_channel(vid_id):
    """Вернуть channelId видео."""
    d=yt_api("videos",{"part":"snippet","id":vid_id})
    items=d.get("items",[])
    if items:
        return items[0]["snippet"]["channelId"]
    return ""

def is_our_video(vid_id):
    """Принадлежит ли видео каналу @afishiru?"""
    if not vid_id: return False
    return video_channel(vid_id) == CONFIG["AFISHIRU_CHANNEL_ID"]

def find_trailer(film):
    """Найти YouTube video_id трейлера (с любого канала)."""
    t=film['title']; y=film.get('year','')
    queries=[
        f"{t} {y} трейлер на русском",
        f"{t} {y} official trailer",
        f"{t} трейлер",
    ]
    for q in queries:
        log.info(f"  🔍 {q!r}")
        d=yt_api("search",{
            "part":"id,snippet","q":q,
            "type":"video","videoDuration":"short",
            "maxResults":5,"order":"relevance"
        })
        ids=[it["id"]["videoId"] for it in d.get("items",[])]
        if not ids: continue
        vd=yt_api("videos",{"part":"contentDetails","id":",".join(ids)})
        for v in vd.get("items",[]):
            s=_iso(v["contentDetails"]["duration"])
            if 60<=s<=300:
                log.info(f"  ✅ {v['id']} ({s}s)")
                return v["id"]
    return ""

def _iso(s):
    m=re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?",s)
    if not m: return 0
    h,mn,sc=(int(x or 0) for x in m.groups())
    return h*3600+mn*60+sc

# ══════════════════════════════════════════════════════════════
# 4. СКАЧАТЬ
# ══════════════════════════════════════════════════════════════
def download(vid_id, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    tmpl=os.path.join(out_dir,f"{vid_id}.%(ext)s")
    r=subprocess.run([
        "yt-dlp", f"https://youtube.com/watch?v={vid_id}",
        "-o",tmpl,
        "-f","bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format","mp4","--no-playlist","--quiet",
    ], capture_output=True, text=True)
    if r.returncode!=0:
        log.error(f"yt-dlp: {r.stderr[:150]}")
        return ""
    for f in os.listdir(out_dir):
        if f.startswith(vid_id) and f.endswith(".mp4"):
            p=os.path.join(out_dir,f)
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

    tf=CONFIG["YT_OAUTH_TOKEN_FILE"]
    if not os.path.exists(tf):
        log.error(f"Нет токена: {tf}  →  запусти yt_auth.py")
        return ""

    with open(tf) as f: td=json.load(f)
    creds=Credentials(
        token=td.get("access_token"),
        refresh_token=td.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=td.get("client_id"),
        client_secret=td.get("client_secret"),
        scopes=["https://www.googleapis.com/auth/youtube.upload"],
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        td["access_token"]=creds.token
        with open(tf,"w") as f: json.dump(td,f,indent=2)

    yt=build("youtube","v3",credentials=creds)
    title=f"🎬 {film['title']} — Официальный трейлер ({film.get('year','2026')})"
    desc=(f"{film.get('desc','')}\n\n"
          f"📅 В прокате: {film.get('date','')}\n\n"
          f"🍿 Афиша Волгограда → https://афи.рф/cinema\n\n"
          f"#трейлер #кино #{film['title'].replace(' ','')} #Волгоград")
    log.info(f"  ⬆️  Загружаю: {title!r}")
    media=MediaFileUpload(path,mimetype="video/mp4",resumable=True,chunksize=5*1024*1024)
    req=yt.videos().insert(
        part="snippet,status",
        body={
            "snippet":{"title":title[:100],"description":desc[:5000],
                       "tags":["трейлер",film['title'],"кино","Волгоград"],
                       "categoryId":"1","defaultLanguage":"ru"},
            "status":{"privacyStatus":"public","selfDeclaredMadeForKids":False},
        },
        media_body=media,
    )
    resp=None
    while resp is None:
        st,resp=req.next_chunk()
        if st: log.info(f"    {int(st.progress()*100)}%")
    vid=resp["id"]
    log.info(f"  ✅ https://youtu.be/{vid}")
    return vid

# ══════════════════════════════════════════════════════════════
# 6. ОБНОВИТЬ HTML
# ══════════════════════════════════════════════════════════════
def patch_html(html, film, new_id):
    obj=film["_obj"]
    if "trailerYT:" in obj:
        new_obj=re.sub(r"trailerYT:'[^']*'",f"trailerYT:'{new_id}'",obj)
    else:
        new_obj=obj.rstrip().rstrip("}")+(f"\n    trailerYT:'{new_id}'\n  }}")
    return html.replace(obj,new_obj,1)

# ══════════════════════════════════════════════════════════════
# 7. ГЛАВНЫЙ ЦИКЛ
# ══════════════════════════════════════════════════════════════
def run(dry_run=False):
    log.info("="*60)
    log.info("🎬 Cinema Trailers запущен" + (" [DRY RUN]" if dry_run else ""))
    log.info("="*60)

    # Получить HTML
    log.info("📥 GitHub → cinema.html...")
    html, sha = gh_get_file()
    log.info(f"   {len(html)//1024} KB, SHA {sha[:8]}")

    # Разобрать фильмы
    films=parse_films(html)
    log.info(f"🎥 Фильмов: {len(films)}")

    # Определить что делать с каждым
    to_upload=[]
    for f in films:
        vid=f["trailerYT"]
        if not vid:
            log.info(f"  ➕ {f['title']}: нет трейлера")
            to_upload.append(f)
        elif not dry_run and CONFIG["AFISHIRU_CHANNEL_ID"]!="UCxxxxxxxxxxxxxxxxxxxxxxxx" and not is_our_video(vid):
            log.info(f"  🔄 {f['title']}: чужой канал → перезалить")
            to_upload.append(f)
        else:
            log.info(f"  ✅ {f['title']}: {vid}")

    if not to_upload:
        log.info("✅ Все трейлеры уже на @afishiru. Готово.")
        if dry_run:
            log.info("\n[DRY RUN] Чтобы принудительно перезалить с чужих каналов:")
            log.info("  1. Заполни AFISHIRU_CHANNEL_ID в CONFIG")
            log.info("  2. Запусти: python cinema_trailers.py (без --dry-run)")
        return

    log.info(f"🎯 К обработке: {len(to_upload)} фильмов")
    updated=False

    for film in to_upload:
        log.info(f"\n{'─'*50}")
        log.info(f"🎬 {film['title']} ({film.get('year','')})")

        # Найти трейлер
        src=film["trailerYT"] or find_trailer(film)
        if not src:
            log.warning("  ⚠️ Трейлер не найден, пропускаю")
            continue

        if dry_run:
            log.info(f"  [DRY RUN] Источник: https://youtu.be/{src}")
            log.info(f"  [DRY RUN] Скачал бы и залил на @afishiru")
            html=patch_html(html,film,src)
            updated=True
            continue

        # Скачать
        path=download(src, CONFIG["TMP_DIR"])
        if not path:
            log.warning("  ⚠️ Не удалось скачать")
            continue

        # Залить на @afishiru
        new_id=upload(film, path)
        try: os.remove(path)
        except: pass

        if not new_id:
            log.warning("  ⚠️ Не удалось загрузить")
            continue

        # Обновить HTML
        html=patch_html(html,film,new_id)
        updated=True
        log.info(f"  📝 trailerYT → '{new_id}'")
        time.sleep(3)

    # Запушить
    if updated and not dry_run:
        msg=f"auto: cinema trailers → @afishiru [{datetime.now().strftime('%Y-%m-%d %H:%M')}]"
        log.info(f"\n📤 GitHub push: {msg!r}")
        try:
            gh_push_file(html, sha, msg)
            log.info("  ✅ Задеплоено на Vercel автоматически")
        except Exception as e:
            log.error(f"  ❌ Push: {e}")
            bak=os.path.join(CONFIG["TMP_DIR"],"cinema_backup.html")
            open(bak,"w",encoding="utf-8").write(html)
            log.info(f"  💾 Сохранено локально: {bak}")

    log.info("\n✅ Cinema Trailers завершён")

# ══════════════════════════════════════════════════════════════
# yt_auth.py — OAuth, запустить один раз
# ══════════════════════════════════════════════════════════════
YT_AUTH = r'''#!/usr/bin/env python3
"""
yt_auth.py — авторизация для загрузки на @afishiru
Запусти один раз: python yt_auth.py
Откроется браузер → войди как @afishiru → токен сохранится
"""
import json
from google_auth_oauthlib.flow import InstalledAppFlow

# 1. Зайди на https://console.cloud.google.com
# 2. APIs & Services → Credentials → + CREATE CREDENTIALS → OAuth 2.0 Client ID
# 3. Тип: Desktop App → скачать JSON → сохранить как client_secrets.json в C:\afishiru\
CLIENT_SECRETS = r"C:\afishiru\client_secrets.json"
TOKEN_FILE     = r"C:\afishiru\yt_token_afishiru.json"
SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]

flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRETS, SCOPES)
creds = flow.run_local_server(port=0)

data = {
    "access_token":  creds.token,
    "refresh_token": creds.refresh_token,
    "client_id":     creds.client_id,
    "client_secret": creds.client_secret,
}
with open(TOKEN_FILE,"w") as f:
    json.dump(data,f,indent=2)
print(f"✅ Токен сохранён: {TOKEN_FILE}")
print("Теперь можно запускать: python cinema_trailers.py")
'''

if __name__=="__main__":
    import sys

    # Создать yt_auth.py
    p=os.path.join(os.path.dirname(os.path.abspath(__file__)),"yt_auth.py")
    if not os.path.exists(p):
        open(p,"w",encoding="utf-8").write(YT_AUTH)
        print(f"📝 Создан yt_auth.py")

    dry="--dry-run" in sys.argv or "-d" in sys.argv
    if dry: print("🔵 DRY RUN — без реальных загрузок")
    run(dry_run=dry)
