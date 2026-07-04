// /api/trailer-sync-events.js — еженедельная проверка трейлеров для концертов и спектаклей
// Построен по тому же принципу, что и api/trailer-sync.js (фильмы):
// ищем видео СТРОГО на канале @afishiru по совпадению названия. Если не нашли — оставляем
// без трейлера. Никакого поиска/скачивания чужих роликов — та же осознанная политика,
// что уже действует для фильмов ("ОТКЛЮЧЕНО: трейлеры только с @afishiru канала").
//
// Расписание (см. vercel.json):
//   Суббота — концерты (key: concertTrailers)
//   Воскресенье — спектакли (key: theaterTrailers)

const YT_KEY = process.env.YOUTUBE_API_KEY;
const AFISHIRU_CH_ID = 'UC6Lc1N2a72hWWroW6Afn2xA'; // @afishiru

function verifyCron(req) {
  const isVercelCron = !!req.headers['x-vercel-cron'];
  const isManual = req.query.manual === '1';
  return isVercelCron || isManual;
}

async function getChannelVideos(channelId) {
  const allVideos = [];
  let pageToken = '';
  let pages = 0;
  while (pages < 10) {
    const url = `https://www.googleapis.com/youtube/v3/search?key=${YT_KEY}&channelId=${channelId}&part=snippet&type=video&maxResults=50&order=date${pageToken ? '&pageToken=' + pageToken : ''}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) { console.error('[YT] API error:', JSON.stringify(data.error)); break; }
      const items = data.items || [];
      for (const item of items) {
        allVideos.push({
          video_id: item.id.videoId,
          title: item.snippet.title,
          url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        });
      }
      pageToken = data.nextPageToken || '';
      pages++;
      if (!pageToken || items.length < 50) break;
    } catch (e) { break; }
  }
  return allVideos;
}

function cleanTitle(t) {
  return (t || '').toLowerCase().replace(/[:\-–—.!?«»"']/g, ' ').replace(/\s+/g, ' ').trim();
}

// Тот же алгоритм сопоставления, что и для фильмов — точное вхождение, ключевые слова,
// частичное совпадение (75% названия)
function findTrailerOnChannel(title, channelVideos) {
  const titleClean = cleanTitle(title);
  if (titleClean.length < 3) return null;
  const keywords = titleClean.split(' ').filter(w => w.length > 2).slice(0, 3);

  for (const video of channelVideos) {
    const vtClean = cleanTitle(video.title);
    if (vtClean.includes(titleClean)) return video;
    if (keywords.length >= 2 && keywords.every(w => vtClean.includes(w))) return video;
    const partial = titleClean.substring(0, Math.floor(titleClean.length * 0.75));
    if (partial.length > 5 && vtClean.includes(partial)) return video;
  }
  return null;
}

async function loadEventTitles(baseUrl, kind) {
  // kind: 'concert' | 'theater' — читаем актуальные данные напрямую со страниц сайта
  const page = kind === 'concert' ? 'concerts.html' : 'theater.html';
  const res = await fetch(`${baseUrl}/${page}`);
  const html = await res.text();

  if (kind === 'concert') {
    const m = html.match(/(var _today[\s\S]*?const CONCERTS\s*=\s*\[[\s\S]*?\n\];)/);
    if (!m) return [];
    try {
      const arr = new Function(m[1] + '\nreturn CONCERTS;')();
      return arr.map(c => ({ id: c.id, title: c.title }));
    } catch (e) { return []; }
  } else {
    const m = html.match(/var THEATERS_DB\s*=\s*\{[\s\S]*?\n\};/);
    if (!m) return [];
    try {
      const db = new Function('return ' + m[0].replace('var THEATERS_DB = ', '').replace(/;\s*$/, ''))();
      const titles = [];
      Object.keys(db).forEach(city => {
        (db[city] || []).forEach(venue => {
          (venue.events || []).forEach((ev, i) => {
            titles.push({ id: venue.id + '_' + i, title: ev.title });
          });
        });
      });
      return titles;
    } catch (e) { return []; }
  }
}

async function saveTrailers(baseUrl, key, byId) {
  await fetch(`${baseUrl}/api/store`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value: byId }),
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (!verifyCron(req)) {
    return res.status(403).json({ error: 'forbidden', message: 'Добавьте ?manual=1 для ручного запуска' });
  }

  if (!YT_KEY) {
    return res.status(503).json({ error: 'youtube_api_not_configured', message: 'YOUTUBE_API_KEY не установлен' });
  }

  // По умолчанию: суббота = концерты, воскресенье = спектакли.
  // ?kind=concert|theater — форсировать конкретный тип при ручном запуске.
  const today = new Date().getDay(); // 0=вс, 6=сб
  const kind = req.query.kind || (today === 0 ? 'theater' : 'concert');
  const storeKey = kind === 'theater' ? 'theaterTrailers' : 'concertTrailers';

  try {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${proto}://${host}`;

    const [items, channelVideos] = await Promise.all([
      loadEventTitles(baseUrl, kind),
      getChannelVideos(AFISHIRU_CH_ID),
    ]);

    const byId = {};
    let foundCount = 0;
    items.forEach(item => {
      const match = findTrailerOnChannel(item.title, channelVideos);
      if (match) {
        byId[item.id] = { videoId: match.video_id, url: match.url, title: match.title };
        foundCount++;
      }
    });

    await saveTrailers(baseUrl, storeKey, byId);

    return res.status(200).json({
      ok: true,
      kind,
      totalItems: items.length,
      trailersFound: foundCount,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[trailer-sync-events] error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
