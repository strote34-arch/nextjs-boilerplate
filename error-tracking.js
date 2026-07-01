// afishi.ru — глобальный перехват JS-ошибок → событие в Яндекс.Метрику (счётчик 110255853)
// Цель: видеть падения скриптов (типа "renderTickets is not defined") в отчётах Метрики
// сразу, без ожидания скриншотов от пользователей.
(function () {
  var METRIKA_ID = 110255853;
  var sentErrors = {};

  function sendToMetrika(message, extra) {
    try {
      var key = String(message).slice(0, 200);
      if (sentErrors[key]) return; // не спамить одинаковыми ошибками в рамках одной сессии
      sentErrors[key] = true;
      if (typeof ym === 'function') {
        ym(METRIKA_ID, 'reachGoal', 'js_error', {
          message: key,
          page: location.pathname,
          extra: extra || ''
        });
      }
    } catch (e) { /* тихо игнорируем, чтобы обработчик ошибок сам не падал */ }
  }

  window.addEventListener('error', function (event) {
    var msg = event && event.message ? event.message : 'unknown error';
    var loc = (event && event.filename) ? (event.filename.split('/').pop() + ':' + event.lineno) : '';
    sendToMetrika(msg, loc);
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason ? (event.reason.message || String(event.reason)) : 'unhandled promise rejection';
    sendToMetrika(reason, 'promise');
  });
})();
