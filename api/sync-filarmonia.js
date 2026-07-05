// /api/sync-filarmonia.js — еженедельный автопарсер афиши volgogradfilarmonia.ru
// v5 — переписан на основе РЕАЛЬНОГО исходного кода страницы (получен от владельца
// сайта через Ctrl+U). Каждое событие на странице — это отдельный
// <div itemprop="blogPost" itemscope itemtype="https://schema.org/BlogPosting">,
// это микроразметка schema.org, официальный и однозначный маркер границы карточки.
// Предыдущие версии (v1-v4) угадывали границу по тексту/ссылкам вслепую и путали
// данные соседних событий — с этим селектором такая путаница исключена в принципе.

import * as cheerio from 'cheerio';

const SOURCE_BASE = 'https://volgogradfilarmonia.ru/afishi/concerts';
const PAGES = [0, 20, 40, 60, 80];

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
const MAIN_HALL = 'Концертный зал Волгоградской филармонии';

async function fetchPage(start) {
  const url = start ? `${SOURCE_BASE}?start=${start}` : SOURCE_BASE;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; afishiru-sync/5.0)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}

function parseEventsFromHtml(html) {
  const $ = cheerio.load(html);
  const events = [];

  // Официальная микроразметка schema.org — надёжная, однозначная граница карточки
  $('div[itemprop="blogPost"]').each((_, el) => {
    const $el = $(el);

    // Slug — из ссылки на детальную страницу (news-image или news-link)
    const href = $el.find('a[href*="/afishi/concerts/"]').first().attr('href') || '';
    const slugMatch = href.match(/afishi\/concerts\/([a-z0-9-]+)/);
    if (!slugMatch) return;
    const slug = slugMatch[1];

    // Площадка — строго из <p class="pre-mesto">, не из всего текста карточки
    const venue = $el.find('p.pre-mesto').first().text().trim();
    if (!venue.startsWith(MAIN_HALL)) return; // выездная площадка — не наш город, пропускаем
    // (используем startsWith, а не точное совпадение — на сайте встречаются варианты
    // вида "Концертный зал Волгоградской филармонии, фойе" для отдельных залов/зон)

    // Дата и время — из <p class="pre-date">DD месяц ДеньНедели  HH:MM</p>
    const dateText = $el.find('p.pre-date').first().text();
    const dateMatch = dateText.match(DATE_RE);
    if (!dateMatch) return;
    const timeMatch = dateText.match(TIME_RE);
    const day = dateMatch[1].padStart(2, '0');
    const monthNum = MONTHS[dateMatch[2]];
    const time = timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : '19:00';

    // Год — из "Сезон YYYY – YYYY" в pre-intro. Сезон идёт СЕНТЯБРЬ→АВГУСТ, то есть
    // месяцы 09-12 относятся к ПЕРВОМУ году сезона, а 01-08 — ко ВТОРОМУ.
    // (Раньше было наоборот — из-за этого весь август 2026-го считался августом
    // 2025-го, то есть уже прошедшим).
    const introText = $el.find('p.pre-intro').first().text();
    const seasonMatch = introText.match(/Сезон\s+(\d{4})\s*[–-]\s*(\d{4})/);
    let year;
    if (seasonMatch) {
      const y1 = parseInt(seasonMatch[1], 10);
      const y2 = parseInt(seasonMatch[2], 10);
      year = parseInt(monthNum, 10) >= 9 ? y1 : y2;
    } else {
      // Нет явного сезона (напр. только "12+") — берём ближайшую будущую дату
      const now = new Date();
      year = now.getFullYear();
      if (new Date(year, parseInt(monthNum, 10) - 1, parseInt(day, 10)) < now) year += 1;
    }
    const dateISO = `${year}-${monthNum}-${day}`;

    // Заголовок — строго из <h2> внутри карточки
    const title = $el.find('h2').first().text().trim();
    if (!title) return;

    // Постер
    const imgSrc = $el.find('img[src*="/cache/introtumbs/"]').first().attr('src') || '';
    const photo = imgSrc ? new URL(imgSrc, SOURCE_BASE).href : null;

    // Пушкинская карта — точный класс иконки, не общий поиск по тексту
    const pushkin = $el.find('img.push-icon').length > 0;

    // Возраст — из pre-intro (иногда там ТОЛЬКО возраст, напр. "12+") или из текста карточки
    let age = '0+';
    const ageInIntro = introText.match(/\b(0|3|6|12|16|18)\+/);
    if (ageInIntro) {
      age = ageInIntro[0];
    } else {
      const bodyText = $el.text();
      const ageInBody = bodyText.match(/\b(0|3|6|12|16|18)\+/);
      if (ageInBody) age = ageInBody[0];
    }

    // Концерт или спектакль — по ключевым словам в тексте карточки
    const fullText = $el.text();
    const isSpectacle = /(?:^|\s)(спектакль|постановка|антреприза|моноспектакль|трагикомедия)/i.test(fullText);

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
  });

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
      titles: Object.values(byId).map(e => e.title + ' | ' + e.dateISO + ' | pushkin:' + e.pushkin + ' | spectacle:' + e.isSpectacle),
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[sync-filarmonia] error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
