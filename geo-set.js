// /geo-set.js — определение города посетителя по IP, общее для ВСЕХ страниц сайта
// (вынесено из index.html, чтобы концерты/театры/кино/выставки тоже показывали
// правильный город, даже если человек попал сразу на конкретную страницу, минуя
// главную — например, пришёл из поиска сразу на /theater).
//
// Как работает:
// 1. Если город уже выбран вручную (afishi_city_manual==='1') — не трогаем.
// 2. Если город уже определён ранее и не старше 24 часов — используем кэш,
//    без сетевого запроса (не дёргаем API на каждый переход между страницами).
// 3. Иначе — спрашиваем /api/geo (наша база IP2Location + фолбэки на сервере).
// 4. Как только город определён — вызываем window.afishiOnCityDetected(city),
//    если страница такую функцию определила (см. ниже "Как подключить").
//
// Как подключить на странице:
//   <script src="geo-set.js"></script>
//   <script>
//     window.afishiOnCityDetected = function(city) {
//       // Если страница уже отрисовала контент с ДРУГИМ городом (например,
//       // дефолтным "Волгоград" до того, как IP-геолокация успела отработать) —
//       // тихо перерисовать под реальный город
//       if (typeof renderPage === 'function') renderPage(city);
//       if (typeof renderCityPills === 'function') renderCityPills(city);
//     };
//   </script>

(function() {
  var CITY_MAP = {
    'Volgograd':'Волгоград', 'Volzhskiy':'Волгоград',
    'Moscow':'Москва', 'Moskva':'Москва',
    'Saint Petersburg':'Санкт-Петербург', 'St. Petersburg':'Санкт-Петербург',
    'Yekaterinburg':'Екатеринбург', 'Ekaterinburg':'Екатеринбург',
    'Kazan':'Казань', 'Krasnodar':'Краснодар',
    'Rostov-on-Don':'Ростов-на-Дону', 'Novosibirsk':'Новосибирск',
    'Omsk':'Омск', 'Samara':'Самара', 'Ufa':'Уфа',
    'Chelyabinsk':'Челябинск', 'Perm':'Пермь', 'Voronezh':'Воронеж',
    'Krasnoyarsk':'Красноярск', 'Irkutsk':'Иркутск',
    'Vladivostok':'Владивосток', 'Nizhny Novgorod':'Нижний Новгород',
  };
  var KNOWN_CITIES = ['Волгоград','Москва','Санкт-Петербург','Екатеринбург','Казань','Краснодар','Ростов-на-Дону','Новосибирск','Омск','Самара','Уфа','Челябинск','Пермь','Воронеж','Красноярск','Иркутск','Владивосток','Нижний Новгород'];

  function normalizeCity(raw) {
    if (!raw) return null;
    if (KNOWN_CITIES.indexOf(raw) >= 0) return raw; // уже по-русски и в списке
    if (CITY_MAP[raw]) return CITY_MAP[raw];
    var keys = Object.keys(CITY_MAP);
    for (var i = 0; i < keys.length; i++) {
      if (raw.indexOf(keys[i]) >= 0 || keys[i].indexOf(raw) >= 0) return CITY_MAP[keys[i]];
    }
    return null;
  }

  function notifyPage(city, source) {
    try {
      if (typeof window._onGeoCity === 'function') {
        window._onGeoCity(city, source || 'ip');
      }
      if (typeof window.afishiOnCityDetected === 'function') {
        window.afishiOnCityDetected(city);
      }
      document.dispatchEvent(new CustomEvent('afishi:city-detected', { detail: { city: city } }));
      var lbl = document.getElementById('cityTopLabel'); if (lbl) lbl.textContent = city;
      var lbl2 = document.getElementById('cityLabel'); if (lbl2) lbl2.textContent = city;
    } catch (e) {}
  }

  var manual = null, stored = null, ts = null;
  try {
    manual = localStorage.getItem('afishi_city_manual');
    stored = localStorage.getItem('afishi_city');
    ts = localStorage.getItem('afishi_city_ts');
  } catch (e) {}

  if (manual === '1' && stored) return; // выбрано вручную — не трогаем никогда

  var FRESH_MS = 24 * 60 * 60 * 1000; // кэш на 24 часа
  var isFresh = stored && ts && (Date.now() - parseInt(ts, 10) < FRESH_MS);

  if (isFresh) {
    // Есть свежий кэш — сообщаем странице сразу, без сетевого запроса.
    // (Страница и так использует stored-значение при первичной отрисовке;
    // это на случай, если ей нужен явный колбэк.)
    notifyPage(stored, 'cache');
    return;
  }

  // ── Определяем город заново ──────────────────────────────────
  function applyAndNotify(cityRaw) {
    var city = normalizeCity(cityRaw);
    if (!city) return false;
    try {
      localStorage.setItem('afishi_city', city);
      localStorage.setItem('afishi_city_ts', String(Date.now()));
      localStorage.setItem('afishi_geo_source', 'ip');
    } catch (e) {}
    notifyPage(city, 'ip');
    return true;
  }

  // 1. Наш собственный /api/geo (сервер: локальная база IP2Location + фолбэки) —
  // быстрее и надёжнее прямых запросов к сторонним сервисам из браузера.
  fetch('/api/geo')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.city && applyAndNotify(d.city)) return;
      tryIpApiCom();
    })
    .catch(function () { tryIpApiCom(); });

  // 2. ip-api.com — fetch JSON (запасной вариант, если свой /api/geo недоступен)
  function tryIpApiCom() {
    try {
      fetch('https://ip-api.com/json/?fields=status,city&lang=en')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.status === 'success' && d.city && applyAndNotify(d.city)) return;
          tryFreeIpApi();
        }).catch(function () { tryFreeIpApi(); });
    } catch (e) { tryFreeIpApi(); }
  }

  // 3. freeipapi.com — последний запасной вариант
  function tryFreeIpApi() {
    try {
      fetch('https://freeipapi.com/api/json/')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.cityName) applyAndNotify(d.cityName);
          else if (!stored) applyAndNotify('Волгоград'); // совсем не удалось — дефолт
        }).catch(function () { if (!stored) applyAndNotify('Волгоград'); });
    } catch (e) { if (!stored) applyAndNotify('Волгоград'); }
  }
})();
