// /api/trailers/get.js — публичный endpoint для получения трейлеров
// Вызывается со страницы cinema.html для показа трейлеров

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600'); // кэш 1 час
  
  const WORKER_URL = 'https://afishi-geo.strote34.workers.dev';
  
  try {
    const r = await fetch(`${WORKER_URL}/api/trailers`);
    const data = await r.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
