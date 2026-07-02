// /api/upload-photo.js — принимает фото (base64 data URL), кладёт в Vercel Blob,
// возвращает постоянную публичную ссылку. Раньше фото сохранялись как base64
// прямо в localStorage браузера — были видны только на одном устройстве.
//
// POST /api/upload-photo  { dataUrl: "data:image/jpeg;base64,..." }
// -> { ok: true, url: "https://....public.blob.vercel-storage.com/photos/..." }

import { put } from '@vercel/blob';

const MAX_BYTES = 3 * 1024 * 1024; // 3MB исходный файл (~4MB в base64) — с запасом под лимит тела запроса Vercel

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({
      error: 'storage_not_configured',
      message: 'Vercel Blob не подключён к проекту. Storage -> Create Database -> Blob в настройках проекта на vercel.com',
    });
  }

  try {
    const { dataUrl, filename } = req.body || {};
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      return res.status(400).json({ error: 'dataUrl (data:...;base64,...) required' });
    }

    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'invalid data URL format' });

    const contentType = match[1];
    const base64 = match[2];
    const buffer = Buffer.from(base64, 'base64');

    if (buffer.length > MAX_BYTES) {
      return res.status(413).json({ error: 'file_too_large', message: 'Максимум 3 МБ' });
    }

    const ext = (contentType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const safeName = (filename || 'photo').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'photo';
    const pathname = `photos/${Date.now()}-${safeName}.${ext}`;

    const blob = await put(pathname, buffer, {
      access: 'public',
      contentType,
      addRandomSuffix: true,
    });

    return res.json({ ok: true, url: blob.url });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: String(e && e.message || e) });
  }
}
