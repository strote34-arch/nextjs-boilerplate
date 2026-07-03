// /api/sync-filarmonia.js — еженедельный автопарсер афиши volgogradfilarmonia.ru
// Запускается по расписанию (см. vercel.json -> crons), либо вручную GET-запросом.
// Скачивает все страницы афиши, вытаскивает события, сравнивает с уже сохранёнными
// на сервере и добавляет новинки. Сохраняет в /api/store под ключом 'filarmoniaEvents'.
//
// ВАЖНО: страница источника не отдаёт чистый JSON — это обычный HTML-сайт на своём
// движке. Парсер построен на регулярных выражениях по разметке, актуальной на
// 2026-07-03. Если владелец сайта поменяет вёрстку — парсер может начать пропускать
// события или падать; тогда проверьте /api/sync-filarmonia?dry=1 для диагностики.

const SOURCE_BASE = 'https://volgogradfilarmonia.ru/afishi/concerts';
const PAGES = [0, 20, 40]; // ?start=0/20/40 — 3 страницы афиши

const MONTHS = {
  'января': '01', 'февраля': '02', 'марта': '03', 'апреля': '04',
  'мая': '05', 'июня': '06', 'июля': '07', 'августа': '08',
  'сентября': '09', 'октября': '10', 'ноября': '11', 'декабря': '12',
};
const MONTHS_SHORT = {
  '01': 'янв', '02': 'фев', '03': 'мар', '04': 'апр', '05': 'мая', '06': 'июн',
  '07': 'июл', '08': 'авг', '09': 'сен', '10': 'окт', '11': 'ноя', '12': 'дек',
};

async function fetchPage(start) {
  const url = start ? `${SOURCE_BASE}?start=${start}` : SOURCE_BASE;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; afishiru-sync/1.0)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}

function parseEvents(html) {
  // Разбиваем страницу на блоки по ссылкам на детальную страницу события —
  // это самый стабильный якорь в разметке (не завязан на конкретные CSS-классы)
  const linkRe = /afishi\/concerts\/([a-z0-9-]+)/g;
  const positions = [];
  let m;
  while ((m = linkRe.exec(html))) positions.push({ slug: m[1], idx: m.index });

  // Оставляем только первое вхождение каждого slug (детальная ссылка встречается
  // несколько раз на карточке — картинка, кнопка, заголовок, "поделиться")
  const seen = new Set();
  const uniquePositions = [];
  for (const p of positions) {
    if (seen.has(p.slug)) continue;
    seen.add(p.slug);
    uniquePositions.push(p);
  }

  const events = [];
  for (let i = 0; i < uniquePositions.length; i++) {
    const { slug, idx } = uniquePositions[i];
    const nextIdx = i + 1 < uniquePositions.length ? uniquePositions[i + 1].idx : html.length;
    // Небольшой запас назад — картинка обычно идёт ДО первого вхождения ссылки на слаг
    const chunkStart = Math.max(0, idx - 600);
    const chunk = html.slice(chunkStart, nextIdx);

    // Дата + время: "20 августа Четверг 18:30" (после конвертации в текст) —
    // в сырой разметке ищем похожий паттерн рядом с русскими месяцами
    const dateMatch = chunk.match(
      /(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)[^\d]{0,20}(\d{1,2}):(\d{2})/
    );
    if (!dateMatch) continue; // без даты — не событие, пропускаем (могло быть служебной ссылкой)

    const day = dateMatch[1].padStart(2, '0');
    const monthRu = dateMatch[2];
    const monthNum = MONTHS[monthRu];
    const hh = dateMatch[3].padStart(2, '0');
    const mm = dateMatch[4];
    const time = `${hh}:${mm}`;

    // Год определяем по "Сезон YYYY – YYYY" рядом, иначе — по эвристике (текущий/следующий)
    const seasonMatch = chunk.match(/Сезон\s+(\d{4})\s*[–-]\s*(\d{4})/);
    let year;
    if (seasonMatch) {
      const y1 = parseInt(seasonMatch[1], 10);
      const y2 = parseInt(seasonMatch[2], 10);
      // Сезон идёт с осени по лето: месяцы 08-12 -> первый год сезона, 01-07 -> второй
      year = parseInt(monthNum, 10) >= 8 ? y1 : y2;
    } else {
      // fallback: берём ближайший будущий год
      const now = new Date();
      year = now.getFullYear();
      const candidate = new Date(year, parseInt(monthNum, 10) - 1, parseInt(day, 10));
      if (candidate < now) year += 1;
    }
    const dateISO = `${year}-${monthNum}-${day}`;

    // Заголовок — первый "## " markdown-style заголовок ИЛИ <h2>/<h3> в HTML
    let title = null;
    const h2Md = chunk.match(/##\s+(.+)/);
    const h2Html = chunk.match(/<h[23][^>]*>([^<]+)<\/h[23]>/i);
    if (h2Html) title = h2Html[1].trim();
    else if (h2Md) title = h2Md[1].trim();
    if (!title) continue;

    // Площадка — ищем известную формулировку зала филармонии; если её нет —
    // событие проходит на выездной площадке (Елань, Палласовка и т.п.), пропускаем,
    // т.к. сайт покрывает только Волгоград
    const isMainHall = /Концертный зал Волгоградской филармонии/i.test(chunk);
    if (!isMainHall) continue;

    // Постер
    const imgMatch = chunk.match(/cache\/introtumbs\/([^"'()]+\.(?:jpg|png))/i);
    const photo = imgMatch ? `https://volgogradfilarmonia.ru/cache/introtumbs/${imgMatch[1]}` : null;

    // Пушкинская карта — иконка push.png где-то в блоке
    const pushkin = /push\.png/i.test(chunk);

    // Возрастной рейтинг, если указан явно (12+, 16+, 18+, 6+, 0+, 3+)
    const ageMatch = chunk.match(/\b(0|3|6|12|16|18)\+/);
    const age = ageMatch ? ageMatch[0] : '0+';

    // Концерт или спектакль? Ищем характерные слова рядом с событием.
    // Филармония в основном даёт концерты, но регулярно привозит гастрольные
    // антрепризные спектакли — их нужно показывать в разделе «Театр», не «Концерты»
    const isSpectacle = /(?:^|\W)(спектакль|постановка|антреприза|моноспектакль|трагикомедия)(?:\W|$)/i.test(chunk);

    events.push({
      id: 'vfauto_' + slug,
      slug,
      title,
      dateISO,
      date: `${parseInt(day, 10)} ${monthLongRu(monthNum)} ${year}`,
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

function monthLongRu(mm) {
  const map = { '01':'января','02':'февраля','03':'марта','04':'апреля','05':'мая','06':'июня',
    '07':'июля','08':'августа','09':'сентября','10':'октября','11':'ноября','12':'декабря' };
  return map[mm] || '';
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

  // Защита от произвольного публичного запуска — крон Vercel шлёт этот заголовок
  const isCron = req.headers['x-vercel-cron'] || req.query.manual === '1';
  if (!isCron) {
    return res.status(403).json({ error: 'forbidden', message: 'Добавьте ?manual=1 для ручного запуска' });
  }

  try {
    const pageResults = await Promise.allSettled(PAGES.map(fetchPage));
    let allEvents = [];
    pageResults.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        allEvents = allEvents.concat(parseEvents(r.value));
      } else {
        console.error('[sync-filarmonia] page', PAGES[i], 'failed:', r.reason && r.reason.message);
      }
    });

    // Дедуп по slug (на случай пересечения страниц)
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
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[sync-filarmonia] error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
