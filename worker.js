/**
 * afishi.ru — Cloudflare Worker Backend v2.0
 * ============================================
 * GET  /api/geo          — Определить город по IP
 * POST /api/geo/set      — Сохранить выбор пользователя
 * GET  /api/events       — Получить события ?city=Волгоград&type=concert
 * POST /api/events/update — Обновить события (X-API-Key)
 * GET  /api/stats        — Статистика (X-API-Key)
 * GET  /api/health       — Healthcheck
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
};

const json  = (d, s=200) => new Response(JSON.stringify(d), { status:s, headers:{'Content-Type':'application/json',...CORS}});
const err   = (m, s=400) => json({ok:false, error:m}, s);
const getIP = r => r.headers.get('CF-Connecting-IP') || r.headers.get('X-Real-IP') || '0.0.0.0';

function normalizeIP(ip) {
  if (!ip || ip==='0.0.0.0') return null;
  if (ip.includes(':')) return ip.split(':').slice(0,3).join(':') + '::/48';
  const p = ip.split('.');
  return p.length>=3 ? p.slice(0,3).join('.')+'.0/24' : null;
}

const CITY_MAP = {
  'Achinsk': 'Ачинск',
  'Almetyevsk': 'Альметьевск',
  'Anadyr': 'Анадырь',
  'Anapa': 'Анапа',
  'Angarsk': 'Ангарск',
  'Arkhangelsk': 'Архангельск',
  'Armavir': 'Армавир',
  'Arzamas': 'Арзамас',
  'Astrakhan': 'Астрахань',
  'Balakovo': 'Балаково',
  'Balashikha': 'Балашиха',
  'Barnaul': 'Барнаул',
  'Berdsk': 'Бердск',
  'Berezniki': 'Березники',
  'Biysk': 'Бийск',
  'Blagoveshchensk': 'Благовещенск',
  'Bratsk': 'Братск',
  'Bryansk': 'Брянск',
  'Cheboksary': 'Чебоксары',
  'Chelyabinsk': 'Челябинск',
  'Cherkessk': 'Черкесск',
  'Chita': 'Чита',
  'Derbent': 'Дербент',
  'Dzerzhinsk': 'Дзержинск',
  'Ekaterinburg': 'Екатеринбург',
  'Elektrostal': 'Электросталь',
  'Elista': 'Элиста',
  'Engels': 'Энгельс',
  'Frolovo': 'Фролово',
  'Gatchina': 'Гатчина',
  'Gelendzhik': 'Геленджик',
  'Glazov': 'Глазов',
  'Grozny': 'Грозный',
  'Irkutsk': 'Иркутск',
  'Ivanovo': 'Иваново',
  'Izhevsk': 'Ижевск',
  'Kaluga': 'Калуга',
  'Kamensk-Uralsky': 'Каменск-Уральский',
  'Kamyshin': 'Камышин',
  'Kazan': 'Казань',
  'Kazan'': 'Казань',
  'Kemerovo': 'Кемерово',
  'Khabarovsk': 'Хабаровск',
  'Khasavyurt': 'Хасавюрт',
  'Khimki': 'Химки',
  'Kirov': 'Киров',
  'Klin': 'Клин',
  'Kolpino': 'Колпино',
  'Komsomolsk-on-Amur': 'Комсомольск-на-Амуре',
  'Kopeysk': 'Копейск',
  'Korolyov': 'Королёв',
  'Kostroma': 'Кострома',
  'Krasnodar': 'Краснодар',
  'Krasnogorsk': 'Красногорск',
  'Krasnoyarsk': 'Красноярск',
  'Kursk': 'Курск',
  'Lipetsk': 'Липецк',
  'Lyubertsy': 'Люберцы',
  'Magadan': 'Магадан',
  'Magnitogorsk': 'Магнитогорск',
  'Maikop': 'Майкоп',
  'Makhachkala': 'Махачкала',
  'Miass': 'Миасс',
  'Mikhaylovka': 'Михайловка',
  'Moscow': 'Москва',
  'Moskva': 'Москва',
  'Murmansk': 'Мурманск',
  'Mytishchi': 'Мытищи',
  'Naberezhnye Chelny': 'Набережные Челны',
  'Nakhodka': 'Находка',
  'Nalchik': 'Нальчик',
  'Neftekamsk': 'Нефтекамск',
  'Nizhnekamsk': 'Нижнекамск',
  'Nizhnevartovsk': 'Нижневартовск',
  'Nizhniy Novgorod': 'Нижний Новгород',
  'Nizhny Novgorod': 'Нижний Новгород',
  'Nizhny Tagil': 'Нижний Тагил',
  'Norisk': 'Норильск',
  'Novocherkassk': 'Новочеркасск',
  'Novokuybyshevsk': 'Новокуйбышевск',
  'Novokuznetsk': 'Новокузнецк',
  'Novorossiysk': 'Новороссийск',
  'Novosibirsk': 'Новосибирск',
  'Novotroitsk': 'Новотроицк',
  'Noyabrsk': 'Ноябрьск',
  'Ob': 'Обь',
  'Odintsovo': 'Одинцово',
  'Oktyabrsky': 'Октябрьский',
  'Orel': 'Орёл',
  'Orenburg': 'Оренбург',
  'Orsk': 'Орск',
  'Penza': 'Пенза',
  'Perm': 'Пермь',
  'Perm'': 'Пермь',
  'Pervouralsk': 'Первоуральск',
  'Peterhof': 'Петергоф',
  'Petropavlovsk-Kamchatsky': 'Петропавловск-Камчатский',
  'Petrozavodsk': 'Петрозаводск',
  'Podolsk': 'Подольск',
  'Prokopyevsk': 'Прокопьевск',
  'Pskov': 'Псков',
  'Pushkin': 'Пушкин',
  'Rostov na Donu': 'Ростов-на-Дону',
  'Rostov-on-Don': 'Ростов-на-Дону',
  'Rubtsovsk': 'Рубцовск',
  'Ryazan': 'Рязань',
  'Rybinsk': 'Рыбинск',
  'Saint Petersburg': 'Санкт-Петербург',
  'Salavat': 'Салават',
  'Samara': 'Самара',
  'Sankt-Peterburg': 'Санкт-Петербург',
  'Saransk': 'Саранск',
  'Sarapul': 'Сарапул',
  'Saratov': 'Саратов',
  'Sarov': 'Саров',
  'Seversk': 'Северск',
  'Shakhty': 'Шахты',
  'Smolensk': 'Смоленск',
  'Sochi': 'Сочи',
  'Solikamsk': 'Соликамск',
  'St Petersburg': 'Санкт-Петербург',
  'Stavropol': 'Ставрополь',
  'Sterlitamak': 'Стерлитамак',
  'Surgut': 'Сургут',
  'Syktyvkar': 'Сыктывкар',
  'Syzran': 'Сызрань',
  'Taganrog': 'Таганрог',
  'Tikhvin': 'Тихвин',
  'Tobolsk': 'Тобольск',
  'Togliatti': 'Тольятти',
  'Tolyatti': 'Тольятти',
  'Tomsk': 'Томск',
  'Tula': 'Тула',
  'Tver': 'Тверь',
  'Tyumen': 'Тюмень',
  'Ufa': 'Уфа',
  'Ulan-Ude': 'Улан-Удэ',
  'Uryupinsk': 'Урюпинск',
  'Ussurijsk': 'Уссурийск',
  'Ust-Ilimsk': 'Усть-Илимск',
  'Vladikavkaz': 'Владикавказ',
  'Vladimir': 'Владимир',
  'Vladivostok': 'Владивосток',
  'Volgodonsk': 'Волгодонск',
  'Volgograd': 'Волгоград',
  'Vologda': 'Вологда',
  'Volzhsky': 'Волжский',
  'Voronezh': 'Воронеж',
  'Vyborg': 'Выборг',
  'Yakutsk': 'Якутск',
  'Yaroslavl': 'Ярославль',
  'Yekaterinburg': 'Екатеринбург',
  'Yoshkar-Ola': 'Йошкар-Ола',
  'Yuzhno-Sakhalinsk': 'Южно-Сахалинск',
  'Zheleznogorsk': 'Железногорск',
  'Zlatoust': 'Златоуст',
};


function normalizeCity(name) {
  if (!name) return null;
  if (CITY_MAP[name]) return CITY_MAP[name];
  for (const [en,ru] of Object.entries(CITY_MAP)) {
    if (name.toLowerCase().includes(en.toLowerCase())) return ru;
  }
  // Уже кириллица?
  if (/^[А-ЯЁа-яё\-\s]+$/.test(name)) return name;
  return null;
}

async function fetchCityFromAPI(ip) {
  if (!ip || ip.startsWith('127.') || ip.startsWith('192.168.') || ip==='::1') return null;
  // 1. ip-api.com (бесплатно, 45 req/min)
  try {
    const r = await fetch(`http://ip-api.com/json/${ip}?fields=city,country&lang=ru`, { cf:{cacheTtl:3600} });
    if (r.ok) {
      const d = await r.json();
      if (d.city && d.country==='Russia') {
        const ru = normalizeCity(d.city);
        if (ru) return ru;
      }
    }
  } catch(_) {}
  // 2. freeipapi.com (fallback)
  try {
    const r2 = await fetch(`https://freeipapi.com/api/json/${ip}`, { cf:{cacheTtl:3600} });
    if (r2.ok) {
      const d2 = await r2.json();
      if (d2.cityName && d2.countryCode==='RU') {
        const ru = normalizeCity(d2.cityName);
        if (ru) return ru;
      }
    }
  } catch(_) {}
  return null;
}

// ─── /api/geo ────────────────────────────────────────────────────────
async function handleGeo(req, env) {
  const ip = getIP(req);
  const subnet = normalizeIP(ip);
  const force = new URL(req.url).searchParams.get('force')==='1';
  let city=null, source='default';

  if (!force) {
    // 1. Точный IP
    if (ip!=='0.0.0.0') {
      const kv = await env.AFISHI_KV.get(`ip:${ip}`);
      if (kv) { try{ const d=JSON.parse(kv); city=d.city; }catch(_){city=kv;} source='kv_ip'; }
    }
    // 2. Подсеть
    if (!city && subnet) {
      const kv = await env.AFISHI_KV.get(`subnet:${subnet}`);
      if (kv) { try{ const d=JSON.parse(kv); city=d.city; }catch(_){city=kv;} source='kv_subnet'; }
    }
  }

  // 3. API
  if (!city) {
    city = await fetchCityFromAPI(ip);
    source = city ? 'api' : 'default';
    if (!city) city = 'Волгоград';

    const rec = JSON.stringify({ city, ts:Date.now(), source });
    const p = [];
    if (ip!=='0.0.0.0') p.push(env.AFISHI_KV.put(`ip:${ip}`, rec, {expirationTtl:7776000}));
    if (subnet)          p.push(env.AFISHI_KV.put(`subnet:${subnet}`, rec, {expirationTtl:2592000}));
    // Счётчик
    const cntRaw = await env.AFISHI_KV.get(`stats:city:${city}`);
    p.push(env.AFISHI_KV.put(`stats:city:${city}`, String((parseInt(cntRaw)||0)+1)));
    await Promise.all(p);
  }

  return json({ ok:true, city, ip, subnet, source, ts:Date.now() });
}

// ─── /api/geo/set ────────────────────────────────────────────────────
async function handleGeoSet(req, env) {
  let body; try{ body=await req.json(); }catch(_){ return err('Invalid JSON'); }
  const {city} = body;
  if (!city || typeof city!=='string') return err('city required');
  const ip=getIP(req), subnet=normalizeIP(ip);
  const rec = JSON.stringify({city, ts:Date.now(), source:'manual'});
  const p=[];
  if (ip!=='0.0.0.0') p.push(env.AFISHI_KV.put(`ip:${ip}`, rec, {expirationTtl:15552000}));
  if (subnet)          p.push(env.AFISHI_KV.put(`subnet:${subnet}`, rec, {expirationTtl:7776000}));
  await Promise.all(p);
  return json({ok:true, city, ip, saved:true});
}

// ─── /api/events GET ─────────────────────────────────────────────────
async function handleGetEvents(req, env) {
  const url=new URL(req.url);
  const city=url.searchParams.get('city')||'Волгоград';
  const type=url.searchParams.get('type')||'all';
  const raw=await env.AFISHI_KV.get(`events:${city}:${type}`);
  if (!raw) return json({ok:true, city, type, events:[], updated:null});
  try { return json({ok:true, city, type, ...JSON.parse(raw)}); }
  catch(_){ return err('Parse error',500); }
}

// ─── /api/events/update POST ─────────────────────────────────────────
async function handleUpdateEvents(req, env) {
  if (req.headers.get('X-API-Key')!==env.API_KEY) return err('Unauthorized',401);
  let body; try{ body=await req.json(); }catch(_){ return err('Invalid JSON'); }
  const {city, type='concert', events} = body;
  if (!city||!Array.isArray(events)) return err('city and events[] required');
  const data={events, updated:new Date().toISOString(), count:events.length};
  await env.AFISHI_KV.put(`events:${city}:${type}`, JSON.stringify(data), {expirationTtl:2592000});
  return json({ok:true, city, type, count:events.length});
}

// ─── /api/stats GET ──────────────────────────────────────────────────
async function handleStats(req, env) {
  if (req.headers.get('X-API-Key')!==env.API_KEY) return err('Unauthorized',401);
  const cities=['Волгоград','Москва','Санкт-Петербург','Екатеринбург','Казань',
    'Новосибирск','Краснодар','Ростов-на-Дону','Нижний Новгород','Уфа',
    'Самара','Омск','Челябинск','Воронеж','Пермь'];
  const stats={};
  await Promise.all(cities.map(async c=>{
    const v=await env.AFISHI_KV.get(`stats:city:${c}`);
    if (v) stats[c]=parseInt(v);
  }));
  return json({ok:true, cities:stats, ts:Date.now()});
}

// ─── РОУТЕР ──────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url=new URL(request.url);
    const path=url.pathname;
    const method=request.method.toUpperCase();
    if (method==='OPTIONS') return new Response(null,{headers:CORS});
    try {
      if (path==='/api/geo'            && method==='GET')  return handleGeo(request,env);
      if (path==='/api/geo/set'        && method==='POST') return handleGeoSet(request,env);
      if (path==='/api/events'         && method==='GET')  return handleGetEvents(request,env);
      if (path==='/api/events/update'  && method==='POST') return handleUpdateEvents(request,env);
      if (path==='/api/stats'          && method==='GET')  return handleStats(request,env);
      if (path==='/api/health')                            return json({ok:true,service:'afishiru',ts:Date.now()});
      return json({ok:false,error:'Not found',path},404);
    } catch(e) {
      return json({ok:false,error:'Internal error',detail:e.message},500);
    }
  }
};
