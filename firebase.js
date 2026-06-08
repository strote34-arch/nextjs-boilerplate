// ════════════════════════════════════════════════════════════════
// afishi.ru — Firebase Backend Module v1.0
// Замена localStorage на Firebase Realtime Database + Auth
//
// НАСТРОЙКА:
// 1. Создайте проект на https://console.firebase.google.com
// 2. Добавьте Web App → скопируйте firebaseConfig
// 3. Замените значения в FIREBASE_CONFIG ниже
// 4. Включите Authentication → Email/Password
// 5. Включите Realtime Database → правила безопасности ниже
//
// ПРАВИЛА БАЗЫ ДАННЫХ (вставьте в Firebase Console → Database → Rules):
/*
{
  "rules": {
    "users": {
      "$uid": {
        ".read": "$uid === auth.uid || root.child('admins').child(auth.uid).exists()",
        ".write": "$uid === auth.uid"
      }
    },
    "reviews": {
      ".read": true,
      "$key": {
        ".write": "auth != null"
      }
    },
    "events": {
      "pending": {
        ".read": "root.child('admins').child(auth.uid).exists()",
        ".write": "auth != null"
      },
      "approved": {
        ".read": true,
        ".write": "root.child('admins').child(auth.uid).exists()"
      }
    },
    "cities": {
      ".read": true,
      ".write": "root.child('admins').child(auth.uid).exists()"
    },
    "banners": {
      ".read": true,
      ".write": "root.child('admins').child(auth.uid).exists()"
    },
    "analytics": {
      ".read": "root.child('admins').child(auth.uid).exists()",
      ".write": "root.child('admins').child(auth.uid).exists()"
    },
    "admins": {
      ".read": "auth != null",
      ".write": false
    }
  }
}
*/
// ════════════════════════════════════════════════════════════════

// ── ВСТАВЬТЕ ВАШИ ДАННЫЕ Firebase ────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "ВАША_API_KEY",
  authDomain:        "ВАШ_ПРОЕКТ.firebaseapp.com",
  databaseURL:       "https://ВАШ_ПРОЕКТ-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "ВАШ_ПРОЕКТ",
  storageBucket:     "ВАШ_ПРОЕКТ.appspot.com",
  messagingSenderId: "ВАШИ_ЦИФРЫ",
  appId:             "ВАШИ_ДАННЫЕ"
};
// ─────────────────────────────────────────────────────────────

// Режим работы: 'firebase' или 'local' (localStorage fallback)
// Переключается автоматически если Firebase не настроен
let AFISHI_MODE = 'local';

// ── Инициализация ─────────────────────────────────────────────
(function initFirebase() {
  if (FIREBASE_CONFIG.apiKey === 'ВАША_API_KEY') {
    console.info('[Afishi] Firebase не настроен → работаем в режиме localStorage');
    return;
  }
  // Firebase SDK подключается динамически
  const scripts = [
    'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js'
  ];
  let loaded = 0;
  scripts.forEach(src => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => {
      loaded++;
      if (loaded === scripts.length) {
        try {
          firebase.initializeApp(FIREBASE_CONFIG);
          AFISHI_MODE = 'firebase';
          window._fb = firebase.database();
          window._fbAuth = firebase.auth();
          console.info('[Afishi] Firebase подключён ✅');
          // Восстановить сессию
          firebase.auth().onAuthStateChanged(user => {
            if (user) {
              AfishiDB.getUser(user.uid).then(data => {
                if (data) {
                  window._fbCurrentUser = { ...data, uid: user.uid };
                  document.dispatchEvent(new CustomEvent('afishi:login', { detail: window._fbCurrentUser }));
                }
              });
            }
          });
        } catch(e) {
          console.warn('[Afishi] Firebase init error:', e);
        }
      }
    };
    document.head.appendChild(s);
  });
})();

