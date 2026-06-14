// ╔══════════════════════════════════════════════════════════════╗
// ║  /api/trailer-sync.js — Vercel Serverless Function          ║
// ║  Запускается Vercel Cron каждый день в 13:00 MSK            ║
// ║                                                              ║
// ║  Что делает:                                                 ║
// ║  1. TMDB → фильмы в кинотеатрах РФ                         ║
// ║  2. YouTube → проверить @afishiru канал                     ║
// ║  3. Если нет на @afishiru → оставить без трейлера            ║
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
  if (!TMDB_KEY || TMDB_KEY.length < 10) {
    console.error('[TMDB] TMDB_API_KEY не установлен или слишком короткий:', TMDB_KEY ? TMDB_KEY.slice(0,5) + '...' : 'undefined');
    return [];
  }
  const url = `https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_KEY}&language=ru-RU&page=1`;
  console.log('[TMDB] Запрос:', url.replace(TMDB_KEY, TMDB_KEY.slice(0,8)+'...'));
  const res = await fetch(url);
  console.log('[TMDB] Статус ответа:', res.status, res.statusText);
  const data = await res.json();
  if (!res.ok) {
    console.error('[TMDB] Ошибка API:', JSON.stringify(data).slice(0,200));
    return [];
  }
  console.log('[TMDB] Результаты now_playing:', (data.results||[]).length, '| total_results:', data.total_results);
  
  const upcoming_url = `https://api.themoviedb.org/3/movie/upcoming?api_key=${TMDB_KEY}&language=ru-RU&page=1`;
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
  // Берём ВСЕ видео канала через pagination (до 500 видео)
  const allVideos = [];
  let pageToken = '';
  let pages = 0;
  while (pages < 10) {
    const url = `https://www.googleapis.com/youtube/v3/search?key=${YT_KEY}&channelId=${channelId}&part=snippet&type=video&maxResults=50&order=date${pageToken ? '&pageToken='+pageToken : ''}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) { console.error('[YT] API error:', JSON.stringify(data.error)); break; }
      const items = data.items || [];
      for (const item of items) {
        allVideos.push({
          video_id: item.id.videoId,
          title: item.snippet.title,
          url: `https://www.youtube.com/watch?v=${item.id.videoId}`
        });
      }
      pageToken = data.nextPageToken || '';
      pages++;
      if (!pageToken || items.length < 50) break;
    } catch(e) { break; }
  }
  console.log(`[TrailerSync] @afishiru видео найдено: ${allVideos.length}`);
  return allVideos;
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
  const titleRu   = (movie.title_ru || '').toLowerCase().trim();
  const titleOrig = (movie.title_original || '').toLowerCase().trim();

  // Убрать лишние слова из названия для поиска
  const cleanTitle = (t) => t.replace(/[:\-–—.!?]/g, ' ').replace(/\s+/g, ' ').trim();
  const titleRuClean   = cleanTitle(titleRu);
  const titleOrigClean = cleanTitle(titleOrig);

  // Первые 2 слова (ключевые)
  const keywordsRu   = titleRuClean.split(' ').filter(w=>w.length>2).slice(0,3);
  const keywordsOrig = titleOrigClean.split(' ').filter(w=>w.length>2).slice(0,3);

  for (const video of channelVideos) {
    const vt = video.title.toLowerCase();
    const vtClean = cleanTitle(vt);

    // Точное вхождение русского названия
    if (titleRuClean.length > 3 && vtClean.includes(titleRuClean)) return video;
    // Точное вхождение оригинального
    if (titleOrigClean.length > 3 && vtClean.includes(titleOrigClean)) return video;
    // Ключевые слова (все первые 2-3 слова)
    if (keywordsRu.length >= 2 && keywordsRu.every(w => vtClean.includes(w))) return video;
    if (keywordsOrig.length >= 2 && keywordsOrig.every(w => vtClean.includes(w))) return video;
    // Частичное совпадение (70% названия)
    const partial = titleRuClean.substring(0, Math.floor(titleRuClean.length * 0.75));
    if (partial.length > 5 && vtClean.includes(partial)) return video;
  }
  return null;
}

