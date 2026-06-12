// ╔══════════════════════════════════════════════════════════════╗
// ║  afishi-geo Worker — Cloudflare Workers                     ║
// ║  Endpoints:                                                  ║
// ║    GET  /api/geo          — определить город по IP           ║
// ║    POST /api/email        — отправить email через Resend     ║
// ║    OPTIONS *              — CORS preflight                   ║
// ╚══════════════════════════════════════════════════════════════╝

const RESEND_API_KEY = 're_BFQdjrsV_NFAqbeo5XkX8cQpj1xBzScsG';
const IMGBB_KEY = '994561c921f16df55b32560fe5c09016';
const YA_GEO_KEY    = '8bb575b7-f32a-4aff-b82d-9e45ed28963c';

const ADMIN_EMAIL    = 'strote34@gmail.com';
const FROM_EMAIL     = 'afishi.ru <onboarding@resend.dev>';
const SITE_URL       = 'https://afishiru-v14.vercel.app';

// ── CORS заголовки ─────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function corsResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

// ── Определение города по IP ───────────────────────────────────
async function handleGeo(request) {
  const ip = request.headers.get('CF-Connecting-IP')
           || request.headers.get('X-Forwarded-For')
           || '0.0.0.0';

  // Cloudflare даёт геолокацию бесплатно через заголовки
  const cfCity    = request.cf?.city;
  const cfCountry = request.cf?.country;
  const cfRegion  = request.cf?.region;

  // Маппинг → русские названия городов
  const CITY_MAP = {
    'Volgograd': 'Волгоград',
    'Moscow': 'Москва',
    'Saint Petersburg': 'Санкт-Петербург',
    'St. Petersburg': 'Санкт-Петербург',
    'Yekaterinburg': 'Екатеринбург',
    'Ekaterinburg': 'Екатеринбург',
    'Kazan': 'Казань',
    'Krasnodar': 'Краснодар',
    'Rostov-on-Don': 'Ростов-на-Дону',
    'Novosibirsk': 'Новосибирск',
    'Nizhny Novgorod': 'Нижний Новгород',
    'Chelyabinsk': 'Челябинск',
    'Samara': 'Самара',
    'Ufa': 'Уфа',
    'Omsk': 'Омск',
  };

  const cityRu = CITY_MAP[cfCity] || null;

  return corsResponse({
    ip,
    city: cityRu || cfCity || null,
    cityEn: cfCity || null,
    country: cfCountry || null,
    region: cfRegion || null,
    source: 'cloudflare-cf',
  });
}

// ── Сохранить геолокацию (POST /api/geo/set) ──────────────────
async function handleGeoSet(request) {
  // Ничего не делаем — просто подтверждаем
  return corsResponse({ ok: true });
}

