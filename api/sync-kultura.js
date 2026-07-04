// /api/sync-kultura.js — еженедельная проверка афиши kulturahall.ru
// Площадка «Kultura Concert Hall», Волгоград, наб. 62-й Армии, д.6.
// Сайт построен на Astro (SSR) — отдаёт реальный HTML без выполнения JS, парсится
// обычным серверным fetch (в отличие от Кроп Арены, где контент рисуется JS в браузере).
//
// Якорь надёжности: постеры хостятся на ticketscloud.com, у каждого <img> есть alt
// с ТОЧНЫМ названием события — не нужно гадать заголовок через <h*>.

import * as cheerio from 'cheerio';

const SOURCE_URL = 'https://kulturahall.ru/';
const VENUE_NAME = 'Kultura Concert Hall';
const VENUE_ADDR = 'наб. 62-й Армии, д.6, Волгоград';

const MONTHS = {
  'января': '01', 'февраля': '02', 'марта': '03', 'апреля': '04',
  'мая': '05', 'июня': '06', 'июля': '07', 'августа': '08',
  'сентября': '09', 'октября': '10', 'ноября': '11', 'декабря': '12',
};
const MONTHS_SHORT = {
  '01': 'янв', '02': 'фев', '03': 'мар', '04': 'апр', '05': 'мая', '06': 'июн',
  '07': 'июл', '08': 'авг', '09': 'сен', '10': 'окт', '11': 'ноя', '12': 'дек',
};
const MONTHS_FULL = {
  '01':'января','02':'февраля','03':'марта','04':'апреля','05':'мая','06':'июня',
  '07':'июля','08':'августа','09':'сентября','10':'октября','11':'ноября','12':'декабря',
};
const DATE_RE = /(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})/;
const TIME_RE = /(\d{1,2}):(\d{2})/;
const PRICE_RE = /от\s+([\d\s]+)[.,]?\d*\s*₽/;

async function fetchPage() {
  const res = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; afishiru-sync/1.0)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`fetch ${SOURCE_URL} -> ${res.status}`);
  return res.text();
}

function slugify(title) {
  return title.toLowerCase()
    .replace(/[^a-zа-я0-9\s-]/gi, '')
    .trim().replace(/\s+/g, '-')
    .replace(/[а-я]/g, ''); // упрощённо — латиница/цифры для id, кириллицу в slug не тащим
}

function parseEvents(html) {
  const $ = cheerio.load(html);
  const events = [];
  const seenKeys = new Set();

  $('img[src*="ticketscloud.com"]').each((_, imgEl) => {
    const $img = $(imgEl);
    const title = ($img.attr('alt') || '').trim();
    const photo = $img.attr('src') || '';
    if (!title) return;

    // Найти ближайшего предка, где есть дата — это и есть карточка события
    let card = $img.parent();
    let cardText = '';
    for (let hops = 0; hops < 6; hops++) {
      if (!card || card.length === 0) break;
      cardText = card.text().replace(/\s+/g, ' ').trim();
      if (DATE_RE.test(cardText) && cardText.length < 600) break;
      card = card.parent();
    }

    const dateMatch = cardText.match(DATE_RE);
    if (!dateMatch) return;
    const timeMatch = cardText.match(TIME_RE);
    const day = dateMatch[1].padStart(2, '0');
    const monthNum = MONTHS[dateMatch[2]];
    const year = dateMatch[3];
    const dateISO = `${year}-${monthNum}-${day}`;
    const time = timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : '19:00';

    const ageMatch = cardText.match(/\b(0|3|6|12|16|18)\+/);
    const age = ageMatch ? ageMatch[0] : '0+';

    const priceMatch = cardText.match(PRICE_RE);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/\s/g, ''), 10) : 0;

    // Дедуп по названию+дате (одно и то же событие может повторяться в разных
    // блоках страницы — "Популярное" и "Интересное")
    const key = title.toLowerCase() + '|' + dateISO;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);

    const idSlug = slugify(title) || Buffer.from(title).toString('hex').slice(0, 16);
    events.push({
      id: 'khall_' + idSlug + '_' + dateISO,
      title,
      dateISO,
      date: `${parseInt(day, 10)} ${MONTHS_FULL[monthNum]} ${year}`,
      dateShort: `${parseInt(day, 10)} ${MONTHS_SHORT[monthNum]}`,
      time,
      age,
      price,
      photo,
      ticketUrl: SOURCE_URL,
      venue: VENUE_NAME,
      venueAddr: VENUE_ADDR,
    });
  });

  return events;
}

async function loadExisting(baseUrl) {
  try {
    const r = await fetch(`${baseUrl}/api/store?key=kulturaHallEvents`);
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
    body: JSON.stringify({ key: 'kulturaHallEvents', value: byId }),
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
      titles: Object.values(byId).map(e => e.title + ' | ' + e.dateISO + ' | от ' + e.price + '₽ | ' + e.age),
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[sync-kultura] error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
