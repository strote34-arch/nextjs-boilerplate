// ╔══════════════════════════════════════════════════════════════╗
// ║  /api/trailer-sync.js — Vercel Serverless Function          ║
// ║  Запускается Vercel Cron каждый день в 13:00 MSK            ║
// ║                                                              ║
// ║  Что делает:                                                 ║
// ║  1. TMDB → фильмы в кинотеатрах РФ                         ║
// ║  2. YouTube → проверить @afishiru канал                     ║
// ║  3. Если нет → найти русский трейлер на YouTube              ║
// ║  4. Сохранить результат → Workers KV                        ║
// ╚══════════════════════════════════════════════════════════════╝

const TMDB_KEY        = process.env.TMDB_API_KEY;
const YT_KEY          = process.env.YOUTUBE_API_KEY;
const WORKER_URL      = 'https://afishi-geo.strote34.workers.dev';
const AFISHIRU_CH_ID  = 'UC6Lc1N2a72hWWroW6Afn2xA'; // @afishiru YouTube канал

// Верификация Cron (только Vercel может вызывать)
function verifyCron(req) {
  return req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`;
}

// ── 1. TMDB: фильмы сейчас в кино в России ────────────────────
async function getMoviesInCinemas() {
  const url = `https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_KEY}&language=ru-RU&region=RU&page=1`;
  const res = await fetch(url);
  const data = await res.json();
  
  const upcoming_url = `https://api.themoviedb.org/3/movie/upcoming?api_key=${TMDB_KEY}&language=ru-RU&region=RU&page=1`;
  const upcoming_res = await fetch(upcoming_url);
  const upcoming_data = await upcoming_res.json();
  
  const all = [
    ...(data.results || []),
    ...(upcoming_data.results || [])
  ];
  
  // Убрать дубликаты
  const seen = new Set();
  return all.filter(m => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  }).map(m => ({
    tmdb_id: m.id,
    title_ru: m.title,
    title_original: m.original_title,
    release_date: m.release_date,
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
    overview: m.overview,
    rating: m.vote_average
  }));
}

// ── 2. YouTube: получить все видео канала @afishiru ───────────
async function getChannelVideos(channelId) {
  const url = `https://www.googleapis.com/youtube/v3/search?key=${YT_KEY}&channelId=${channelId}&part=snippet&type=video&maxResults=50&order=date`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.items || []).map(item => ({
    video_id: item.id.videoId,
    title: item.snippet.title,
    url: `https://www.youtube.com/watch?v=${item.id.videoId}`
  }));
}

// ── 3. Найти ID канала @afishiru ──────────────────────────────
async function getChannelId(handle) {
  const url = `https://www.googleapis.com/youtube/v3/channels?key=${YT_KEY}&forHandle=${handle}&part=id,snippet&maxResults=1`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.items && data.items[0]) {
    return data.items[0].id;
  }
  return null;
}

// ── 4. Проверить — есть ли трейлер фильма на @afishiru ────────
function findTrailerOnChannel(movie, channelVideos) {
  const titleLower = (movie.title_ru || '').toLowerCase();
  const titleOrigLower = (movie.title_original || '').toLowerCase();
  
  for (const video of channelVideos) {
    const vTitle = video.title.toLowerCase();
    if (
      vTitle.includes(titleLower) ||
      (titleOrigLower.length > 3 && vTitle.includes(titleOrigLower)) ||
      (titleLower.length > 3 && vTitle.includes(titleLower.substring(0, Math.floor(titleLower.length * 0.7))))
    ) {
      return video;
    }
  }
  return null;
}

