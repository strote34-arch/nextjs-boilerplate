#!/usr/bin/env python3
"""
Авто-парсер афиши restvlg.ru → обновляет concerts.html
Запускается каждую субботу через GitHub Actions
"""
import re, json, requests
from datetime import datetime, date
from bs4 import BeautifulSoup

# ── Конфигурация ────────────────────────────────────────────────────────────
URL = 'https://restvlg.ru/'
VENUE_NAME = 'Ресторан «Волгоград» / Сизокрылый'
VENUE_ADDR = 'ул. Мира, 12'
CONCERTS_FILE = 'concerts.html'
ID_PREFIX = 'rvlg-'

# Месяцы RU→номер
MONTHS = {
    'января':1,'февраля':2,'марта':3,'апреля':4,'мая':5,'июня':6,
    'июля':7,'августа':8,'сентября':9,'октября':10,'ноября':11,'декабря':12,
    'янв':1,'фев':2,'мар':3,'апр':4,'июл':7,'авг':8,'сен':9,'окт':10,'ноя':11,'дек':12,
}

def parse_date(text):
    """Извлекает ISO дату из строки вида '4 июля', '4.07', '4.07 21:00' etc"""
    text = text.strip().lower()
    # Паттерн: "4 июля 2026" или "4 июля"
    m = re.search(r'(\d{1,2})[.\s](\w+)\s*(\d{4})?', text)
    if m:
        day = int(m.group(1))
        mon_str = m.group(2)
        year = int(m.group(3)) if m.group(3) else datetime.now().year
        mon = MONTHS.get(mon_str)
        if mon:
            try:
                d = date(year, mon, day)
                # Если дата прошла — попробовать следующий год
                if d < date.today():
                    d = date(year+1, mon, day)
                return d.strftime('%Y-%m-%d'), d.strftime('%d %B %Y').lstrip('0')
            except ValueError:
                pass
    # Паттерн: "4.07" или "04.07"
    m2 = re.search(r'(\d{1,2})\.(\d{1,2})', text)
    if m2:
        day, mon = int(m2.group(1)), int(m2.group(2))
        year = datetime.now().year
        try:
            d = date(year, mon, day)
            if d < date.today():
                d = date(year+1, mon, day)
            return d.strftime('%Y-%m-%d'), d.strftime('%d.%m.%Y')
        except ValueError:
            pass
    return None, None

def parse_time(text):
    m = re.search(r'(\d{1,2}):(\d{2})', text)
    return m.group(0) if m else ''

def make_id(title, date_iso):
    slug = re.sub(r'[^a-zа-яё0-9]', '-', title.lower())[:30].strip('-')
    slug = re.sub(r'-+', '-', slug)
    date_short = (date_iso or 'xx')[:7].replace('-', '')
    return f"{ID_PREFIX}{date_short}-{slug[:15]}"

def load_existing_ids(html):
    """Достаёт все id:'rvlg-...' из concerts.html"""
    return set(re.findall(r"id:'(rvlg-[^']+)'", html))

def events_to_js(events):
    """Конвертирует список событий в JS-объекты для CONCERTS"""
    lines = []
    for e in events:
        icon = '🎵' if any(w in e['title'].lower() for w in ['трибьют','концерт','группа','певец','вечер']) else '🎭'
        genre = 'Живая музыка' if 'трибьют' in e['title'].lower() or 'группа' in e['title'].lower() else 'Арт · Культура'
        ticket = e.get('ticket_url', '')
        lines.append(f"""  {{id:'{e['id']}',title:{json.dumps(e['title'], ensure_ascii=False)},
   genre:'{genre}',icon:'{icon}',
   date:{json.dumps(e['date_str'] or 'Скоро', ensure_ascii=False)},dateISO:'{e['date_iso'] or ''}',time:'{e['time']}',
   city:'Волгоград',age:'18+',color:'#0d1a2d',rating:8,
   venues:[{{name:'{VENUE_NAME}',addr:'{VENUE_ADDR}'}}],
   cast:{json.dumps(e['cast'], ensure_ascii=False)},
   ticketUrl:{json.dumps(ticket, ensure_ascii=False)}}}""")
    return ',\n'.join(lines)

