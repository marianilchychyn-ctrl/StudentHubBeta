// ==== StudentHub Cloud Sync (Supabase) ====
// Модель приватності: КОЖЕН користувач бачить і синхронізує ЛИШЕ СВОЇ дані.
// Без входу застосунок працює локально (як і раніше, тільки в цьому браузері).
// Після входу (магічне посилання на пошту, без паролів) дані користувача
// підтягуються/зберігаються в базі — і доступні лише йому, з будь-якого пристрою.
//
// Інструкція з налаштування — у файлі SETUP.md поруч із цим файлом.

const SUPABASE_URL = 'ВСТАВ_СЮДИ_URL_ПРОЕКТУ';       // напр. https://abcdxyz.supabase.co
const SUPABASE_ANON_KEY = 'ВСТАВ_СЮДИ_ANON_KEY';      // Project Settings → API → anon public
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

  // ---------------------------------------------------------------------
  // UI входу: плаваюча кнопка + модалка (стиль картки на кшталт "Welcome
  // back" — скло, розмиття, градієнтна кнопка), підключена до реального
  // Supabase magic-link входу (без пароля — лист із посиланням на пошту).
  // ---------------------------------------------------------------------
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let lastEmail = '';

  function injectAuthStyles() {
    if (document.getElementById('sh-auth-styles')) return;
    const style = document.createElement('style');
    style.id = 'sh-auth-styles';
    style.textContent = `
.sh-auth-backdrop{position:fixed;inset:0;z-index:998;display:none;align-items:center;justify-content:center;
  padding:20px;background:rgba(2,5,10,.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  opacity:0;transition:opacity .25s ease}
.sh-auth-backdrop.open{display:flex;opacity:1}
.sh-auth-modal{width:min(380px,100%);background:linear-gradient(160deg,#101827f2,#0b1420f2);
  border:1px solid var(--line);border-radius:20px;padding:28px 26px 26px;position:relative;
  box-shadow:0 30px 80px #000a,0 0 0 1px #ffffff08 inset;
  transform:translateY(14px) scale(.97);opacity:0;transition:transform .3s cubic-bezier(.16,.84,.44,1),opacity .3s ease}
.sh-auth-backdrop.open .sh-auth-modal{transform:translateY(0) scale(1);opacity:1}
.sh-auth-close{position:absolute;right:14px;top:12px;background:transparent;border:0;color:var(--muted);
  font-size:22px;line-height:1;cursor:pointer;width:30px;height:30px;border-radius:8px;display:grid;
  place-items:center;transition:background .2s ease,color .2s ease}
.sh-auth-close:hover{background:#ffffff12;color:#fff}
.sh-auth-brand{display:flex;align-items:center;gap:8px;font:800 11px 'DM Mono',monospace;letter-spacing:1.2px;
  color:var(--blue);margin:0 0 18px}
.sh-auth-modal h2{font-size:22px;letter-spacing:-.4px;margin:0 0 6px}
.sh-auth-sub{color:var(--muted);font-size:12.5px;line-height:1.55;margin:0 0 22px}
.sh-auth-field{display:grid;gap:6px;margin:0 0 16px}
.sh-auth-field span{font-size:11px;color:var(--muted)}
.sh-auth-field input{background:#09111d;border:1px solid #2d3b50;color:var(--text);border-radius:9px;
  padding:12px 13px;font:14px Manrope,Arial,sans-serif;outline:0;width:100%;
  transition:border-color .2s ease,box-shadow .2s ease}
.sh-auth-field input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(70,182,255,.18)}
.sh-auth-submit{width:100%;border:0;border-radius:10px;padding:13px;font:800 13.5px Manrope,Arial,sans-serif;
  color:#06131d;cursor:pointer;background:linear-gradient(135deg,var(--blue),var(--violet));
  box-shadow:0 10px 26px rgba(70,182,255,.3);transition:filter .2s ease,transform .15s ease}
.sh-auth-submit:hover{filter:brightness(1.08)}
.sh-auth-submit:active{transform:scale(.98)}
.sh-auth-submit:disabled{opacity:.6;cursor:default;filter:none;transform:none}
.sh-auth-hint{font-size:11.5px;color:var(--muted);text-align:center;line-height:1.5;margin:14px 0 0}
.sh-auth-icon{font-size:32px;text-align:center;margin:0 0 8px}
.sh-auth-lead{text-align:center;font-size:13.5px;margin:0 0 4px;color:var(--text)}
.sh-auth-lead b{color:var(--blue)}
.sh-auth-secondary{display:block;margin:16px auto 0;background:transparent;border:1px solid var(--line);
  color:var(--muted);border-radius:9px;padding:9px 16px;font:700 12px Manrope,Arial,sans-serif;cursor:pointer;
  transition:.2s ease}
.sh-auth-secondary:hover{border-color:var(--blue);color:var(--text)}
.sh-auth-secondary.danger:hover{border-color:#ff8a8a;color:#ffb3b3}
.sh-auth-error{color:#ff8a8a;font-size:12px;text-align:center;margin:14px 0 0}
.sh-auth-trigger{position:fixed;bottom:16px;right:16px;z-index:900;border:1px solid var(--line);
  background:#101827e6;color:var(--text);border-radius:99px;padding:10px 16px 10px 12px;
  font:700 12px Manrope,Arial,sans-serif;display:flex;align-items:center;gap:7px;cursor:pointer;
  box-shadow:0 12px 28px #0007;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  transition:border-color .2s ease,transform .2s ease;max-width:min(70vw,240px)}
.sh-auth-trigger span.sh-auth-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sh-auth-trigger:hover{border-color:var(--blue);transform:translateY(-1px)}
.sh-auth-dot{width:7px;height:7px;border-radius:50%;background:var(--muted);flex:none}
.sh-auth-trigger.signed-in .sh-auth-dot{background:var(--green);box-shadow:0 0 8px var(--green)}
@media (max-width:610px){.sh-auth-trigger{bottom:14px;right:14px;padding:9px 14px 9px 11px}}
@media (prefers-reduced-motion: reduce){.sh-auth-backdrop,.sh-auth-modal,.sh-auth-trigger{transition:none}}
`;
    document.head.appendChild(style);
  }

  function buildAuthUI() {
    if (document.getElementById('sh-auth-backdrop')) return;

    const backdrop = document.createElement('div');
    backdrop.className = 'sh-auth-backdrop';
    backdrop.id = 'sh-auth-backdrop';
    backdrop.innerHTML = `
      <div class="sh-auth-modal" role="dialog" aria-modal="true" aria-labelledby="sh-auth-title">
        <button type="button" class="sh-auth-close" id="sh-auth-close" aria-label="Закрити">×</button>
        <p class="sh-auth-brand"><span aria-hidden="true">☁</span> STUDENT HUB</p>

        <div data-sh-state="form">
          <h2 id="sh-auth-title">З поверненням</h2>
          <p class="sh-auth-sub">Увійди поштою, щоб синхронізувати розклад, завдання й матеріали між пристроями.</p>
          <form id="sh-auth-form">
            <label class="sh-auth-field"><span>Email</span>
              <input type="email" id="sh-auth-email" placeholder="you@example.com" autocomplete="email" required>
            </label>
            <button type="submit" class="sh-auth-submit" id="sh-auth-submit">Надіслати посилання для входу</button>
          </form>
          <p class="sh-auth-hint">Без пароля — просто перейди за посиланням у листі.</p>
        </div>

        <div data-sh-state="sent" hidden>
          <div class="sh-auth-icon" aria-hidden="true">✉️</div>
          <p class="sh-auth-lead">Лист надіслано на <b id="sh-auth-sent-email"></b></p>
          <p class="sh-auth-hint">Перейди за посиланням у листі — і після повернення сюди дані підключаться самі.</p>
          <button type="button" class="sh-auth-secondary" id="sh-auth-resend">Надіслати ще раз</button>
        </div>

        <div data-sh-state="signed-in" hidden>
          <div class="sh-auth-icon" aria-hidden="true">☁️</div>
          <p class="sh-auth-lead">Увійшов як <b id="sh-auth-user-email"></b></p>
          <p class="sh-auth-hint">Дані синхронізуються автоматично на всіх твоїх пристроях.</p>
          <button type="button" class="sh-auth-secondary danger" id="sh-auth-signout">Вийти</button>
        </div>

        <p class="sh-auth-error" id="sh-auth-error" hidden></p>
      </div>
    `;
    document.body.appendChild(backdrop);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'sh-auth-trigger';
    trigger.id = 'sh-auth-trigger';
    trigger.innerHTML = '<span class="sh-auth-dot" aria-hidden="true"></span><span class="sh-auth-label">Увійти</span>';
    document.body.appendChild(trigger);

    const els = {
      backdrop,
      trigger,
      states: backdrop.querySelectorAll('[data-sh-state]'),
      close: backdrop.querySelector('#sh-auth-close'),
      form: backdrop.querySelector('#sh-auth-form'),
      email: backdrop.querySelector('#sh-auth-email'),
      submit: backdrop.querySelector('#sh-auth-submit'),
      sentEmail: backdrop.querySelector('#sh-auth-sent-email'),
      resend: backdrop.querySelector('#sh-auth-resend'),
      userEmail: backdrop.querySelector('#sh-auth-user-email'),
      signout: backdrop.querySelector('#sh-auth-signout'),
      error: backdrop.querySelector('#sh-auth-error'),
      label: trigger.querySelector('.sh-auth-label')
    };

    function showState(name) {
      els.states.forEach(el => { el.hidden = el.getAttribute('data-sh-state') !== name; });
      els.error.hidden = true;
    }

    function showError(message) {
      els.error.textContent = message;
      els.error.hidden = false;
    }

    function openModal() {
      els.backdrop.classList.add('open');
      const visible = backdrop.querySelector('[data-sh-state]:not([hidden])');
      if (visible && visible.getAttribute('data-sh-state') === 'form') {
        setTimeout(() => els.email.focus(), 50);
      }
    }

    function closeModal() {
      els.backdrop.classList.remove('open');
    }

    async function sendMagicLink(email) {
      els.submit.disabled = true;
      els.submit.textContent = 'Надсилаємо…';
      const { error } = await supabase.auth.signInWithOtp({ email });
      els.submit.disabled = false;
      els.submit.textContent = 'Надіслати посилання для входу';
      if (error) {
        showError(error.message || 'Не вдалося надіслати лист. Спробуй ще раз.');
        return;
      }
      lastEmail = email;
      els.sentEmail.textContent = email;
      showState('sent');
    }

    els.close.addEventListener('click', closeModal);
    els.backdrop.addEventListener('click', (e) => { if (e.target === els.backdrop) closeModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.backdrop.classList.contains('open')) closeModal();
    });

    els.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = els.email.value.trim();
      if (!EMAIL_RE.test(email)) {
        showError('Введи коректну адресу пошти.');
        return;
      }
      await sendMagicLink(email);
    });

    els.resend.addEventListener('click', () => {
      if (lastEmail) sendMagicLink(lastEmail);
    });

    els.signout.addEventListener('click', async () => {
      await supabase.auth.signOut();
      closeModal();
    });

    trigger.addEventListener('click', openModal);

    async function refreshUI() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        els.label.textContent = 'Синхронізовано';
        trigger.classList.add('signed-in');
        els.userEmail.textContent = session.user.email;
        showState('signed-in');
      } else {
        els.label.textContent = 'Увійти';
        trigger.classList.remove('signed-in');
        showState('form');
      }
    }

    supabase.auth.onAuthStateChange(async (_event, session) => {
      refreshUI();
      if (session) {
        await pullFromCloud();
      }
    });

    refreshUI();
  }

  function setupAuthUI() {
    injectAuthStyles();
    buildAuthUI();
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
