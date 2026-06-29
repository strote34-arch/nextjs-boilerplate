#!/usr/bin/env python3
"""
C:\afishiru\update_vgdo34.py
Авто-парсинг афиши Дома Офицеров vgdo34.ru/afisha/ → concerts.html → git push
Запускать каждую неделю через Windows Task Scheduler
"""
import re, json, sys, subprocess, requests
from datetime import datetime, date
from pathlib import Path
from bs4 import BeautifulSoup

# ── Настройки ────────────────────────────────────────────────────────────────
URL           = 'http://vgdo34.ru/afisha/'
REPO_PATH     = Path(r'C:\afishiru\nextjs-boilerplate')
GIT_EXE       = r'C:\Program Files\Git\bin\git.exe'
GH_TOKEN      = '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'
REMOTE_URL    = f'https://{GH_TOKEN}@github.com/strote34-arch/nextjs-boilerplate.git'
CONCERTS_FILE = REPO_PATH / 'concerts.html'
VENUE_NAME    = 'Дом Офицеров'
VENUE_ADDR    = 'просп. Ленина, 31'
TICKET_URL    = 'http://vlg.kassamix.ru/'
ID_PREFIX     = 'vgdo-'

MONTHS = {
    'января':1,'февраля':2,'марта':3,'апреля':4,'мая':5,'июня':6,
    'июля':7,'августа':8,'сентября':9,'октября':10,'ноября':11,'декабря':12,
}

def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)

def parse_heading(text):
    """Извлекает название, дату и время из заголовка типа '«Аксиос» 18.07.2026 в 19-00'"""
    text = text.strip()
    # Ищем паттерн даты: 18.07.2026 или 18.07 или 18 июля
    date_iso, date_str, time_str = None, None, ''

    # Паттерн ДД.ММ.ГГГГ
    m_dmy = re.search(r'(\d{1,2})\.(\d{2})\.(\d{4})', text)
    if m_dmy:
        d,mo,y = int(m_dmy.group(1)), int(m_dmy.group(2)), int(m_dmy.group(3))
        try:
            dt = date(y, mo, d)
            date_iso = dt.strftime('%Y-%m-%d')
            date_str = f"{d} {list(MONTHS.keys())[mo-1].capitalize()} {y}"
        except: pass

    # Паттерн ДД.ММ без года
    if not date_iso:
        m_dm = re.search(r'(\d{1,2})\.(\d{2})(?:\.(\d{4}))?', text)
        if m_dm:
            d,mo = int(m_dm.group(1)), int(m_dm.group(2))
            y = int(m_dm.group(3)) if m_dm.group(3) else datetime.now().year
            try:
                dt = date(y, mo, d)
                if dt < date.today(): dt = dt.replace(year=dt.year+1)
                date_iso = dt.strftime('%Y-%m-%d')
                date_str = f"{d} {list(MONTHS.keys())[mo-1].capitalize()} {y}"
            except: pass

    # Время: в 19-00 или в 19:00
    m_time = re.search(r'в\s+(\d{1,2})[-:](\d{2})', text)
    if m_time:
        time_str = f"{m_time.group(1)}:{m_time.group(2)}"

    # Очистить название (убрать дату и время)
    title = text
    title = re.sub(r'\d{1,2}\.\d{2}(?:\.\d{4})?г?\.?', '', title)
    title = re.sub(r'в\s+\d{1,2}[-:]\d{2}', '', title)
    title = re.sub(r'\s+', ' ', title).strip().strip('—').strip()

    return title, date_iso, date_str, time_str

def make_id(title, date_iso):
    slug = re.sub(r'[^a-zа-яёА-ЯЁ0-9]', '-', title.lower())
    slug = re.sub(r'-+', '-', slug)[:18].strip('-')
    # Транслитерация
    tr = {'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ж':'zh','з':'z',
          'и':'i','й':'j','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p',
          'р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch',
          'ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
          'ё':'yo'}
    slug_lat = ''.join(tr.get(ch, ch) for ch in slug)
    slug_lat = re.sub(r'[^a-z0-9-]', '', slug_lat)[:14].strip('-')
    d_short = (date_iso or 'xx')[:7].replace('-','')
    return f"{ID_PREFIX}{slug_lat}-{d_short}"

