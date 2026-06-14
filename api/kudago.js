// /api/kudago.js — Реальные события из KudaGo API
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=1800');

  const city     = (req.query.city || 'volgograd').toLowerCase();
  const cat      = req.query.cat || '';
  const pageSize = Math.min(parseInt(req.query.page_size) || 20, 50);

  // KudaGo slug маппинг
  const slugMap = {
    'волгоград': 'volgograd', 'москва': 'msk',
    'санкт-петербург': 'spb', 'екатеринбург': 'ekb',
  };
  const slug = slugMap[city] || city;

  const today = Math.floor(Date.now() / 1000);
  const future = today + 30 * 24 * 3600;

  // Категории KudaGo
  const catMap = {
    'concert': 'concert', 'concerts': 'concert',
    'theater': 'theater', 'exhibition': 'exhibition',
    'kids': 'kids', 'cinema': 'cinema', 'sport': 'sport',
    'other': 'other',
  };
  const kudagoCat = catMap[cat] || '';

  const params = new URLSearchParams({
    location:     slug,
    actual_since: today,
    actual_until: future,
    page_size:    pageSize,
    fields:       'id,title,description,place,dates,images,price,categories,age_restriction,is_free,site_url',
    expand:       'images,place,dates',
    order_by:     '-publication_date',
    text_format:  'plain',
    lang:         'ru',
  });
  if (kudagoCat) params.set('categories', kudagoCat);

  const apiUrl = `https://kudago.com/public-api/v1.4/events/?${params}`;

  try {
    const r = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'afishiru.ru/1.0',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error('[KudaGo] Error:', r.status, errText.slice(0, 200));
      return res.status(200).json({ ok: false, error: `KudaGo: ${r.status}`, events: [] });
    }

    const data = await r.json();

    const events = (data.results || []).map(e => {
      const date = e.dates?.[0];
      return {
        id:          e.id,
        title:       e.title || '',
        description: (e.description || '').slice(0, 400),
        category:    (e.categories || []).join(','),
        place:       e.place ? { name: e.place.title, address: e.place.address } : null,
        date_start:  date?.start || null,
        date_end:    date?.end   || null,
        image:       e.images?.[0]?.image || null,
        price:       e.price || (e.is_free ? 'Бесплатно' : ''),
        age:         e.age_restriction || 0,
        url:         e.site_url || `https://kudago.com/${slug}/event/${e.id}/`,
        is_free:     e.is_free || false,
      };
    });

    return res.status(200).json({
      ok:         true,
      city:       slug,
      count:      events.length,
      total:      data.count || 0,
      events,
      fetched_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[KudaGo] Fetch error:', err.message);
    return res.status(200).json({ ok: false, error: err.message, events: [] });
  }
}
