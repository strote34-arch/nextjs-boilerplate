// /api/kino-sync.js — парсер расписания кинотеатров Волгограда
// Источник: kinoafisha.info/g-volgograd/cinema/
// Запускается: ежедневно в 11:00 UTC (14:00 МСК)
//
// ── Объединено с бывшим /api/kudago.js (освобождение слота под лимитом
// Vercel Hobby — 12 serverless-функций на деплой) ──
// Публичный вызов для concerts.html: /api/kino-sync?city=...&cat=...&page_size=...
// (наличие ?city= в запросе означает режим KudaGo, а не крон-синк кинотеатров)

async function handleKudago(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=1800');

  const city     = (req.query.city || 'volgograd').toLowerCase();
  const cat      = req.query.cat || '';
  const pageSize = Math.min(parseInt(req.query.page_size) || 20, 50);

  const slugMap = {
    'волгоград': 'volgograd', 'москва': 'msk',
    'санкт-петербург': 'spb', 'екатеринбург': 'ekb',
  };
  const slug = slugMap[city] || city;

  const today = Math.floor(Date.now() / 1000);
  const future = today + 30 * 24 * 3600;

  const catMap = {
    'concert': 'concert', 'concerts': 'concert',
    'theater': 'theater', 'exhibition': 'exhibition',
    'kids': 'kids', 'cinema': 'cinema', 'sport': 'sport',
    'other': 'other',
  };
  const kudagoCat = catMap[cat] || '';

  const params = new URLSearchParams({
    location:     slug,
    actual_since: today,
    actual_until: future,
    page_size:    pageSize,
    fields:       'id,title,description,place,dates,images,price,categories,age_restriction,is_free,site_url',
    expand:       'images,place,dates',
    order_by:     '-publication_date',
    text_format:  'plain',
    lang:         'ru',
  });
  if (kudagoCat) params.set('categories', kudagoCat);

  const apiUrl = `https://kudago.com/public-api/v1.4/events/?${params}`;

  try {
    const r = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'afishiru.ru/1.0',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error('[KudaGo] Error:', r.status, errText.slice(0, 200));
      return res.status(200).json({ ok: false, error: `KudaGo: ${r.status}`, events: [] });
    }

    const data = await r.json();

    const events = (data.results || []).map(e => {
      const date = e.dates?.[0];
      return {
        id:          e.id,
        title:       e.title || '',
        description: (e.description || '').slice(0, 400),
        category:    (e.categories || []).join(','),
        place:       e.place ? { name: e.place.title, address: e.place.address } : null,
        date_start:  date?.start || null,
        date_end:    date?.end   || null,
        image:       e.images?.[0]?.image || null,
        price:       e.price || (e.is_free ? 'Бесплатно' : ''),
        age:         e.age_restriction || 0,
        url:         e.site_url || `https://kudago.com/${slug}/event/${e.id}/`,
        is_free:     e.is_free || false,
      };
    });

    return res.status(200).json({
      ok:         true,
      city:       slug,
      count:      events.length,
      total:      data.count || 0,
      events,
      fetched_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[KudaGo] Fetch error:', err.message);
    return res.status(200).json({ ok: false, error: err.message, events: [] });
  }
}

const WORKER_URL = 'https://afishi-geo.strote34.workers.dev';
const CRON_SECRET = process.env.CRON_SECRET;

const CINEMAS_VOLGOGRAD = [
  { id: 'kinomax',    name: 'Киномакс Тандем',   url: 'https://kinoafisha.info/volgograd/cinema/kinomax-tandem/' },
  { id: 'sinemapark', name: 'Синема Парк',        url: 'https://kinoafisha.info/volgograd/cinema/sinema-park/' },
  { id: 'formular',   name: 'Формуляр',           url: 'https://kinoafisha.info/volgograd/cinema/formular/' },
];

async function parseCinemaSchedule(cinema) {
  const movies = [];
  try {
    // Использовать kinoafisha.info API вместо парсинга HTML
    const apiUrl = `https://kinoafisha.info/api/schedule/?city=volgograd&place=${cinema.id}&days=7`;
    const r = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (afishi.ru bot)' }
    });
    
    if (r.ok) {
      const data = await r.json();
      return (data.movies || []).map(m => ({
        id: `${cinema.id}_${m.id}`,
        title: m.title || m.name,
        title_en: m.title_en || '',
        genre: m.genres?.join(', ') || '',
        duration: m.duration,
        ageLimit: m.age_rating || '',
        poster: m.poster || m.image || '',
        sessions: (m.sessions || []).map(s => ({
          date: s.date,
          time: s.time,
          hall: s.hall || '',
          price: s.price_min ? `от ${s.price_min} ₽` : '',
          ticketUrl: s.buy_url || `https://vlg.kassir.ru/?utm_source=afishiru&utm_medium=cinema&utm_campaign=${cinema.id}`
        })),
        cinema: cinema.name,
        cinemaId: cinema.id
      }));
    }
    
    // Фоллбэк: TMDB поиск по названию
    return [];
  } catch(e) {
    console.warn(`[KinoSync] Ошибка ${cinema.name}:`, e.message);
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.query.city) return handleKudago(req, res);
  
  // Авторизация (только Cron или ручной запуск)
  const auth = req.headers['authorization'];
  if (process.env.NODE_ENV === 'production' && auth !== `Bearer ${CRON_SECRET}`) {
    if (req.method !== 'GET') return res.status(401).json({ error: 'Unauthorized' });
  }
  
  console.log('[KinoSync] Запуск:', new Date().toISOString());
  
  const allMovies = [];
  for (const cinema of CINEMAS_VOLGOGRAD) {
    console.log(`[KinoSync] Парсим ${cinema.name}...`);
    const movies = await parseCinemaSchedule(cinema);
    allMovies.push(...movies);
    console.log(`[KinoSync] ${cinema.name}: ${movies.length} фильмов`);
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Сохранить в Worker KV
  try {
    await fetch(`${WORKER_URL}/api/cinema/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Cron-Secret': CRON_SECRET || '' },
      body: JSON.stringify({ movies: allMovies, updated_at: new Date().toISOString() })
    });
  } catch(e) {
    console.warn('[KinoSync] Не удалось сохранить:', e.message);
  }
  
  res.status(200).json({
    ok: true,
    total: allMovies.length,
    cinemas: CINEMAS_VOLGOGRAD.map(c => c.name),
    updated_at: new Date().toISOString()
  });
}
