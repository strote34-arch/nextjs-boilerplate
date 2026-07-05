// /api/sync-restvlg.js — еженедельная проверка афиши restvlg.ru/#afisha
// (Ресторан «Волгоград», события организует «Сизокрылый»).
// Сайт на Tilda — реальная структура карточки события (t776__col):
//   <div class="t776__col ... js-product">
//     <a class="js-product-link" href="TICKET_OR_QTICKETS_URL">
//       <img data-original="ПОЛНОЕ_ФОТО" .../>
//       <div class="t776__title">НАЗВАНИЕ</div>
//       <div class="t776__descr">ОПИСАНИЕ</div>
//       <div class="t776__price-value js-product-price">DD.MM HH:MM [— HH:MM]</div>
//     </a>
//     <div class="t776__btn-wrapper">
//       <a class="t776__btn" href="...">Купить билет / Забронировать</a>
//       <a class="t776__btn_second" href="...">Подробнее</a>
//     </div>
//   </div>
// Дата на сайте БЕЗ ГОДА (напр. "03.07 22:00") — год определяем сами: если
// получившаяся дата уже в прошлом относительно сегодня — берём следующий год.

import * as cheerio from 'cheerio';

const SOURCE_URL = 'https://restvlg.ru/';
const VENUE_NAME = 'Ресторан «Волгоград»';
const VENUE_ADDR = 'Волгоград';

const MONTHS_SHORT = {
  '01': 'янв', '02': 'фев', '03': 'мар', '04': 'апр', '05': 'мая', '06': 'июн',
  '07': 'июл', '08': 'авг', '09': 'сен', '10': 'окт', '11': 'ноя', '12': 'дек',
};
const MONTHS_FULL = {
  '01':'января','02':'февраля','03':'марта','04':'апреля','05':'мая','06':'июня',
  '07':'июля','08':'августа','09':'сентября','10':'октября','11':'ноября','12':'декабря',
};
const DATE_TIME_RE = /(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})/;

async function fetchPage() {
  const res = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; afishiru-sync/1.0)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`fetch ${SOURCE_URL} -> ${res.status}`);
  return res.text();
}

function resolveYear(month, day, hour, minute) {
  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, parseInt(month, 10) - 1, parseInt(day, 10), parseInt(hour, 10), parseInt(minute, 10));
  // Если получившаяся дата уже прошла больше чем на сутки — значит, речь про следующий год
  if (candidate.getTime() < now.getTime() - 24 * 3600 * 1000) year += 1;
  return year;
}

function parseEvents(html) {
  const $ = cheerio.load(html);
  const events = [];
  const seenIds = new Set();

  $('.js-product').each((_, el) => {
    const $el = $(el);
    const lid = $el.attr('data-product-lid') || '';
    if (!lid || seenIds.has(lid)) return;
    seenIds.add(lid);

    const title = $el.find('.t776__title').first().text().replace(/\s+/g, ' ').trim();
    if (!title) return;

    const desc = $el.find('.t776__descr').first().text().replace(/\s+/g, ' ').trim();
    const priceText = $el.find('.t776__price-value').first().text().trim();
    const dateMatch = priceText.match(DATE_TIME_RE);
    if (!dateMatch) return; // без даты — не событие (например, скрытый шаблон)

    const day = dateMatch[1].padStart(2, '0');
    const month = dateMatch[2].padStart(2, '0');
    const hour = dateMatch[3].padStart(2, '0');
    const minute = dateMatch[4];
    const year = resolveYear(month, day, hour, minute);
    const dateISO = `${year}-${month}-${day}`;

    const todayISO = new Date().toISOString().slice(0, 10);
    if (dateISO < todayISO) return; // прошедшее — пропускаем

    const img = $el.find('img').first();
    const photo = img.attr('data-original') || img.attr('src') || null;

    // Билет: первая кнопка (не "Подробнее"), иначе основная ссылка карточки
    let ticketUrl = null;
    $el.find('.t776__btn-wrapper a').each((_, a) => {
      const $a = $(a);
      if (!$a.hasClass('t776__btn_second') && !ticketUrl) {
        ticketUrl = $a.attr('href');
      }
    });
    if (!ticketUrl) ticketUrl = $el.find('.js-product-link').first().attr('href') || SOURCE_URL;

    events.push({
      id: 'restvlg_' + lid,
      title,
      desc,
      dateISO,
      date: `${parseInt(day, 10)} ${MONTHS_FULL[month]} ${year}`,
      dateShort: `${parseInt(day, 10)} ${MONTHS_SHORT[month]}`,
      time: `${hour}:${minute}`,
      photo,
      ticketUrl,
      venue: VENUE_NAME,
      venueAddr: VENUE_ADDR,
    });
  });

  return events;
}

async function loadExisting(baseUrl) {
  try {
    const r = await fetch(`${baseUrl}/api/store?key=restvlgEvents`);
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
    body: JSON.stringify({ key: 'restvlgEvents', value: byId }),
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
      titles: Object.values(byId).map(e => e.title + ' | ' + e.dateISO + ' ' + e.time),
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[sync-restvlg] error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
