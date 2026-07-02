// /api/store.js — общее серверное хранилище для сайта (замена localStorage-only решений)
// Хранит один JSON-документ в Vercel Blob (data/site-data.json).
// GET  /api/store            -> вернуть весь документ
// GET  /api/store?key=X      -> вернуть только data[X]
// POST /api/store  { key, patch }  -> смёрджить patch в data[key] (объект) и сохранить
// POST /api/store  { key, value }  -> заменить data[key] целиком (например массив) и сохранить
//
// Требует переменную окружения BLOB_READ_WRITE_TOKEN — появляется автоматически
// после подключения Vercel Blob Store в настройках проекта (Storage → Create Database → Blob).

import { put, head } from '@vercel/blob';

const DOC_PATH = 'data/site-data.json';

async function loadDoc() {
  try {
    const info = await head(DOC_PATH);
    const authToken = process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN;
    const res = await fetch(info.url, {
      cache: 'no-store',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    if (!res.ok) return {};
    return await res.json();
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
  await put(DOC_PATH, JSON.stringify(doc), {
    access: 'private',
    contentType: 'application/json',
    allowOverwrite: true,
  });
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
      const key = req.query && req.query.key;
      if (key) return res.json({ ok: true, key, value: doc[key] !== undefined ? doc[key] : null });
      return res.json({ ok: true, data: doc });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const { key, patch, value } = body;
      if (!key) return res.status(400).json({ error: 'key required' });

      const doc = await loadDoc();

      if (value !== undefined) {
        doc[key] = value;
      } else if (patch !== undefined) {
        doc[key] = Object.assign({}, doc[key] || {}, patch);
      } else {
        return res.status(400).json({ error: 'patch or value required' });
      }

      await saveDoc(doc);
      return res.json({ ok: true, key, value: doc[key] });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (e) {
    console.error('[api/store] handler error:', req.method, e && e.stack || e);
    return res.status(500).json({ error: 'server_error', message: String(e && e.message || e) });
  }
}