// ── 5. Найти русский трейлер на YouTube ───────────────────────
async function findRussianTrailer(movie) {
  // ОТКЛЮЧЕНО: трейлеры только с @afishiru канала
  // YouTube поиск убран по требованию владельца
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


// ── Синк трейлеров для film-database ─────────────────────────
async function syncFilmDatabaseTrailers() {
  // Фильмы из TMDB — поиск, ныне идущие + предстоящие + популярные
  const urls = [
    `https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_KEY}&language=ru-RU&page=1`,
    `https://api.themoviedb.org/3/movie/upcoming?api_key=${TMDB_KEY}&language=ru-RU&page=1`,
    `https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_KEY}&language=ru-RU&page=1`,
    `https://api.themoviedb.org/3/movie/top_rated?api_key=${TMDB_KEY}&language=ru-RU&page=1`,
  ];
  
  const allFilms = [];
  const seen = new Set();
  
  for (const url of urls) {
    try {
      const r = await fetch(url);
      const d = await r.json();
      for (const m of (d.results || [])) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          allFilms.push(m);
        }
      }
    } catch(e) {}
  }
  
  console.log(`[FilmDB] Фильмов из TMDB: ${allFilms.length}`);
  
  // Для каждого фильма найти трейлер
  const filmResults = [];
  const channelId = AFISHIRU_CH_ID;
  let channelVideos = [];
  
  try {
    const chUrl = `https://www.googleapis.com/youtube/v3/search?key=${YT_KEY}&channelId=${channelId}&part=snippet&type=video&maxResults=50&order=date`;
    const chRes = await fetch(chUrl);
    const chData = await chRes.json();
    channelVideos = (chData.items || []).map(item => ({
      video_id: item.id.videoId,
      title: item.snippet.title,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`
    }));
    console.log(`[FilmDB] Видео на @afishiru: ${channelVideos.length}`);
  } catch(e) {}
  
  for (const movie of allFilms) {
    // Проверить @afishiru
    const chTrailer = findTrailerOnChannel(movie, channelVideos);
    let trailer = chTrailer ? { ...chTrailer, source: 'afishiru_channel' } : null;
    
    if (!trailer) {
      trailer = await findRussianTrailer(movie);
      await new Promise(r => setTimeout(r, 300));
    }
    
    filmResults.push({
      tmdb_id: movie.id,
      title_ru: movie.title,
      title_original: movie.original_title,
      release_date: movie.release_date,
      poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
      overview: movie.overview,
      rating: movie.vote_average,
      genre_ids: movie.genre_ids || [],
      trailer: trailer
    });
  }
  
  return filmResults;
}

// ── MAIN ───────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Проверка что это Cron или авторизованный вызов
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // В production проверяем CRON_SECRET
  // Авторизация: Vercel Cron автоматически добавляет Bearer токен
  // GET запросы разрешены без авторизации (для тестирования)
  const isAuthorized = verifyCron(req) || req.method === 'GET';
  if (!isAuthorized && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
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
    
    // Также синхронизировать film-database
    const filmDbResults = await syncFilmDatabaseTrailers();
    await saveTrailerData({ trailers: results, films: filmDbResults, updated_at: new Date().toISOString() });
    
    const stats = {
      total: results.length,
      afishiru: results.filter(r => r.trailer?.source === 'afishiru_channel').length,
      tmdb: results.filter(r => r.trailer?.source?.startsWith('tmdb')).length,
      youtube: 0, // YouTube поиск отключён — только @afishiru
      no_trailer: results.filter(r => !r.trailer).length
    };
    
    console.log('[TrailerSync] Готово:', stats);
    return res.status(200).json({ ok: true, stats, updated_at: new Date().toISOString() });
    
  } catch (err) {
    console.error('[TrailerSync] Ошибка:', err);
    return res.status(500).json({ error: err.message });
  }
}
