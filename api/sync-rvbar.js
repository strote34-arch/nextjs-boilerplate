// /api/sync-rvbar.js — еженедельная проверка афиши volga.rvbar.ru/posters/ (Руки Вверх Бар, Волгоград)
// Сайт на WordPress, карточки .schedule__box: только фото + дата, БЕЗ явного
// текстового названия события на самой странице списка (оно есть только на
// отдельной странице события, которую мы не запрашиваем). Название формируем
// из URL-слага (человекочитаемая заготовка — не идеально, но рабочий вариант).
//
// Даты на сайте бывают трёх видов:
//  1) "DD month - DD month"      — диапазон (напр. трансляции ЧМ) — берём дату начала
//  2) "DD month [день недели]"   — обычное разовое событие
//  3) "Каждый ПН/По пятницам/Будни" — регулярная программа без конкретной даты — пропускаем
// Год на сайте не указан — определяем сами (если дата уже прошла — берём следующий год).

import * as cheerio from 'cheerio';

const SOURCE_URL = 'https://volga.rvbar.ru/posters/';
const BASE_URL = 'https://volga.rvbar.ru';
const VENUE_NAME = 'Руки Вверх Бар';
const VENUE_ADDR = 'наб. 62-й Армии, д. 6, Волгоград';

const MONTHS = {
  'января':'01','февраля':'02','марта':'03','апреля':'04','мая':'05','июня':'06',
  'июля':'07','августа':'08','сентября':'09','октября':'10','ноября':'11','декабря':'12',
};
const MONTHS_SHORT = {
  '01':'янв','02':'фев','03':'мар','04':'апр','05':'мая','06':'июн',
  '07':'июл','08':'авг','09':'сен','10':'окт','11':'ноя','12':'дек',
};
const MONTHS_FULL = {
  '01':'января','02':'февраля','03':'марта','04':'апреля','05':'мая','06':'июня',
  '07':'июля','08':'августа','09':'сентября','10':'октября','11':'ноября','12':'декабря',
};
const DATE_RE = /(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/;
const RANGE_RE = /(\d{1,2})\s+(\S+)\s*-\s*(\d{1,2})\s+(\S+)/;
const RECURRING_RE = /^(каждый|каждую|каждое|по\s|будни)/i;

function slugToTitle(slug) {
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function resolveYear(month, day) {
  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, parseInt(month, 10) - 1, parseInt(day, 10));
  if (candidate.getTime() < now.getTime() - 24 * 3600 * 1000) year += 1;
  return year;
}

async function fetchPage() {
  const res = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; afishiru-sync/1.0)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`fetch ${SOURCE_URL} -> ${res.status}`);
  return res.text();
}

function parseEvents(html) {
  const $ = cheerio.load(html);
  const events = [];

  $('a.schedule__box').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';
    const slugMatch = href.match(/\/poster\/([a-z0-9-]+)\/?/i);
    if (!slugMatch) return;
    const slug = slugMatch[1];

    const dateText = $el.find('.schedule__date').first().text().replace(/\s+/g, ' ').trim();
    if (!dateText || RECURRING_RE.test(dateText)) return; // регулярная программа без даты — пропускаем

    const dateMatch = dateText.match(DATE_RE);
    if (!dateMatch) return;

    let day = dateMatch[1].padStart(2, '0');
    let month = MONTHS[dateMatch[2]];

    // Диапазон дат (напр. трансляции ЧМ "11 июня - 19 июля") — для определения
    // года ориентируемся на дату ОКОНЧАНИЯ: если событие ещё идёт, год брать
    // от старта было бы неверно, раз старт уже в прошлом
    const rangeMatch = dateText.match(RANGE_RE);
    let yearAnchorDay = day, yearAnchorMonth = month;
    if (rangeMatch && MONTHS[rangeMatch[4]]) {
      yearAnchorDay = rangeMatch[3].padStart(2, '0');
      yearAnchorMonth = MONTHS[rangeMatch[4]];
    }

    const year = resolveYear(yearAnchorMonth, yearAnchorDay);
    const dateISO = `${year}-${month}-${day}`;

    const todayISO = new Date().toISOString().slice(0, 10);
    const endDateISO = rangeMatch && MONTHS[rangeMatch[4]] ? `${year}-${yearAnchorMonth}-${yearAnchorDay}` : dateISO;
    if (endDateISO < todayISO) return; // событие (или весь его диапазон) уже прошло

    const img = $el.find('img').first();
    const photoRaw = img.attr('data-src') || img.attr('src') || null;
    const photo = photoRaw && !photoRaw.includes('lazy_placeholder') ? photoRaw : null;

    events.push({
      id: 'rvbar_vlg_' + slug,
      slug,
      title: slugToTitle(slug),
      dateISO,
      date: `${parseInt(day, 10)} ${MONTHS_FULL[month]} ${year}`,
      dateShort: `${parseInt(day, 10)} ${MONTHS_SHORT[month]}`,
      time: '20:00',
      photo,
      ticketUrl: href.startsWith('http') ? href : `${BASE_URL}${href}`,
      venue: VENUE_NAME,
      venueAddr: VENUE_ADDR,
    });
  });

  return events;
}

async function loadExisting(baseUrl) {
  try {
    const r = await fetch(`${baseUrl}/api/store?key=rvbarEvents`);
    const j = await r.json();
    return (j && j.ok && j.value) ? j.value : {};
  } catch (e) {
    return {};
  }
}

async function saveResult(baseUrl, byId) {
  await fetch(`${baseUrl}/api/store`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'rvbarEvents', value: byId }),
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const isCron = req.headers['x-vercel-cron'] || req.query.manual === '1';
  if (!isCron) {
    return res.status(403).json({ error: 'forbidden', message: 'Добавьте ?manual=1 для ручного запуска' });
  }

  try {
    const html = await fetchPage();
    const events = parseEvents(html);

    const byId = {};
    events.forEach(e => { byId[e.id] = e; });

    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${proto}://${host}`;

    const existing = await loadExisting(baseUrl);
    const newIds = Object.keys(byId).filter(id => !existing[id]);

    await saveResult(baseUrl, byId);

    return res.status(200).json({
      ok: true,
      totalFound: Object.keys(byId).length,
      newCount: newIds.length,
      titles: Object.values(byId).map(e => e.title + ' | ' + e.dateISO),
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[sync-rvbar] error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
