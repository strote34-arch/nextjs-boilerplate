#!/usr/bin/env python3
"""
C:\afishiru\update_vgdo34.py
Авто-парсинг афиши Дома Офицеров vgdo34.ru/afisha/
→ concerts.html (все события)
→ theater.html  (только спектакли)
→ git push → авто-деплой на Vercel
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
THEATER_FILE  = REPO_PATH / 'theater.html'
VENUE_NAME    = 'Дом Офицеров'
VENUE_ADDR    = 'просп. Ленина, 31'
TICKET_URL    = 'http://vlg.kassamix.ru/'
ID_PREFIX     = 'vgdo-'

MONTHS = {
    'января':1,'февраля':2,'марта':3,'апреля':4,'мая':5,'июня':6,
    'июля':7,'августа':8,'сентября':9,'октября':10,'ноября':11,'декабря':12,
}
MON_SHORT = ['','янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']

def log(msg): print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)

def parse_heading(text):
    text = text.strip()
    date_iso, date_str, time_str = None, None, ''
    m = re.search(r'(\d{1,2})\.(\d{2})\.(\d{4})', text)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            dt = date(y, mo, d)
            date_iso = dt.strftime('%Y-%m-%d')
            date_str = f"{d} {MON_SHORT[mo]}"
        except: pass
    m2 = re.search(r'в\s+(\d{1,2})[-:](\d{2})', text)
    if m2: time_str = f"{m2.group(1)}:{m2.group(2)}"
    title = re.sub(r'\d{1,2}\.\d{2}\.\d{4}г?\.?', '', text)
    title = re.sub(r'в\s+\d{1,2}[-:]\d{2}', '', title)
    title = re.sub(r'\s+', ' ', title).strip().strip('—').strip()
    return title, date_iso, date_str, time_str

def is_spectacle(title):
    t = title.lower()
    return any(w in t for w in ['спектакл','ирония','авокадо','приговор','операция','пьеса'])

def slugify(s):
    tr = {'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ж':'zh','з':'z',
          'и':'i','й':'j','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p',
          'р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch',
          'ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya','ё':'yo'}
    slug = re.sub(r'[^a-zа-яёА-ЯЁ0-9]', '-', s.lower())
    slug = ''.join(tr.get(c, c) for c in slug)
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9-]', '', slug))[:14].strip('-')

def make_id(title, date_iso):
    d = (date_iso or 'xx')[:7].replace('-', '')
    return f"{ID_PREFIX}{slugify(title)}-{d}"

def fetch_events():
    log(f"Парсим {URL}...")
    r = requests.get(URL, timeout=15, headers={'User-Agent': 'Mozilla/5.0'})
    r.raise_for_status(); r.encoding = 'utf-8'
    soup = BeautifulSoup(r.text, 'html.parser')
    events = {}
    for tag in soup.find_all(['h2', 'h3']):
        text = tag.get_text(' ', strip=True)
        if not text or len(text) < 5: continue
        if not re.search(r'\d{1,2}\.\d{2}\.\d{4}', text): continue
        title, date_iso, date_str, time_str = parse_heading(text)
        if not title or not date_iso: continue
        genre = 'Концерт · Эстрада'; icon = '🎵'
        if is_spectacle(title):
            genre = 'Театр · Спектакль'; icon = '🎭'
        elif any(w in title.lower() for w in ['оркестр','классик','симфон']): 
            genre = 'Концерт · Классика'; icon = '🎼'
        elif any(w in title.lower() for w in ['шоу','иллюзи','зеркал']):
            genre = 'Шоу'; icon = '🪄'
        ev_id = make_id(title, date_iso)
        events[ev_id] = {'id':ev_id,'title':title,'date_iso':date_iso,'date_str':date_str,
                         'time':time_str,'genre':genre,'icon':icon,'is_spectacle':is_spectacle(title)}
        log(f"  {'🎭' if is_spectacle(title) else '🎵'} [{date_iso}] {title}")
    return list(events.values())

def to_concert_js(ev):
    return (f"  {{id:'{ev['id']}',title:{json.dumps(ev['title'],ensure_ascii=False)},\n"
            f"   genre:'{ev['genre']}',icon:'{ev['icon']}',\n"
            f"   date:{json.dumps(ev['date_str']+'.',ensure_ascii=False)},dateISO:'{ev['date_iso']}',time:'{ev['time']}',\n"
            f"   city:'Волгоград',age:'6+',color:'#0d1a2d',\n"
            f"   venues:[{{name:'{VENUE_NAME}',addr:'{VENUE_ADDR}'}}],\n"
            f"   cast:{json.dumps(ev['title'],ensure_ascii=False)},\n"
            f"   ticketUrl:{json.dumps(TICKET_URL,ensure_ascii=False)}}}")

def update_concerts(events):
    concerts = CONCERTS_FILE.read_text(encoding='utf-8', errors='replace')
    existing = set(re.findall(r"id:'(vgdo-[^']+)'", concerts))
    new_ev = [e for e in events if e['id'] not in existing]
    if not new_ev:
        log("concerts.html: ничего нового"); return False
    pos = concerts.find('const CONCERTS')
    depth=0; end=None
    for i, ch in enumerate(concerts[pos:], pos):
        if ch=='[': depth+=1
        elif ch==']':
            depth-=1
            if depth==0: end=i; break
    today = date.today().strftime('%d.%m.%Y')
    insert = f',\n\n  // ── Дом Офицеров (авто {today}) ──\n' + ',\n'.join(to_concert_js(e) for e in new_ev)
    CONCERTS_FILE.write_text(concerts[:end] + insert + '\n' + concerts[end:], encoding='utf-8')
    log(f"concerts.html: +{len(new_ev)} событий")
    return True

def update_theater(events):
    """Добавить новые СПЕКТАКЛИ в THEATERS_DB → dom-oficerov"""
    spectacles = [e for e in events if e['is_spectacle']]
    if not spectacles:
        log("theater.html: спектаклей нет"); return False

    theater = THEATER_FILE.read_text(encoding='utf-8', errors='replace')
    # Найти блок dom-oficerov events
    dom_pos = theater.find("id:'dom-oficerov'")
    if dom_pos < 0:
        log("⚠️ theater.html: dom-oficerov не найден — пропускаем"); return False

    # Найти events:[ в блоке dom-oficerov
    ev_pos = theater.find('events:[', dom_pos)
    ev_end_pos = theater.find(']}', ev_pos) + 1  # ] закрывает events

    current_events_block = theater[ev_pos:ev_end_pos+1]
    # Извлечь dateISO уже добавленных
    existing_dates = set(re.findall(r"dateISO:'([^']+)'", current_events_block))
    log(f"theater.html: уже {len(existing_dates)} спектаклей в Доме Офицеров")

    new_sp = [e for e in spectacles if e['date_iso'] not in existing_dates]
    if not new_sp:
        log("theater.html: новых спектаклей нет"); return False

    new_ev_js = ',\n     '.join(
        f"{{title:{json.dumps(e['title'],ensure_ascii=False)},dateISO:'{e['date_iso']}',"
        f"date:'{e['date_str']}',time:'{e['time']}',price:'от 500 ₽',age:'12+',genre:'{e['genre']}'}}"
        for e in new_sp
    )
    # Вставить перед закрывающей ]
    insert_pos = ev_end_pos  # перед ]
    theater_new = theater[:insert_pos] + ',\n     ' + new_ev_js + theater[insert_pos:]
    THEATER_FILE.write_text(theater_new, encoding='utf-8')
    log(f"theater.html: +{len(new_sp)} спектаклей")
    return True

def git(args):
    return subprocess.run([GIT_EXE]+args, cwd=REPO_PATH, capture_output=True, text=True,
                          env={'GIT_TERMINAL_PROMPT':'0'})

def main():
    log("=== Авто-обновление афиши Дома Офицеров ===")
    git(['pull', REMOTE_URL, 'main'])

    events = fetch_events()
    log(f"Найдено: {len(events)} событий ({sum(1 for e in events if e['is_spectacle'])} спектаклей)")
    if not events: return

    changed_c = update_concerts(events)
    changed_t = update_theater(events)

    if not changed_c and not changed_t:
        log("✅ Всё актуально — ничего не деплоим"); return

    files = []
    if changed_c: files.append('concerts.html')
    if changed_t: files.append('theater.html')
    for f in files: git(['add', f])

    today = date.today().strftime('%d.%m.%Y')
    git(['commit', '-m', f'auto: Дом Офицеров vgdo34.ru — обновление {today} (concerts+theater)',
         '--author=strote34-arch <267908861+strote34-arch@users.noreply.github.com>'])
    git(['push', REMOTE_URL, 'main'])
    log(f"🚀 Задеплоено! Файлы: {', '.join(files)}")

if __name__ == '__main__':
    try: main()
    except Exception as ex:
        log(f"❌ {ex}")
        import traceback; traceback.print_exc()
        sys.exit(1)