def main():
    print(f"🔍 Парсим {URL}...")
    try:
        r = requests.get(URL, timeout=15, headers={'User-Agent': 'Mozilla/5.0'})
        r.raise_for_status()
    except Exception as ex:
        print(f"❌ Ошибка запроса: {ex}")
        return

    soup = BeautifulSoup(r.text, 'html.parser')

    # Найти секцию афиши
    afisha_events = []

    # Ищем ссылки на события в блоках афиши
    for a in soup.find_all('a', href=True):
        text = a.get_text(' ', strip=True)
        href = a['href']
        
        # Пропустить навигационные ссылки
        if not text or len(text) < 10:
            continue
        if any(nav in href for nav in ['#menuopen', '#popup', '#afisha', '#contacts', '#menyu', '#ploshchadka', '#meropriyatiya', '#benefits', '#small']):
            if 'qtickets' not in href and 'tel:' not in href:
                continue

        # Ищем текст с датой и названием события
        # Типичный формат: "Название события 4.07 21:00"
        has_date = bool(re.search(r'\d{1,2}[.\s]\d{2}|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)', text, re.I))
        is_ticket = 'qtickets' in href or 'kassir' in href or 'concert' in href.lower()
        is_phone_link = href.startswith('tel:')
        
        if (has_date or is_ticket) and len(text) > 15:
            date_iso, date_str = parse_date(text)
            time_str = parse_time(text)
            # Очистить название от даты/времени
            title = re.sub(r'\s*\d{1,2}[./]\d{2}(?:[./]\d{2,4})?\s*', ' ', text)
            title = re.sub(r'\s*\d{1,2}:\d{2}\s*(?:-\s*\d{1,2}:\d{2})?\s*', ' ', title)
            title = re.sub(r'\s+', ' ', title).strip()
            if len(title) < 5:
                continue
            
            ticket_url = href if (is_ticket or href.startswith('http')) and not is_phone_link else ''

            afisha_events.append({
                'title': title,
                'date_iso': date_iso or '',
                'date_str': date_str or 'Скоро',
                'time': time_str,
                'cast': title,
                'ticket_url': ticket_url,
                'id': make_id(title, date_iso),
            })

    # Дедупликация по id
    seen = {}
    for e in afisha_events:
        if e['id'] not in seen:
            seen[e['id']] = e
    afisha_events = list(seen.values())

    print(f"📋 Найдено событий на сайте: {len(afisha_events)}")
    for e in afisha_events:
        print(f"  - {e['date_str']}: {e['title']}")

    if not afisha_events:
        print("ℹ️ Событий не найдено — ничего не обновляем")
        return

    # Загрузить concerts.html
    with open(CONCERTS_FILE, encoding='utf-8', errors='replace') as f:
        concerts = f.read()

    existing_ids = load_existing_ids(concerts)
    print(f"📂 Уже в базе rvlg- событий: {len(existing_ids)}")

    # Фильтровать только новые
    new_events = [e for e in afisha_events if e['id'] not in existing_ids]
    print(f"✨ Новых событий: {len(new_events)}")

    if not new_events:
        print("✅ Всё актуально — ничего не добавляем")
        return

    # Найти конец CONCERTS массива и вставить новые события
    pos = concerts.find('const CONCERTS')
    depth = 0
    end_pos = None
    for i, ch in enumerate(concerts[pos:], pos):
        if ch == '[': depth += 1
        elif ch == ']':
            depth -= 1
            if depth == 0:
                end_pos = i
                break

    if end_pos is None:
        print("❌ Не найден конец массива CONCERTS")
        return

    new_js = ',\n\n  // ── Ресторан «Волгоград» (авто-обновление ' + date.today().strftime('%d.%m.%Y') + ') ──\n' + events_to_js(new_events)
    concerts_new = concerts[:end_pos] + new_js + '\n' + concerts[end_pos:]

    with open(CONCERTS_FILE, 'w', encoding='utf-8') as f:
        f.write(concerts_new)

    print(f"✅ Добавлено {len(new_events)} новых событий в concerts.html")
    for e in new_events:
        print(f"  + [{e['date_iso']}] {e['title']}")

if __name__ == '__main__':
    main()