// ── 5. Найти русский трейлер на YouTube ───────────────────────
async function findRussianTrailer(movie) {
  // Сначала попробовать официальный TMDB трейлер
  const tmdbVideosUrl = `https://api.themoviedb.org/3/movie/${movie.tmdb_id}/videos?api_key=${TMDB_KEY}&language=ru-RU`;
  const tmdbRes = await fetch(tmdbVideosUrl);
  const tmdbData = await tmdbRes.json();
  
  const ruTrailer = (tmdbData.results || []).find(v => 
    v.site === 'YouTube' && 
    (v.type === 'Trailer' || v.type === 'Teaser') &&
    v.iso_639_1 === 'ru'
  );
  if (ruTrailer) {
    return {
      video_id: ruTrailer.key,
      title: ruTrailer.name,
      url: `https://www.youtube.com/watch?v=${ruTrailer.key}`,
      source: 'tmdb_ru'
    };
  }
  
  // Любой трейлер из TMDB
  const anyTrailer = (tmdbData.results || []).find(v => 
    v.site === 'YouTube' && v.type === 'Trailer'
  );
  if (anyTrailer) {
    return {
      video_id: anyTrailer.key,
      title: anyTrailer.name,
      url: `https://www.youtube.com/watch?v=${anyTrailer.key}`,
      source: 'tmdb_any'
    };
  }
  
  // YouTube поиск: "{название фильма} трейлер русский"
  const query = encodeURIComponent(`${movie.title_ru} трейлер 2026`);
  const ytSearchUrl = `https://www.googleapis.com/youtube/v3/search?key=${YT_KEY}&q=${query}&part=snippet&type=video&maxResults=3&relevanceLanguage=ru&videoCategoryId=1`;
  const ytRes = await fetch(ytSearchUrl);
  const ytData = await ytRes.json();
  
  if (ytData.items && ytData.items[0]) {
    const item = ytData.items[0];
    return {
      video_id: item.id.videoId,
      title: item.snippet.title,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      source: 'youtube_search'
    };
  }
  
  return null;
}

// ── 6. Сохранить в Workers KV через Worker endpoint ───────────
async function saveTrailerData(results) {
  const res = await fetch(`${WORKER_URL}/api/trailers/update`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'X-Cron-Secret': process.env.CRON_SECRET
    },
    body: JSON.stringify({ 
      trailers: results,
      updated_at: new Date().toISOString()
    })
  });
  return res.ok;
}

// ── MAIN ───────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Проверка что это Cron или авторизованный вызов
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // В production проверяем CRON_SECRET
  // Проверка Cron авторизации (Vercel автоматически добавляет Bearer)
  // При ручном запросе через браузер авторизация пропускается для теста
  if (process.env.NODE_ENV === 'production' && !verifyCron(req)) {
    // Разрешить без авторизации только GET запросы (для ручного тестирования)
    if (req.method !== 'GET') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  
  console.log(`[TrailerSync] Запуск: ${new Date().toISOString()}`);
  
  try {
    // Шаг 1: Получить фильмы из TMDB
    console.log('[TrailerSync] Загружаем фильмы из TMDB...');
    const movies = await getMoviesInCinemas();
    console.log(`[TrailerSync] Найдено ${movies.length} фильмов`);
    
    // Шаг 2: Получить ID канала @afishiru
    console.log('[TrailerSync] Получаем канал @afishiru...');
    const channelId = await getChannelId('afishiru');
    let channelVideos = [];
    if (channelId) {
      channelVideos = await getChannelVideos(channelId);
      console.log(`[TrailerSync] На канале ${channelVideos.length} видео`);
    }
    
    // Шаг 3: Для каждого фильма найти трейлер
    const results = [];
    for (const movie of movies) {
      // Сначала ищем на @afishiru
      const channelTrailer = findTrailerOnChannel(movie, channelVideos);
      
      if (channelTrailer) {
        results.push({
          ...movie,
          trailer: {
            ...channelTrailer,
            source: 'afishiru_channel'
          }
        });
        console.log(`[TrailerSync] ✅ @afishiru: ${movie.title_ru}`);
      } else {
        // Ищем на YouTube
        const youtubeTrailer = await findRussianTrailer(movie);
        results.push({
          ...movie,
          trailer: youtubeTrailer || null
        });
        if (youtubeTrailer) {
          console.log(`[TrailerSync] 🔍 YouTube: ${movie.title_ru} → ${youtubeTrailer.source}`);
        } else {
          console.log(`[TrailerSync] ❌ Не найден: ${movie.title_ru}`);
        }
        
        // Задержка чтобы не превысить квоту YouTube API
        await new Promise(r => setTimeout(r, 500));
      }
    }
    
    // Шаг 4: Сохранить результаты
    await saveTrailerData(results);
    
    const stats = {
      total: results.length,
      afishiru: results.filter(r => r.trailer?.source === 'afishiru_channel').length,
      tmdb: results.filter(r => r.trailer?.source?.startsWith('tmdb')).length,
      youtube: results.filter(r => r.trailer?.source === 'youtube_search').length,
      no_trailer: results.filter(r => !r.trailer).length
    };
    
    console.log('[TrailerSync] Готово:', stats);
    return res.status(200).json({ ok: true, stats, updated_at: new Date().toISOString() });
    
  } catch (err) {
    console.error('[TrailerSync] Ошибка:', err);
    return res.status(500).json({ error: err.message });
  }
}
