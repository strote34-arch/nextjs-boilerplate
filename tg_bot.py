#!/usr/bin/env python3
"""
tg_bot.py — Telegram бот для @afishiru
Команды: /stats, /missing, /run, /help
Запуск: python tg_bot.py
"""
import json, threading, time, urllib.request, urllib.parse, ssl, sys

# ── Настройки ─────────────────────────────────────────────────
TG_TOKEN   = "1620258835:AAFWqllrrJHYozu6sTfbfbSK1NVBBvBkQBA"
VERCEL_URL = "https://afishiru-v12.vercel.app"
TMDB_KEY   = "9b121a7c344eeb23baad7647d6b2eabe"
YT_KEY     = "AIzaSyDV8Fxtu4FwVvUOHcDeNoNXad5CKkpxi4E"
AFISHIRU_CH = "UC6Lc1N2a72hWWroW6Afn2xA"

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

API = f"https://api.telegram.org/bot{TG_TOKEN}"

def tg(method, **params):
    url = f"{API}/{method}"
    data = json.dumps(params).encode()
    req = urllib.request.Request(url, data=data,
          headers={"Content-Type": "application/json"})
    try:
        r = urllib.request.urlopen(req, timeout=15, context=ctx)
        return json.loads(r.read())
    except Exception as e:
        print(f"[TG] Ошибка {method}: {e}")
        return {}

def send(chat_id, text, parse_mode="Markdown"):
    tg("sendMessage", chat_id=chat_id, text=text, parse_mode=parse_mode)

# ── Команды ───────────────────────────────────────────────────
def cmd_help(chat_id):
    send(chat_id, """🎬 *Бот @afishiru*

/stats — статистика трейлеров на сайте
/missing — фильмы без трейлера (нужно загрузить)
/run — запустить синхронизацию сайта
/help — эта справка""")

def cmd_stats(chat_id):
    send(chat_id, "⏳ Получаю статистику...")
    try:
        r = urllib.request.urlopen(
            f"{VERCEL_URL}/api/trailer-sync", timeout=60, context=ctx)
        d = json.loads(r.read())
        s = d.get("stats", {})
        msg = (f"📊 *Статистика трейлеров*\n\n"
               f"🎬 Всего фильмов: *{s.get('total', 0)}*\n"
               f"✅ С @afishiru: *{s.get('afishiru', 0)}*\n"
               f"❌ Без трейлера: *{s.get('no_trailer', 0)}*\n\n"
               f"⏰ {d.get('updated_at','')[:16].replace('T',' ')} UTC")
        send(chat_id, msg)
    except Exception as e:
        send(chat_id, f"❌ Ошибка: {e}")

def cmd_missing(chat_id):
    send(chat_id, "⏳ Ищу фильмы без трейлера...")
    try:
        # Получить фильмы из TMDB
        import re as _re
        films = {}
        for endpoint in ["now_playing", "upcoming"]:
            url = (f"https://api.themoviedb.org/3/movie/{endpoint}"
                   f"?api_key={TMDB_KEY}&language=ru-RU&page=1")
            r = urllib.request.urlopen(url, timeout=10, context=ctx)
            data = json.loads(r.read())
            for m in data.get("results", []):
                tid = m.get("id")
                if tid and tid not in films:
                    rating = m.get("vote_average", 0) or 0
                    title  = m.get("title", "")
                    has_ru = bool(_re.search(r"[а-яёА-ЯЁ]", title))
                    if rating >= 5.0 or has_ru:
                        films[tid] = {
                            "title": title,
                            "year": (m.get("release_date","") or "")[:4],
                            "rating": rating,
                            "status": endpoint,
                        }

        # Получить статистику с Vercel (не тратим YouTube квоту)
        try:
            r2 = urllib.request.urlopen(
                f"{VERCEL_URL}/api/trailer-sync", timeout=60, context=ctx)
            sync_d = json.loads(r2.read())
            s = sync_d.get("stats", {})
        except:
            s = {}

        # Фильмы без трейлера из статистики
        missing = list(films.values())[:s.get('no_trailer', len(films))]

        if not missing:
            send(chat_id, "✅ Все фильмы имеют трейлеры на @afishiru!")
            return

        lines = [f"❌ *Нужен трейлер — {len(missing)} фильмов:*\n"]
        for f in missing[:20]:
            status_icon = "🎬" if f["status"] == "now_playing" else "🔜"
            lines.append(
                f"{status_icon} {f['title']} ({f['year']}) ⭐{f['rating']:.1f}")

        if len(missing) > 20:
            lines.append(f"\n...и ещё {len(missing)-20} фильмов")
        lines.append("\n💡 Запустите RUN.bat для автозагрузки")
        send(chat_id, "\n".join(lines))

    except Exception as e:
        send(chat_id, f"❌ Ошибка: {e}")

def cmd_run(chat_id):
    send(chat_id, "🔄 Запускаю синхронизацию сайта...")
    try:
        r = urllib.request.urlopen(
            f"{VERCEL_URL}/api/trailer-sync", timeout=90, context=ctx)
        d = json.loads(r.read())
        s = d.get("stats", {})
        send(chat_id,
             f"✅ *Синхронизация завершена!*\n\n"
             f"🎬 Всего: *{s.get('total',0)}*\n"
             f"✅ @afishiru: *{s.get('afishiru',0)}*\n"
             f"❌ Без трейлера: *{s.get('no_trailer',0)}*")
    except Exception as e:
        send(chat_id, f"❌ Ошибка синхронизации: {e}")

# ── Polling ────────────────────────────────────────────────────
def poll():
    offset = 0
    print(f"[Bot] Запущен. Ожидаю команды...")
    while True:
        try:
            r = urllib.request.urlopen(
                f"{API}/getUpdates?offset={offset}&timeout=30",
                timeout=35, context=ctx)
            data = json.loads(r.read())
            for upd in data.get("result", []):
                offset = upd["update_id"] + 1
                msg = upd.get("message", {})
                text = msg.get("text", "")
                chat_id = msg.get("chat", {}).get("id")
                if not chat_id or not text:
                    continue
                print(f"[Bot] {chat_id}: {text}")
                if text.startswith("/stats"):
                    threading.Thread(target=cmd_stats, args=(chat_id,), daemon=True).start()
                elif text.startswith("/missing"):
                    threading.Thread(target=cmd_missing, args=(chat_id,), daemon=True).start()
                elif text.startswith("/run"):
                    threading.Thread(target=cmd_run, args=(chat_id,), daemon=True).start()
                elif text.startswith("/help") or text.startswith("/start"):
                    cmd_help(chat_id)
        except Exception as e:
            print(f"[Bot] Ошибка polling: {e}")
            time.sleep(5)

if __name__ == "__main__":
    poll()
