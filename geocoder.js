
// ── Яндекс Геокодер — автоматическое геокодирование адресов ──
// Используется в map.html для точных координат площадок
async function geocodeAddress(address, apiKey) {
  const url = `https://geocode-maps.yandex.ru/1.x/?apikey=${apiKey}&geocode=${encodeURIComponent(address + ', Волгоград')}&format=json&results=1&lang=ru_RU`;
  const res = await fetch(url);
  const data = await res.json();
  const point = data?.response?.GeoObjectCollection?.featureMember?.[0]
    ?.GeoObject?.Point?.pos;
  if (!point) return null;
  const [lng, lat] = point.split(' ').map(Number);
  return { lat, lng };
}

// Обновить координаты всех площадок при наличии ключа
async function updateVenueCoords(apiKey) {
  const venues = document.querySelectorAll('[data-venue-addr]');
  for (const venue of venues) {
    const addr = venue.dataset.venueAddr;
    const id   = venue.dataset.venueId;
    const coords = await geocodeAddress(addr, apiKey);
    if (coords) {
      // Обновить маркер на карте
      if (window._venueMarkers && window._venueMarkers[id]) {
        window._venueMarkers[id].setLatLng([coords.lat, coords.lng]);
      }
      venue.dataset.lat = coords.lat;
      venue.dataset.lng = coords.lng;
    }
    await new Promise(r => setTimeout(r, 200)); // пауза между запросами
  }
}