// ════════════════════════════════════════════════════════════════
// AfishiDB — единый API для работы с данными
// Автоматически выбирает Firebase или localStorage
// ════════════════════════════════════════════════════════════════
window.AfishiDB = {

  // ── ВСПОМОГАТЕЛЬНЫЕ ──────────────────────────────────────────
  _ls(key, def = null) {
    try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch(e) { return def; }
  },
  _lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {}
  },
  _fb(path) {
    return window._fb ? window._fb.ref(path) : null;
  },

  // ── АВТОРИЗАЦИЯ ───────────────────────────────────────────────

  async register(name, email, pass, city = 'Волгоград', birthday = '') {
    if (AFISHI_MODE === 'firebase') {
      const cred = await firebase.auth().createUserWithEmailAndPassword(email, pass);
      const uid = cred.user.uid;
      const userData = {
        name, email, city, birthday,
        role: 'user',
        joined: new Date().toISOString(),
        points: 0
      };
      await window._fb.ref('users/' + uid).set(userData);
      window._fbCurrentUser = { ...userData, uid };
      return { ok: true, user: window._fbCurrentUser };
    } else {
      // localStorage fallback
      const accounts = this._ls('afishi_accounts', []);
      if (accounts.find(a => a.email === email)) {
        return { ok: false, error: 'Email уже зарегистрирован' };
      }
      const user = {
        name, email, pass, city, birthday,
        role: email === 'admin@afishi.ru' ? 'admin' : 'user',
        joined: new Date().toISOString(),
        points: 0
      };
      accounts.push(user);
      this._lsSet('afishi_accounts', accounts);
      this._lsSet('afishi_user', user);
      return { ok: true, user };
    }
  },

  async login(email, pass) {
    if (AFISHI_MODE === 'firebase') {
      const cred = await firebase.auth().signInWithEmailAndPassword(email, pass);
      const uid = cred.user.uid;
      const data = await this.getUser(uid);
      window._fbCurrentUser = { ...data, uid };
      return { ok: true, user: window._fbCurrentUser };
    } else {
      const accounts = this._ls('afishi_accounts', []);
      const found = accounts.find(a => a.email === email && a.pass === pass);
      if (!found) return { ok: false, error: 'Неверный email или пароль' };
      this._lsSet('afishi_user', found);
      return { ok: true, user: found };
    }
  },

  async logout() {
    if (AFISHI_MODE === 'firebase') {
      await firebase.auth().signOut();
      window._fbCurrentUser = null;
    } else {
      localStorage.removeItem('afishi_user');
    }
  },

  getCurrentUser() {
    if (AFISHI_MODE === 'firebase') return window._fbCurrentUser || null;
    return this._ls('afishi_user', null);
  },

  async getUser(uid) {
    if (AFISHI_MODE === 'firebase') {
      const snap = await window._fb.ref('users/' + uid).once('value');
      return snap.val();
    }
    return this._ls('afishi_user', null);
  },

  async updateUser(uid, data) {
    if (AFISHI_MODE === 'firebase') {
      await window._fb.ref('users/' + uid).update(data);
      if (window._fbCurrentUser) window._fbCurrentUser = { ...window._fbCurrentUser, ...data };
    } else {
      const accounts = this._ls('afishi_accounts', []);
      const idx = accounts.findIndex(a => a.email === data.email);
      if (idx >= 0) { accounts[idx] = { ...accounts[idx], ...data }; this._lsSet('afishi_accounts', accounts); }
      const cur = this._ls('afishi_user', null);
      if (cur) this._lsSet('afishi_user', { ...cur, ...data });
    }
  },

  // ── РЕЦЕНЗИИ ─────────────────────────────────────────────────

  async getReviews(type, itemId) {
    const key = type + '::' + itemId;
    if (AFISHI_MODE === 'firebase') {
      const snap = await window._fb.ref('reviews/' + key.replace(/[.#$[\]]/g, '_')).once('value');
      const val = snap.val();
      if (!val) return [];
      return Object.values(val);
    } else {
      const db = this._ls('afishi_reviews', {});
      return db[key] || [];
    }
  },

  async addReview(type, itemId, review) {
    const key = type + '::' + itemId;
    if (AFISHI_MODE === 'firebase') {
      const fbKey = key.replace(/[.#$[\]]/g, '_');
      await window._fb.ref('reviews/' + fbKey).push({
        ...review,
        date: new Date().toISOString()
      });
    } else {
      const db = this._ls('afishi_reviews', {});
      if (!db[key]) db[key] = [];
      db[key].push({ ...review, date: new Date().toISOString() });
      this._lsSet('afishi_reviews', db);
    }
  },

  async getAllReviews() {
    if (AFISHI_MODE === 'firebase') {
      const snap = await window._fb.ref('reviews').once('value');
      const val = snap.val() || {};
      const all = [];
      Object.entries(val).forEach(([key, items]) => {
        const parts = key.replace(/_/g, '::').split('::');
        const pageId = parts[0], itemId = parts.slice(1).join('::');
        Object.values(items || {}).forEach(rv => {
          all.push({ ...rv, _key: key, _pageType: pageId, _itemId: itemId });
        });
      });
      return all;
    } else {
      const db = this._ls('afishi_reviews', {});
      const all = [];
      Object.entries(db).forEach(([key, items]) => {
        const parts = key.split('::');
        (items || []).forEach(rv => all.push({ ...rv, _key: key, _pageType: parts[0], _itemId: parts[1] }));
      });
      return all;
    }
  },

  // ── МЕРОПРИЯТИЯ ──────────────────────────────────────────────

  async submitEvent(eventData) {
    if (AFISHI_MODE === 'firebase') {
      await window._fb.ref('events/pending').push({
        ...eventData,
        status: 'pending',
        submitted: new Date().toISOString()
      });
    } else {
      const pending = this._ls('afishi_pending_events', []);
      pending.push({ ...eventData, status: 'pending', submitted: new Date().toISOString() });
      this._lsSet('afishi_pending_events', pending);
    }
  },

  async getPendingEvents() {
    if (AFISHI_MODE === 'firebase') {
      const snap = await window._fb.ref('events/pending').once('value');
      const val = snap.val() || {};
      return Object.entries(val).map(([id, ev]) => ({ ...ev, _fbId: id }));
    } else {
      return this._ls('afishi_pending_events', []);
    }
  },

  async approveEvent(event, fbId = null) {
    if (AFISHI_MODE === 'firebase') {
      if (fbId) await window._fb.ref('events/pending/' + fbId).remove();
      await window._fb.ref('events/approved').push({ ...event, status: 'approved' });
    } else {
      const pending = this._ls('afishi_pending_events', []);
      const approved = this._ls('afishi_approved_events', []);
      const idx = pending.findIndex(e => e.id === event.id);
      if (idx >= 0) pending.splice(idx, 1);
      approved.push({ ...event, status: 'approved' });
      this._lsSet('afishi_pending_events', pending);
      this._lsSet('afishi_approved_events', approved);
    }
  },

  async getApprovedEvents() {
    if (AFISHI_MODE === 'firebase') {
      const snap = await window._fb.ref('events/approved').once('value');
      const val = snap.val() || {};
      return Object.values(val);
    } else {
      return this._ls('afishi_approved_events', []);
    }
  },

  // ── ГОРОДА ───────────────────────────────────────────────────

  async getCities() {
    if (AFISHI_MODE === 'firebase') {
      const snap = await window._fb.ref('cities').once('value');
      return snap.val() || null;
    } else {
      return this._ls('afishi_cities_config', null);
    }
  },

  async saveCities(config) {
    if (AFISHI_MODE === 'firebase') {
      await window._fb.ref('cities').set(config);
    } else {
      this._lsSet('afishi_cities_config', config);
    }
  },

  // ── БАННЕРЫ ──────────────────────────────────────────────────

  async getBanners() {
    if (AFISHI_MODE === 'firebase') {
      const snap = await window._fb.ref('banners').once('value');
      return snap.val() || null;
    } else {
      return this._ls('afishi_banners', null);
    }
  },

  async saveBanners(config) {
    if (AFISHI_MODE === 'firebase') {
      await window._fb.ref('banners').set(config);
    } else {
      this._lsSet('afishi_banners', config);
    }
  },

  // ── АНАЛИТИКА ────────────────────────────────────────────────

  async getAnalytics() {
    if (AFISHI_MODE === 'firebase') {
      const snap = await window._fb.ref('analytics').once('value');
      return snap.val() || {};
    } else {
      return this._ls('afishi_analytics', {});
    }
  },

  async saveAnalytics(config) {
    if (AFISHI_MODE === 'firebase') {
      await window._fb.ref('analytics').set(config);
    } else {
      this._lsSet('afishi_analytics', config);
    }
  },

  // ── REAL-TIME ПОДПИСКИ (только Firebase) ─────────────────────

  onReviewsChange(type, itemId, callback) {
    if (AFISHI_MODE !== 'firebase') return () => {};
    const key = (type + '::' + itemId).replace(/[.#$[\]]/g, '_');
    const ref = window._fb.ref('reviews/' + key);
    ref.on('value', snap => {
      const val = snap.val() || {};
      callback(Object.values(val));
    });
    return () => ref.off();
  },

  onPendingEventsChange(callback) {
    if (AFISHI_MODE !== 'firebase') return () => {};
    const ref = window._fb.ref('events/pending');
    ref.on('value', snap => {
      const val = snap.val() || {};
      callback(Object.entries(val).map(([id, ev]) => ({ ...ev, _fbId: id })));
    });
    return () => ref.off();
  },

  // ── РЕЖИМ ────────────────────────────────────────────────────
  getMode() { return AFISHI_MODE; },
  isFirebase() { return AFISHI_MODE === 'firebase'; }
};

// Сигнал что модуль готов
document.dispatchEvent(new CustomEvent('afishidb:ready'));
console.info('[AfishiDB] Модуль загружен, режим:', AFISHI_MODE);