// ── Отправка email через Resend ───────────────────────────────
async function handleEmail(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return corsResponse({ error: 'Invalid JSON' }, 400);
  }

  const { type, data } = body;

  let subject, html;

  switch (type) {

    // Новое мероприятие подано через форму
    case 'new_event': {
      subject = `🎪 Новое мероприятие: ${data.title || 'Без названия'}`;
      html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#c8102e;padding:20px;border-radius:8px 8px 0 0;">
            <h1 style="color:#fff;margin:0;font-size:22px;">🎪 Новое мероприятие на Афиши.ру</h1>
          </div>
          <div style="background:#f9f9f9;padding:24px;border:1px solid #e0e0e0;">
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:8px;color:#666;width:140px;">Название</td><td style="padding:8px;font-weight:bold;">${data.title || '—'}</td></tr>
              <tr style="background:#fff;"><td style="padding:8px;color:#666;">Дата</td><td style="padding:8px;">${data.date || '—'}</td></tr>
              <tr><td style="padding:8px;color:#666;">Площадка</td><td style="padding:8px;">${data.venue || '—'}</td></tr>
              <tr style="background:#fff;"><td style="padding:8px;color:#666;">Город</td><td style="padding:8px;">${data.city || '—'}</td></tr>
              <tr><td style="padding:8px;color:#666;">Цена</td><td style="padding:8px;">${data.price || '—'}</td></tr>
              <tr style="background:#fff;"><td style="padding:8px;color:#666;">Контакт</td><td style="padding:8px;">${data.contact || '—'}</td></tr>
              <tr><td style="padding:8px;color:#666;">Описание</td><td style="padding:8px;">${data.description || '—'}</td></tr>
            </table>
            <div style="margin-top:20px;text-align:center;">
              <a href="${SITE_URL}/admin-panel.html" style="background:#c8102e;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
                Открыть Admin Panel
              </a>
            </div>
          </div>
          <div style="padding:12px;text-align:center;color:#aaa;font-size:12px;">
            Афиши.ру — ${new Date().toLocaleDateString('ru-RU')}
          </div>
        </div>`;
      break;
    }

    // Новый пользователь зарегистрировался
    case 'new_user': {
      subject = `👤 Новый пользователь: ${data.name || data.email}`;
      html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#1a1a1a;padding:20px;border-radius:8px 8px 0 0;">
            <h1 style="color:#fff;margin:0;font-size:22px;">👤 Новый пользователь</h1>
          </div>
          <div style="background:#f9f9f9;padding:24px;border:1px solid #e0e0e0;">
            <p><strong>Имя:</strong> ${data.name || '—'}</p>
            <p><strong>Email:</strong> ${data.email || '—'}</p>
            <p><strong>Город:</strong> ${data.city || '—'}</p>
            <p><strong>Дата:</strong> ${new Date().toLocaleDateString('ru-RU')}</p>
          </div>
        </div>`;
      break;
    }

    // Новый подписчик рассылки
    case 'newsletter': {
      subject = `📧 Новый подписчик: ${data.email}`;
      html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#c9a84c;padding:20px;border-radius:8px 8px 0 0;">
            <h1 style="color:#1a1a1a;margin:0;font-size:22px;">📧 Новый подписчик на рассылку</h1>
          </div>
          <div style="background:#f9f9f9;padding:24px;border:1px solid #e0e0e0;">
            <p><strong>Email:</strong> ${data.email}</p>
            <p><strong>Город:</strong> ${data.city || '—'}</p>
            <p><strong>Дата:</strong> ${new Date().toLocaleDateString('ru-RU')}</p>
          </div>
        </div>`;
      break;
    }

    // Контактная форма / обратная связь
    case 'contact': {
      subject = `💬 Сообщение от ${data.name || data.email}: ${data.subject || ''}`;
      html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#4a86e8;padding:20px;border-radius:8px 8px 0 0;">
            <h1 style="color:#fff;margin:0;font-size:22px;">💬 Сообщение с сайта</h1>
          </div>
          <div style="background:#f9f9f9;padding:24px;border:1px solid #e0e0e0;">
            <p><strong>От:</strong> ${data.name || '—'} (${data.email || '—'})</p>
            <p><strong>Тема:</strong> ${data.subject || '—'}</p>
            <hr style="border:none;border-top:1px solid #e0e0e0;margin:16px 0;">
            <p style="white-space:pre-wrap;">${data.message || '—'}</p>
          </div>
        </div>`;
      break;
    }

    // Новая рецензия
    case 'new_review': {
      subject = `⭐ Новая рецензия: ${data.title}`;
      html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#c8102e;padding:20px;border-radius:8px 8px 0 0;">
            <h1 style="color:#fff;margin:0;font-size:22px;">⭐ Новая рецензия</h1>
          </div>
          <div style="background:#f9f9f9;padding:24px;border:1px solid #e0e0e0;">
            <p><strong>Мероприятие:</strong> ${data.title || '—'}</p>
            <p><strong>Оценка:</strong> ${'⭐'.repeat(data.rating || 5)} (${data.rating}/5)</p>
            <p><strong>Автор:</strong> ${data.author || 'Аноним'}</p>
            <p><strong>Текст:</strong> ${data.text || '—'}</p>
          </div>
        </div>`;
      break;
    }

    default:
      return corsResponse({ error: 'Unknown email type' }, 400);
  }

  // Отправить через Resend REST API
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to:   [ADMIN_EMAIL],
        subject,
        html,
      }),
    });

    const result = await res.json();

    if (!res.ok) {
      return corsResponse({ error: result }, 500);
    }

    return corsResponse({ ok: true, id: result.id });
  } catch (err) {
    return corsResponse({ error: err.message }, 500);
  }
}


async function handleGeocode(request) {
  const url = new URL(request.url);
  const address = url.searchParams.get('address') || '';
  if (!address) return corsResponse({ error: 'address required' }, 400);
  
  const geoUrl = `https://geocode-maps.yandex.ru/1.x/?apikey=${YA_GEO_KEY}&geocode=${encodeURIComponent(address + ', Россия')}&format=json&results=1&lang=ru_RU`;
  
  try {
    const r = await fetch(geoUrl);
    const data = await r.json();
    const member = data?.response?.GeoObjectCollection?.featureMember?.[0];
    if (!member) return corsResponse({ error: 'not found' }, 404);
    
    const point = member.GeoObject?.Point?.pos;
    const name  = member.GeoObject?.name;
    const desc  = member.GeoObject?.description;
    
    if (!point) return corsResponse({ error: 'no coords' }, 404);
    const [lng, lat] = point.split(' ').map(Number);
    
    return corsResponse({ lat, lng, name, description: desc, source: 'yandex' });
  } catch(err) {
    return corsResponse({ error: err.message }, 500);
  }
}


// ════════════════════════════════════════════════════════════════
// CLOUDFLARE KV — хранение данных сайта (фото, события, настройки)
// Привязать KV namespace: wrangler kv:namespace create AFISHI_KV
// Добавить в wrangler.toml: [[kv_namespaces]] binding = "AFISHI_KV"
// ════════════════════════════════════════════════════════════════

// ── KV: Сохранить событие с фото ──────────────────────────────
async function handleKVSave(request, env) {
  const secret = request.headers.get('X-Cron-Secret');
  if (secret !== env.CRON_SECRET) return corsResponse({ error: 'Unauthorized' }, 401);
  
  const body = await request.json();
  const { key, value } = body;
  if (!key || value === undefined) return corsResponse({ error: 'key and value required' }, 400);
  
  await env.AFISHI_KV.put(key, JSON.stringify(value), { expirationTtl: 86400 * 30 }); // 30 дней
  return corsResponse({ ok: true, key });
}

// ── KV: Получить данные ───────────────────────────────────────
async function handleKVGet(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key) return corsResponse({ error: 'key required' }, 400);
  
  const val = await env.AFISHI_KV.get(key, 'json');
  if (val === null) return corsResponse({ error: 'not found' }, 404);
  return corsResponse({ key, value: val });
}

