// /api/kudago.js — KudaGo API прокси (бесплатные события)
// Документация: https://kudago.com/public-api/v1.4/

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');
  
  const city   = req.query.city   || 'volgograd';
  const cats   = req.query.cats   || 'concert,theater,exhibition,kids';
  const page   = req.query.page   || 1;
  const count  = Math.min(parseInt(req.query.count) || 20, 50);
  const today  = Math.floor(Date.now() / 1000);
  
  const CITY_MAP = {
    'Волгоград': 'volgograd', 'Москва': 'msk',
    'Санкт-Петербург': 'spb', 'Екатеринбург': 'ekb',
    'volgograd': 'volgograd', 'msk': 'msk', 'spb': 'spb'
  };
  const citySlug = CITY_MAP[city] || 'volgograd';
  
  const url = [
    'https://kudago.com/public-api/v1.4/events/',
    '?location=' + citySlug,
    '&actual_since=' + today,
    '&fields=id,title,description,short_title,dates,images,place,categories,price,age_restriction,tags',
    '&expand=images,place',
    '&categories=' + cats,
    '&page_size=' + count,
    '&page=' + page,
    '&lang=ru',
    '&order_by=dates',
  ].join('');
  
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('KudaGo: ' + r.status);
    const data = await r.json();
    
    // Преобразовать в формат afishiru
    const events = (data.results || []).map(ev => ({
      id: 'kudago_' + ev.id,
      title: ev.short_title || ev.title,
      description: ev.description?.replace(/<[^>]+>/g, '').slice(0, 300) || '',
      date:     ev.dates?.[0]?.start ? new Date(ev.dates[0].start * 1000).toLocaleDateString('ru-RU') : '',
      dateISO:  ev.dates?.[0]?.start ? new Date(ev.dates[0].start * 1000).toISOString().slice(0,10) : '',
      dateEnd:  ev.dates?.[0]?.end   ? new Date(ev.dates[0].end   * 1000).toISOString().slice(0,10) : '',
      venue:    ev.place?.title   || '',
      address:  ev.place?.address || '',
      lat:      ev.place?.coords?.lat  || null,
      lng:      ev.place?.coords?.lon  || null,
      image:    ev.images?.[0]?.image || ev.images?.[0]?.thumbnails?.['640x384'] || '',
      price:    ev.price || 'Уточняйте',
      ageLimit: ev.age_restriction ? ev.age_restriction + '+' : '',
      tags:     ev.tags || [],
      categories: ev.categories || [],
      url:      ev.site_url || ('https://kudago.com/' + citySlug + '/event/' + ev.id),
      source:   'kudago'
    }));
    
    return res.status(200).json({
      count: data.count,
      results: events,
      next: data.next,
      city: citySlug,
      updated_at: new Date().toISOString()
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
