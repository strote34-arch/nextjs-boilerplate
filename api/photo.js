// /api/photo.js — публичная отдача файлов из ПРИВАТНОГО Vercel Blob Store.
// Хранилище afishiru-v12-blob создано в режиме Private — обычные посетители сайта
// не могут напрямую открыть blob-ссылку (нужна авторизация). Эта функция сама
// подставляет OIDC-токен на сервере и отдаёт байты как обычную публичную картинку.
//
// GET /api/photo?p=<pathname>  (pathname — то, что вернул /api/upload-photo)

import { get } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const p = req.query && req.query.p;
  if (!p) return res.status(400).json({ error: 'p (pathname) required' });

  try {
    const result = await get(p, { access: 'private' });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.setHeader('Content-Type', result.blob.contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    const chunks = [];
    for await (const chunk of result.stream) chunks.push(chunk);
    res.status(200).end(Buffer.concat(chunks));
  } catch (e) {
    console.error('[api/photo] error:', e && e.message || e);
    return res.status(404).json({ error: 'not_found' });
  }
}
