// /api/geo-set — сохранить выбор пользователя
// В serverless нет persistent storage без DB, сохраняем acknowledgement
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const { city } = req.body || {};
  if (!city) return res.status(400).json({ error: 'city required' });
  // Без KV просто подтверждаем — клиент сам хранит в localStorage
  res.json({ ok: true, city, saved: true, note: 'stored in client localStorage' });
}
