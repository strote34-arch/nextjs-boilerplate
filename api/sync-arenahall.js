// /api/sync-arenahall.js — еженедельная проверка афиши arenahall.info по ВСЕМ городам сети.
// Сайт — обычный статический HTML (Bitrix CMS), не JS-приложение — парсится
// стандартным серверным fetch. Каждое событие — <div class="item-box"> с чёткой
// структурой: постер, <h4>Название</h4>, и <p> с городом/площадкой/датой/временем/ценой.
//
// В Волгограде на странице показываются события НЕСКОЛЬКИХ площадок (КРОП АРЕНА,
// а также сторонний FERRUM) — оставляем только КРОП АРЕНА. Для остальных городов
// точное название их конкретной площадки сети нам неизвестно (не хотим гадать),
// поэтому берём площадку ТОЧНО ТАК, как она указана на странице, без фильтра.

import * as cheerio from 'cheerio';

const BASE_URL = 'https://arenahall.info';
const CITIES = [
  { path: 'krd', name: 'Краснодар' },
  { path: 'rst', name: 'Ростов-на-Дону' },
  { path: 'vrn', name: 'Воронеж' },
  { path: 'vlg', name: 'Волгоград', venueFilter: 'КРОП АРЕНА', venueNameOverride: 'Кроп Арена', venueAddrOverride: 'Университетский просп., 107 (ТЦ «Акварель»), Волгоград' },
  { path: 'stl', name: 'Ставрополь' },
  { path: 'srt', name: 'Саратов' },
  { path: 'sch', name: 'Сочи' },
  { path: 'msk', name: 'Москва' },
];

const MONTHS_SHORT = {
  '01': 'янв', '02': 'фев', '03': 'мар', '04': 'апр', '05': 'мая', '06': 'июн',
  '07': 'июл', '08': 'авг', '09': 'сен', '10': 'окт', '11': 'ноя', '12': 'дек',
};
const MONTHS_FULL = {
  '01':'января','02':'февраля','03':'марта','04':'апреля','05':'мая','06':'июня',
  '07':'июля','08':'августа','09':'сентября','10':'октября','11':'ноября','12':'декабря',
};
const DATE_RE = /(\d{2})\.(\d{2})\.(\d{4})/;
const TIME_RE = /(\d{1,2}):(\d{2}):\d{2}/;
const PRICE_RE = /(\d[\d ]*)\s*руб/;

async function fetchCityPage(cityPath) {
  const url = `${BASE_URL}/${cityPath}/e/`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; afishiru-sync/1.0)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}

function parseEvents(html, city) {
  const $ = cheerio.load(html);
  const events = [];
  const seenSlugs = new Set();

  $('div.item-box').each((_, el) => {
    const $el = $(el);
    const href = $el.find('a.item-hover').first().attr('href') || '';
    const slugMatch = href.match(/\/e\/([a-z0-9_-]+)\//i);
    if (!slugMatch) return;
    const slug = slugMatch[1];
    if (seenSlugs.has(slug)) return; // страница дублирует карусель + мобильный список
    seenSlugs.add(slug);

    const title = $el.find('h4').first().text().trim();
    if (!title) return;

    const pText = $el.find('.item-box-desc p').first();
    const pHtml = pText.html() || '';
    // <a>Город</a><br><a>ПЛОЩАДКА, адрес</a><br>ДАТА<br>ВРЕМЯ<br>ЦЕНА руб.
    const venueLinkMatch = pHtml.match(/<a[^>]*>([^<]*)<\/a>\s*<br\s*\/?>\s*<a[^>]*>([^<]*)<\/a>/i);
    const venueFull = venueLinkMatch ? venueLinkMatch[2].trim() : '';

    // Фильтр по конкретной площадке — только там, где мы её точно знаем (Волгоград)
    if (city.venueFilter && !venueFull.toUpperCase().includes(city.venueFilter)) return;

    const plainText = pText.text();
    const dateMatch = plainText.match(DATE_RE);
    if (!dateMatch) return;
    const timeMatch = plainText.match(TIME_RE);
    const priceMatch = plainText.match(PRICE_RE);

    const day = dateMatch[1];
    const monthNum = dateMatch[2];
    const year = dateMatch[3];
    const dateISO = `${year}-${monthNum}-${day}`;

    // Пропускаем абонементы (не единичное мероприятие) и явно прошедшие даты
    if (/абонемент/i.test(title)) return;
    const todayISO = new Date().toISOString().slice(0, 10);
    if (dateISO < todayISO) return;

    const time = timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : '19:00';
    const price = priceMatch ? parseInt(priceMatch[1].replace(/\s/g, ''), 10) : 0;

    const imgSrc = $el.find('img').first().attr('src') || '';
    const photo = imgSrc ? new URL(imgSrc, BASE_URL).href : null;

    const commaIdx = venueFull.indexOf(',');
    const venueName = city.venueNameOverride || (commaIdx >= 0 ? venueFull.slice(0, commaIdx).trim() : venueFull);
    const venueAddr = city.venueAddrOverride || (commaIdx >= 0 ? venueFull.slice(commaIdx + 1).trim() + ', ' + city.name : city.name);

    events.push({
      id: 'arenahall_' + city.path + '_' + slug,
      slug,
      title,
      dateISO,
      date: `${parseInt(day, 10)} ${MONTHS_FULL[monthNum]} ${year}`,
      dateShort: `${parseInt(day, 10)} ${MONTHS_SHORT[monthNum]}`,
      time,
      price,
      photo,
      city: city.name,
      venueName: venueName || 'Arena Hall',
      venueAddr,
      ticketUrl: `${BASE_URL}${href}`,
    });
  });

  return events;
}

async function loadExisting(baseUrl) {
  try {
    const r = await fetch(`${baseUrl}/api/store?key=arenaHallEvents`);
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
    body: JSON.stringify({ key: 'arenaHallEvents', value: byId }),
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
    const cityResults = await Promise.allSettled(
      CITIES.map(city => fetchCityPage(city.path).then(html => parseEvents(html, city)))
    );

    let allEvents = [];
    const perCityCount = {};
    cityResults.forEach((r, i) => {
      const city = CITIES[i];
      if (r.status === 'fulfilled') {
        allEvents = allEvents.concat(r.value);
        perCityCount[city.name] = r.value.length;
      } else {
        console.error('[sync-arenahall]', city.name, 'failed:', r.reason && r.reason.message);
        perCityCount[city.name] = 'ошибка: ' + (r.reason && r.reason.message);
      }
    });

    const byId = {};
    allEvents.forEach(e => { byId[e.id] = e; });

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
      perCity: perCityCount,
      titles: Object.values(byId).map(e => e.city + ' | ' + e.title + ' | ' + e.dateISO + ' | от ' + e.price + '₽'),
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[sync-arenahall] error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
