// /api/test-tmdb.js — быстрый тест TMDB API
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const key = process.env.TMDB_API_KEY;
  
  // Проверяем ключ
  const keyInfo = {
    exists: !!key,
    length: key ? key.length : 0,
    preview: key ? key.slice(0,8) + '...' : 'ОТСУТСТВУЕТ'
  };
  
  if (!key) {
    return res.status(200).json({ 
      error: 'TMDB_API_KEY не установлен в env',
      keyInfo 
    });
  }
  
  // Пробуем запрос к TMDB
  try {
    const url = `https://api.themoviedb.org/3/movie/now_playing?api_key=${key}&language=ru-RU&page=1`;
    const r = await fetch(url);
    const data = await r.json();
    
    return res.status(200).json({
      tmdb_status: r.status,
      tmdb_ok: r.ok,
      results_count: (data.results||[]).length,
      total_results: data.total_results,
      total_pages: data.total_pages,
      error: data.status_message || null,
      sample: (data.results||[]).slice(0,3).map(m=>m.title),
      keyInfo
    });
  } catch(e) {
    return res.status(200).json({ 
      error: e.message, 
      keyInfo 
    });
  }
}
