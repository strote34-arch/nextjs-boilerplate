// /api/sync-filarmonia.js — еженедельный автопарсер афиши volgogradfilarmonia.ru
// v3 — точные границы карточки события. Каждая карточка на сайте устроена так:
//   [картинка-ссылка на /afishi/concerts/SLUG] ... текст события ...
//   [ссылка-обёртка "Подробнее" на /afishi/concerts/SLUG с картинкой transparent.png]
// То есть slug встречается ДВАЖДЫ на карточку: в начале (постер) и в конце
// (invisible-обёртка "читать дальше"). Это даёт точную, надёжную границу карточки —
// в отличие от предыдущих версий, которые угадывали границу по эвристикам и путали
// заголовок/дату соседних событий.

import * as cheerio from 'cheerio';

const SOURCE_BASE = 'https://volgogradfilarmonia.ru/afishi/concerts';
const PAGES = [0, 20, 40];

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
const DATE_RE = /(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/;
const TIME_RE = /(\d{1,2}):(\d{2})/;

async function fetchPage(start) {
  const url = start ? `${SOURCE_BASE}?start=${start}` : SOURCE_BASE;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; afishiru-sync/3.0)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}

function parseEventsFromHtml(html) {
  // Найти ПЕРВОЕ вхождение каждой ссылки на детальную страницу события, по порядку
  // появления в документе. (Повторные вхождения того же slug — в блоках "Купить билет",
  // "поделиться", виджетах "похожие мероприятия" и т.п. — сознательно игнорируем,
  // они могут быть где угодно на странице и не годятся как граница карточки.)
  const linkRe = /<a\s[^>]*href=["']([^"']*\/afishi\/concerts\/([a-z0-9-]+))["'][^>]*>/gi;
  const seen = new Set();
  const firstOccurrences = []; // { slug, startIdx }, в порядке появления
  let m;
  while ((m = linkRe.exec(html))) {
    const slug = m[2];
    if (seen.has(slug)) continue;
    seen.add(slug);
    firstOccurrences.push({ slug, startIdx: m.index });
  }

  const events = [];

  for (let i = 0; i < firstOccurrences.length; i++) {
    const { slug, startIdx } = firstOccurrences[i];
    const endIdx = i + 1 < firstOccurrences.length ? firstOccurrences[i + 1].startIdx : html.length;
    const blockHtml = html.slice(startIdx, endIdx);

    const $ = cheerio.load(blockHtml);
    const cardText = $.root().text().replace(/\s+/g, ' ').trim();

    const dateMatch = cardText.match(DATE_RE);
    if (!dateMatch) continue;
    const timeMatch = cardText.match(TIME_RE);

    const day = dateMatch[1].padStart(2, '0');
    const monthNum = MONTHS[dateMatch[2]];
    const time = timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : '19:00';

    const seasonMatch = cardText.match(/Сезон\s+(\d{4})\s*[–-]\s*(\d{4})/);
    let year;
    if (seasonMatch) {
      year = parseInt(monthNum, 10) >= 8 ? parseInt(seasonMatch[1], 10) : parseInt(seasonMatch[2], 10);
    } else {
      const now = new Date();
      year = now.getFullYear();
      if (new Date(year, parseInt(monthNum, 10) - 1, parseInt(day, 10)) < now) year += 1;
    }
    const dateISO = `${year}-${monthNum}-${day}`;

    const title = $('h1,h2,h3,h4').first().text().trim();
    if (!title) continue;

    const isMainHall = /Концертный зал Волгоградской филармонии/i.test(cardText);
    if (!isMainHall) continue;

    const imgSrc = $('img').first().attr('src') || '';
    const photo = imgSrc
      ? (imgSrc.startsWith('http') ? imgSrc : new URL(imgSrc, SOURCE_BASE).href)
      : null;

    const pushkin = $('img[src*="push"]').length > 0;
    const ageMatch = cardText.match(/\b(0|3|6|12|16|18)\+/);
    const age = ageMatch ? ageMatch[0] : '0+';
    const isSpectacle = /(?:^|\s)(спектакль|постановка|антреприза|моноспектакль|трагикомедия)(?:\s|$)/i.test(cardText);

    events.push({
      id: 'vfauto_' + slug,
      slug,
      title,
      dateISO,
      date: `${parseInt(day, 10)} ${MONTHS_FULL[monthNum]} ${year}`,
      dateShort: `${parseInt(day, 10)} ${MONTHS_SHORT[monthNum]}`,
      time,
      age,
      pushkin,
      isSpectacle,
      photo,
      ticketUrl: `${SOURCE_BASE}/${slug}`,
    });
  }

  return events;
}

async function loadExisting(baseUrl) {
  try {
    const r = await fetch(`${baseUrl}/api/store?key=filarmoniaEvents`);
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
    body: JSON.stringify({ key: 'filarmoniaEvents', value: byId }),
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
    const pageResults = await Promise.allSettled(PAGES.map(fetchPage));
    let allEvents = [];
    pageResults.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        allEvents = allEvents.concat(parseEventsFromHtml(r.value));
      } else {
        console.error('[sync-filarmonia] page', PAGES[i], 'failed:', r.reason && r.reason.message);
      }
    });

    const bySlug = {};
    allEvents.forEach(e => { bySlug[e.slug] = e; });

    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${proto}://${host}`;

    const existing = await loadExisting(baseUrl);
    const newSlugs = Object.keys(bySlug).filter(slug => !existing['vfauto_' + slug]);

    const byId = {};
    Object.values(bySlug).forEach(e => { byId[e.id] = e; });

    await saveResult(baseUrl, byId);

    return res.status(200).json({
      ok: true,
      totalFound: Object.keys(bySlug).length,
      newCount: newSlugs.length,
      newSlugs,
      titles: Object.values(byId).map(e => e.title + ' (' + e.dateISO + ')'),
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[sync-filarmonia] error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