// ── KV: Список ключей (для Admin Panel) ───────────────────────
async function handleKVList(request, env) {
  const url = new URL(request.url);
  const prefix = url.searchParams.get('prefix') || '';
  const list = await env.AFISHI_KV.list({ prefix });
  return corsResponse({ keys: list.keys.map(k => k.name), complete: list.list_complete });
}

// ── KV: Удалить ───────────────────────────────────────────────
async function handleKVDelete(request, env) {
  const secret = request.headers.get('X-Cron-Secret');
  if (secret !== env.CRON_SECRET) return corsResponse({ error: 'Unauthorized' }, 401);
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key) return corsResponse({ error: 'key required' }, 400);
  await env.AFISHI_KV.delete(key);
  return corsResponse({ ok: true, deleted: key });
}

// ── ImgBB: загрузка фото (прокси для CORS) ───────────────────
async function handleImgUpload(request, env) {
  const IMGBB_KEY = env.IMGBB_API_KEY || ''; // добавить в Cloudflare secrets
  if (!IMGBB_KEY) return corsResponse({ error: 'IMGBB_API_KEY not set' }, 500);
  
  const body = await request.formData();
  const form = new FormData();
  form.append('key', IMGBB_KEY);
  
  // Принять base64 или URL
  const image = body.get('image');
  const imageUrl = body.get('image_url');
  if (image) form.append('image', image);
  else if (imageUrl) form.append('image', imageUrl);
  else return corsResponse({ error: 'image or image_url required' }, 400);
  
  const name = body.get('name');
  if (name) form.append('name', name);
  
  const r = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: form });
  const data = await r.json();
  
  if (!data.success) return corsResponse({ error: data.error?.message || 'Upload failed' }, 500);
  
  // Сохранить URL в KV
  const imageKey = 'img_' + Date.now();
  await env.AFISHI_KV.put(imageKey, JSON.stringify({
    url: data.data.url,
    thumb: data.data.thumb?.url,
    name: data.data.title,
    size: data.data.size,
    uploaded_at: new Date().toISOString()
  }), { expirationTtl: 86400 * 365 }); // 1 год
  
  return corsResponse({ ok: true, url: data.data.url, thumb: data.data.thumb?.url, key: imageKey });
}

// ── Главный обработчик ─────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (path === '/api/geo' && method === 'GET') {
      return handleGeo(request);
    }

    if (path === '/api/geo/set' && method === 'POST') {
      return handleGeoSet(request);
    }

    // KV Storage
    if (path === '/api/kv/save'   && method === 'POST') return handleKVSave(request, env);
    if (path === '/api/kv/get'    && method === 'GET')  return handleKVGet(request, env);
    if (path === '/api/kv/list'   && method === 'GET')  return handleKVList(request, env);
    if (path === '/api/kv/delete' && method === 'DELETE') return handleKVDelete(request, env);
    if (path === '/api/img/upload' && method === 'POST') return handleImgUpload(request, env);

    if (path === '/api/geocode' && method === 'GET') {
      return handleGeocode(request);
    }

    if (path === '/api/email' && method === 'POST') {
      return handleEmail(request);
    }

    // Health check
    if (path === '/' || path === '/api') {
      return corsResponse({ ok: true, service: 'afishi-geo', version: '2.0' });
    }

    return corsResponse({ error: 'Not Found' }, 404);
  }
};

// ════════════════════════════════════════════════════════════════
// TRAILER ENDPOINTS (добавить в существующий worker)
// ════════════════════════════════════════════════════════════════

// В handleRequest добавить:
// if (path === '/api/trailers' && method === 'GET') return handleTrailersGet(request, env);
// if (path === '/api/trailers/update' && method === 'POST') return handleTrailersUpdate(request, env);

async function handleTrailersGet(request, env) {
  // Читать из KV storage
  const data = await env.AFISHI_KV.get('trailers_cache', 'json');
  if (!data) return corsResponse({ trailers: [], updated_at: null });
  return corsResponse(data);
}

async function handleTrailersUpdate(request, env) {
  const secret = request.headers.get('X-Cron-Secret');
  if (secret !== env.CRON_SECRET) {
    return corsResponse({ error: 'Unauthorized' }, 401);
  }
  const body = await request.json();
  await env.AFISHI_KV.put('trailers_cache', JSON.stringify(body), {
    expirationTtl: 86400 * 2 // 2 дня
  });
  return corsResponse({ ok: true });
}
