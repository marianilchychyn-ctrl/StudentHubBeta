// ==== StudentHub Cloud Sync (Supabase) ====
// Модель приватності: КОЖЕН користувач бачить і синхронізує ЛИШЕ СВОЇ дані.
// Без входу застосунок працює локально (як і раніше, тільки в цьому браузері).
// Після входу (магічне посилання на пошту, без паролів) дані користувача
// підтягуються/зберігаються в базі — і доступні лише йому, з будь-якого пристрою.
//
// Інструкція з налаштування — у файлі SETUP.md поруч із цим файлом.

const SUPABASE_URL = 'https://zgyqppevksidtprnbkrq.supabase.co';       // напр. https://abcdxyz.supabase.co
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpneXFwcGV2a3NpZHRwcm5ia3JxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNjg1MzUsImV4cCI6MjEwNDY0NDUzNX0.jYDxY1HPa2vHGmtnbH0Q5xYM8qJw8BYSOkm6maVIjT8';      // Project Settings → API → anon public
const LOCAL_KEY = 'student-hub-v5';
const CLOUD_TIMEOUT_MS = 3000; // якщо хмара не відповіла за 3с — застосунок все одно відкриється офлайн

(() => {
  'use strict';
  const configured = SUPABASE_URL.startsWith('https://') && SUPABASE_URL.endsWith('.supabase.co');
  let supabase = null;

  function loadApp() {
    if (document.getElementById('app-js')) return;
    const s = document.createElement('script');
    s.id = 'app-js';
    s.src = 'app.js';
    document.body.appendChild(s);
  }

  // База ще не підключена — запускаємо застосунок так, як він працював досі.
  if (!configured) {
    loadApp();
    return;
  }

  const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(null), ms))
  ]);

  // Підтягує дані ЛИШЕ поточного залогіненого користувача (RLS сам це гарантує:
  // навіть якщо тут помилитись у запиті, чужий рядок сервер просто не поверне).
  async function pullFromCloud() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return; // не залогінений — працюємо локально, без хмари

    const result = await withTimeout(
      supabase.from('user_data').select('data,updated_at').eq('owner', session.user.id).maybeSingle(),
      CLOUD_TIMEOUT_MS
    );
    if (!result || !result.data) return;

    const cloudTime = new Date(result.data.updated_at).getTime();
    const localTime = Number(localStorage.getItem(LOCAL_KEY + '-time') || 0);
    // Береться найсвіжіша версія — хмарна чи локальна — щоб не затерти щойно
    // внесені офлайн-зміни, зроблені до входу чи без інтернету.
    if (cloudTime > localTime) {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(result.data.data));
      localStorage.setItem(LOCAL_KEY + '-time', String(cloudTime));
    }
  }

  // Перехоплює запис у localStorage, яким користується основний app.js,
  // і надсилає зміни в хмару (з невеликою затримкою, щоб не спамити запитами).
  function watchLocalChanges() {
    const originalSetItem = localStorage.setItem.bind(localStorage);
    let pushTimer = null;
    localStorage.setItem = function (key, value) {
      originalSetItem(key, value);
      if (key === LOCAL_KEY) {
        originalSetItem(LOCAL_KEY + '-time', String(Date.now()));
        clearTimeout(pushTimer);
        pushTimer = setTimeout(pushToCloud, 800);
      }
    };
  }

  async function pushToCloud() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return; // не залогінений — зміни лишаються тільки в цьому браузері
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return;
    const payload = JSON.parse(raw);

    // upsert по owner: перший запис створює рядок, наступні — оновлюють той самий.
    // RLS гарантує, що owner тут може бути тільки auth.uid() поточної сесії.
    await supabase.from('user_data')
      .upsert({ owner: session.user.id, data: payload }, { onConflict: 'owner' });
  }

  // Кнопка входу/виходу — потрібна КОЖНОМУ користувачу, не тільки адміну.
  function setupAuthUI() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'cloud-auth-btn';
    btn.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:9999;padding:8px 12px;' +
      'border-radius:8px;border:none;background:#1b2b4a;color:#fff;font-size:12px;cursor:pointer;opacity:.75';

    async function refreshLabel() {
      const { data: { session } } = await supabase.auth.getSession();
      btn.textContent = session ? `☁️ ${session.user.email}` : '☁️ Увійти / синхронізувати';
    }

    btn.addEventListener('click', async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        if (confirm(`Вийти з (${session.user.email})? Дані лишаться в хмарі, але на цьому пристрої — тільки локальна копія.`)) {
          await supabase.auth.signOut();
          refreshLabel();
        }
        return;
      }
      const email = prompt('Твоя пошта (надішлемо посилання для входу):');
      if (!email) return;
      const { error } = await supabase.auth.signInWithOtp({ email });
      alert(error ? 'Помилка: ' + error.message : 'Перевір пошту і перейди за посиланням для входу.');
    });

    document.body.appendChild(btn);
    refreshLabel();

    // Коли користувач переходить за посиланням із листа й повертається на сайт —
    // одразу підтягуємо його дані з хмари.
    supabase.auth.onAuthStateChange(async (_event, session) => {
      refreshLabel();
      if (session) {
        await pullFromCloud();
      }
    });
  }

  async function init() {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    await pullFromCloud();
    loadApp();
    watchLocalChanges();
    setupAuthUI();
  }

  init();
})();
