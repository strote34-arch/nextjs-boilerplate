// /api/kudago.js — Реальные события Волгограда из KudaGo
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  const city    = req.query.city    || 'volgograd';
  const cat     = req.query.cat     || '';  // concerts, theaters, cinemas, exhibitions, kids
  const pageSize = parseInt(req.query.page_size) || 20;
  const page    = parseInt(req.query.page) || 1;

  // Карта городов KudaGo
  const cityMap = {
    'Волгоград': 'volgograd', 'Москва': 'msk', 'Санкт-Петербург': 'spb',
    'Екатеринбург': 'ekb', 'Казань': 'kzn', 'Краснодар': 'krd',
  };
  const slug = cityMap[city] || city;

  // Параметры запроса
  const today = Math.floor(Date.now() / 1000);
  const weekLater = today + 30 * 24 * 3600; // 30 дней вперёд

  const params = new URLSearchParams({
    location: slug,
    actual_since: today,
    actual_until: weekLater,
    page_size: pageSize,
    page: page,
    fields: 'id,title,description,place,dates,images,price,categories,age_restriction,is_free,site_url',
    expand: 'images,place,dates',
    order_by: 'publication_date',
    lang: 'ru',
  });
  if (cat) params.set('categories', cat);

  try {
    const r = await fetch(`https://kudago.com/public-api/v1.4/events/?${params}`);
    if (!r.ok) throw new Error(`KudaGo: ${r.status}`);
    const data = await r.json();

    const events = (data.results || []).map(e => ({
      id:          e.id,
      title:       e.title,
      description: (e.description || '').replace(/<[^>]+>/g,'').slice(0,300),
      category:    (e.categories || []).join(','),
      place:       e.place ? {name: e.place.title, address: e.place.address} : null,
      date_start:  e.dates?.[0]?.start || null,
      date_end:    e.dates?.[0]?.end   || null,
      image:       e.images?.[0]?.image || null,
      price:       e.price || (e.is_free ? 'Бесплатно' : ''),
      age:         e.age_restriction || 0,
      url:         e.site_url || `https://kudago.com/${slug}/event/${e.id}/`,
    }));

    return res.status(200).json({
      ok: true,
      city: slug,
      count: events.length,
      total: data.count || 0,
      events,
      fetched_at: new Date().toISOString(),
    });
  } catch(err) {
    return res.status(200).json({ ok: false, error: err.message, events: [] });
  }
}
