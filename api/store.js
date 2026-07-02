// /api/store.js — общее серверное хранилище для сайта (замена localStorage-only решений)
// Хранит один JSON-документ в Vercel Blob (data/site-data.json).
// GET  /api/store            -> вернуть весь документ
// GET  /api/store?key=X      -> вернуть только data[X]
// POST /api/store  { key, patch }  -> смёрджить patch в data[key] (объект) и сохранить
// POST /api/store  { key, value }  -> заменить data[key] целиком (например массив) и сохранить
//
// Требует переменную окружения BLOB_READ_WRITE_TOKEN — появляется автоматически
// после подключения Vercel Blob Store в настройках проекта (Storage → Create Database → Blob).

import { put, get } from '@vercel/blob';

const DOC_PATH = 'data/site-data.json';

async function loadDoc() {
  try {
    const result = await get(DOC_PATH, { access: 'private' });
    if (!result || result.statusCode !== 200 || !result.stream) return {};
    const chunks = [];
    for await (const chunk of result.stream) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf-8');
    return JSON.parse(text);
  } catch (e) {
    // BlobNotFoundError (документ ещё не создан) — это нормально, начинаем с пустого.
    // Любую другую ошибку (auth, network...) логируем и пробрасываем дальше,
    // чтобы не маскировать реальные сбои как "пустые данные".
    const name = String((e && (e.name || e.code)) || '').toLowerCase();
    const msg = String((e && e.message) || '').toLowerCase();
    const isNotFound = name.includes('notfound') || name.includes('not_found')
      || msg.includes('does not exist') || msg.includes('not found');
    if (isNotFound) return {};
    console.error('[api/store] loadDoc error:', e && e.message || e);
    throw e;
  }
}

async function saveDoc(doc) {
  const result = await put(DOC_PATH, JSON.stringify(doc), {
    access: 'private',
    contentType: 'application/json',
    allowOverwrite: true,
    cacheControlMaxAge: 60, // минимум, разрешённый Vercel Blob — не хотим долгого кэша для этого файла
  });
  console.log('[api/store] saveDoc wrote:', JSON.stringify(result), 'doc keys:', Object.keys(doc));
  return result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({
      error: 'storage_not_configured',
      message: 'Vercel Blob не подключён к проекту. Storage -> Create Database -> Blob в настройках проекта на vercel.com',
    });
  }

  try {
    if (req.method === 'GET') {
      const doc = await loadDoc();
      console.log('[api/store] GET loadDoc returned keys:', Object.keys(doc));
      const key = req.query && req.query.key;
      if (key) return res.json({ ok: true, key, value: doc[key] !== undefined ? doc[key] : null });
      return res.json({ ok: true, data: doc });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const { key, patch, value } = body;
      if (!key) return res.status(400).json({ error: 'key required' });

      const doc = await loadDoc();
      console.log('[api/store] POST before-write doc keys:', Object.keys(doc));

      if (value !== undefined) {
        doc[key] = value;
      } else if (patch !== undefined) {
        doc[key] = Object.assign({}, doc[key] || {}, patch);
      } else {
        return res.status(400).json({ error: 'patch or value required' });
      }

      await saveDoc(doc);

      // Верификация: перечитываем документ заново (отдельный запрос), чтобы убедиться,
      // что запись реально видна, а не просто "не упала с ошибкой"
      const verify = await loadDoc();
      console.log('[api/store] POST after-write verify keys:', Object.keys(verify), 'has key:', key in verify);

      return res.json({ ok: true, key, value: doc[key], verified: key in verify && JSON.stringify(verify[key]) === JSON.stringify(doc[key]) });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (e) {
    console.error('[api/store] handler error:', req.method, e && e.stack || e);
    return res.status(500).json({ error: 'server_error', message: String(e && e.message || e) });
  }
}
