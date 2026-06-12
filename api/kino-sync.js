// /api/kino-sync.js — парсер расписания кинотеатров Волгограда
// Источник: kinoafisha.info/g-volgograd/cinema/
// Запускается: ежедневно в 11:00 UTC (14:00 МСК)

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