def fetch_events():
    log(f"Парсим {URL}...")
    r = requests.get(URL, timeout=15, headers={'User-Agent':'Mozilla/5.0'})
    r.raise_for_status()
    r.encoding = 'utf-8'
    soup = BeautifulSoup(r.text, 'html.parser')

    events = []
    for tag in soup.find_all(['h2', 'h3']):
        text = tag.get_text(' ', strip=True)
        if not text or len(text) < 5: continue
        # Должна быть дата в формате ДД.ММ.ГГГГ
        if not re.search(r'\d{1,2}\.\d{2}', text): continue

        title, date_iso, date_str, time_str = parse_heading(text)
        if not title or not date_iso: continue

        # Определить тип
        title_lower = title.lower()
        genre = 'Концерт · Эстрада'
        icon = '🎵'
        if any(w in title_lower for w in ['спектакль','опера','балет','театр']):
            genre = 'Театр · Драма'; icon = '🎭'
        elif any(w in title_lower for w in ['шоу','иллюзи','фокус','цирк']):
            genre = 'Шоу'; icon = '🪄'
        elif any(w in title_lower for w in ['оркестр','классик','симфон']):
            genre = 'Концерт · Классика'; icon = '🎼'
        elif any(w in title_lower for w in ['рок','джаз','блюз']):
            genre = 'Концерт · Рок'; icon = '🎸'

        ev_id = make_id(title, date_iso)
        events.append({
            'id': ev_id, 'title': title, 'date_iso': date_iso,
            'date_str': date_str, 'time': time_str,
            'genre': genre, 'icon': icon,
        })
        log(f"  [{date_iso} {time_str}] {title}")

    return events

def to_js(ev):
    return (
        f"  {{id:'{ev['id']}',title:{json.dumps(ev['title'],ensure_ascii=False)},\n"
        f"   genre:'{ev['genre']}',icon:'{ev['icon']}',\n"
        f"   date:{json.dumps(ev['date_str'],ensure_ascii=False)},dateISO:'{ev['date_iso']}',time:'{ev['time']}',\n"
        f"   city:'Волгоград',age:'6+',color:'#0d1a2d',\n"
        f"   venues:[{{name:'{VENUE_NAME}',addr:'{VENUE_ADDR}'}}],\n"
        f"   cast:{json.dumps(ev['title'],ensure_ascii=False)},\n"
        f"   ticketUrl:{json.dumps(TICKET_URL,ensure_ascii=False)}}}"
    )

def git(args):
    return subprocess.run([GIT_EXE]+args, cwd=REPO_PATH,
                          capture_output=True, text=True,
                          env={'GIT_TERMINAL_PROMPT':'0'})

def main():
    log("=== Авто-обновление афиши Дома Офицеров ===")
    git(['pull', REMOTE_URL, 'main'])

    events = fetch_events()
    log(f"Найдено событий: {len(events)}")
    if not events:
        log("Ничего не найдено"); return

    concerts = CONCERTS_FILE.read_text(encoding='utf-8', errors='replace')
    existing = set(re.findall(r"id:'(vgdo-[^']+)'", concerts))
    log(f"Уже в базе: {len(existing)}")

    new_ev = [e for e in events if e['id'] not in existing]
    log(f"Новых: {len(new_ev)}")
    if not new_ev:
        log("✅ Всё актуально"); return

    # Найти конец CONCERTS
    pos = concerts.find('const CONCERTS')
    depth=0; end=None
    for i, ch in enumerate(concerts[pos:], pos):
        if ch=='[': depth+=1
        elif ch==']':
            depth-=1
            if depth==0: end=i; break

    today = date.today().strftime('%d.%m.%Y')
    insert = f',\n\n  // ── Дом Офицеров (авто {today}) ──\n' + ',\n'.join(to_js(e) for e in new_ev)
    new_txt = concerts[:end] + insert + '\n' + concerts[end:]
    CONCERTS_FILE.write_text(new_txt, encoding='utf-8')
    log(f"✅ concerts.html обновлён (+{len(new_ev)})")

    git(['add', 'concerts.html'])
    git(['commit', '-m', f'auto: Дом Офицеров vgdo34.ru — {len(new_ev)} новых событий {today}',
         '--author=strote34-arch <267908861+strote34-arch@users.noreply.github.com>'])
    git(['push', REMOTE_URL, 'main'])
    log("🚀 Задеплоено на Vercel!")
    for e in new_ev:
        log(f"  + [{e['date_iso']}] {e['title']}")

if __name__ == '__main__':
    try: main()
    except Exception as ex:
        log(f"❌ {ex}")
        import traceback; traceback.print_exc()
        sys.exit(1)
