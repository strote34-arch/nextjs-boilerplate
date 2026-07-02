// /api/photo.js — публичная отдача файлов из ПРИВАТНОГО Vercel Blob Store.
// Хранилище afishiru-v12-blob создано в режиме Private — обычные посетители сайта
// не могут напрямую открыть blob-ссылку (нужна авторизация). Эта функция сама
// подставляет OIDC-токен на сервере и отдаёт байты как обычную публичную картинку.
//
// GET /api/photo?p=<pathname>  (pathname — то, что вернул /api/upload-photo)

import { head } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const p = req.query && req.query.p;
  if (!p) return res.status(400).json({ error: 'p (pathname) required' });

  try {
    const info = await head(p);
    const authToken = process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN;
    const upstream = await fetch(info.url, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    if (!upstream.ok) {
      return res.status(upstream.status === 404 ? 404 : 502).json({ error: 'upstream_error', status: upstream.status });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', info.contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.status(200).end(buf);
  } catch (e) {
    console.error('[api/photo] error:', e && e.message || e);
    return res.status(404).json({ error: 'not_found' });
  }
}
