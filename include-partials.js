// afishi.ru — общий загрузчик шапки и подвала (единый header.html / footer.html на весь сайт)
// Правишь шапку/подвал в ОДНОМ месте (header.html или footer.html) — применяется везде,
// где подключён этот скрипт, без ручного копирования по всем страницам.
(function () {
  function inject(mountId, url) {
    var mount = document.getElementById(mountId);
    if (!mount) return;
    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (html) {
        mount.outerHTML = html;
        document.dispatchEvent(new CustomEvent('partial:loaded', { detail: { id: mountId } }));
      })
      .catch(function (err) {
        console.error('Не удалось загрузить ' + url + ':', err);
      });
  }

  inject('header-mount', 'header.html');
  inject('footer-mount', 'footer.html');
})();
