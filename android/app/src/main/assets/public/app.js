/**
 * app.js
 * نقطة الدخول: يدير شاشة الدخول/الجلسة، هيكل التطبيق (رأس + تنقل + صفحات)،
 * والتبديل بين الصفحات دون إعادة بناء DOM في كل مرة (لأداء أفضل وحفاظ على
 * حالة الرسوم البيانية).
 */

import * as auth from './auth.js';
import { t, applyDocumentDirection } from './i18n.js';
import { applyTheme, getTheme } from './settings.js';
import { getBaseUrl, setBaseUrl } from './api.js';
import { getLog, clearLog } from './notifications.js';

import * as dashboard from './dashboard.js';
import * as network from './network.js';
import * as wifi from './wifi.js';
import * as devices from './devices.js';
import * as sms from './sms.js';
import * as settings from './settings.js';

const PAGES = {
  dashboard: { module: dashboard, titleKey: 'nav_dashboard', icon: '⌂' },
  network: { module: network, titleKey: 'nav_network', icon: '📡' },
  wifi: { module: wifi, titleKey: 'nav_wifi', icon: '📶' },
  devices: { module: devices, titleKey: 'nav_devices', icon: '💻' },
  sms: { module: sms, titleKey: 'nav_sms', icon: '✉' },
  settings: { module: settings, titleKey: 'nav_settings', icon: '⚙' },
};

let currentPage = null;
const pageSections = {};
let sessionWatchTimer = null;
let deferredInstallPrompt = null;

/* ---------------------------------- الإقلاع --------------------------------- */

async function boot() {
  applyDocumentDirection();
  applyTheme();

  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getTheme() === 'system') applyTheme('system');
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    document.querySelector('[data-action="install"]')?.classList.remove('hidden');
  });

  registerServiceWorker();

  const restored = await auth.restoreSession();
  if (restored) showApp();
  else showLogin();
}

function registerServiceWorker() {
  if (window.Capacitor?.isNativePlatform?.()) return; // لا حاجة لها: الملفات مضمّنة محليًا في التطبيق أصلًا
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('[app] تعذر تسجيل service worker:', err);
    });
  });
}

/* --------------------------------- شاشة الدخول ------------------------------- */

function showLogin(errorMsg = '') {
  stopSessionWatch();
  document.body.dataset.view = 'login';
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="login-screen">
      <div class="login-card card">
        <div class="login-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="40" height="40"><path fill="currentColor" d="M12 20a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2Zm-4.2-4.9-1.4-1.5a8 8 0 0 1 11.2 0l-1.4 1.5a6 6 0 0 0-8.4 0ZM4.6 12l-1.4-1.5a14 14 0 0 1 17.6 0L19.4 12a12 12 0 0 0-14.8 0Z"/></svg>
        </div>
        <h1 class="login-title">${t('login_title')}</h1>
        <p class="login-subtitle">${t('login_subtitle')}</p>
        <form id="login-form">
          <label class="field">
            <span>${t('router_address_label')}</span>
            <input type="text" name="baseUrl" value="${getBaseUrl()}" dir="ltr" />
          </label>
          <label class="field">
            <span>${t('username_label')}</span>
            <input type="text" name="username" value="admin" autocomplete="username" dir="ltr" />
          </label>
          <label class="field">
            <span>${t('password_label')}</span>
            <input type="password" name="password" placeholder="${t('password_placeholder')}" autocomplete="current-password" required />
          </label>
          <button type="submit" class="btn btn-block">${t('login_button')}</button>
          <p class="login-error" data-login-error>${errorMsg}</p>
        </form>
      </div>
    </div>
  `;
  document.getElementById('login-form').addEventListener('submit', onLoginSubmit);
}

async function onLoginSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type="submit"]');
  const errorEl = form.querySelector('[data-login-error]');
  errorEl.textContent = '';

  const baseUrl = form.elements.baseUrl.value.trim();
  if (baseUrl) setBaseUrl(baseUrl);

  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = t('login_loading');
  try {
    await auth.login(form.elements.username.value.trim() || 'admin', form.elements.password.value);
    showApp();
  } catch (err) {
    errorEl.textContent = err.code === 'NETWORK' ? t('error_network') : t('login_error');
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

/* --------------------------------- هيكل التطبيق ------------------------------ */

function showApp() {
  document.body.dataset.view = 'app';
  currentPage = null;
  Object.keys(pageSections).forEach((k) => delete pageSections[k]);

  const root = document.getElementById('app-root');
  root.innerHTML = `
    <header class="app-header">
      <div class="app-title">
        <span class="app-title-icon">📶</span>
        ${t('app_name')}
      </div>
      <div class="header-actions">
        <button class="icon-btn hidden" data-action="install" title="${t('app_name')}">⤓</button>
        <button class="icon-btn" data-action="notifications">🔔<span class="notif-dot hidden" data-notif-dot></span></button>
        <button class="icon-btn" data-action="logout" title="${t('logout_button')}">⎋</button>
      </div>
    </header>

    <main class="app-main" id="page-container"></main>

    <nav class="bottom-nav">
      ${Object.entries(PAGES)
        .map(
          ([key, p]) => `
        <button class="nav-btn" data-nav="${key}">
          <span class="nav-icon">${p.icon}</span>
          <span class="nav-label">${t(p.titleKey)}</span>
        </button>`
        )
        .join('')}
    </nav>

    <div class="notif-panel hidden" data-panel="notifications">
      <div class="notif-panel-header">
        <span>${t('notifications_title')}</span>
        <button class="icon-btn" data-action="close-notifications">✕</button>
      </div>
      <div class="notif-list" data-notif-list></div>
      <button class="btn btn-outline btn-sm" data-action="clear-notifications">${t('clear_log')}</button>
    </div>
  `;

  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.nav));
  });
  document.querySelector('[data-action="logout"]').addEventListener('click', onLogout);
  document.querySelector('[data-action="notifications"]').addEventListener('click', toggleNotifPanel);
  document.querySelector('[data-action="close-notifications"]').addEventListener('click', toggleNotifPanel);
  document.querySelector('[data-action="clear-notifications"]').addEventListener('click', () => {
    clearLog();
    renderNotifPanel();
  });
  document.querySelector('[data-action="install"]').addEventListener('click', onInstallClick);
  document.addEventListener('hlk:notification', onNewNotification);
  document.addEventListener('visibilitychange', onVisibilityChange);

  navigateTo('dashboard');
  startSessionWatch();
  renderNotifPanel();
}

function navigateTo(key) {
  if (!PAGES[key] || currentPage === key) return;
  if (currentPage === 'dashboard') dashboard.stopAutoRefresh();

  currentPage = key;
  document.querySelectorAll('[data-nav]').forEach((b) => b.classList.toggle('active', b.dataset.nav === key));

  const main = document.getElementById('page-container');
  Object.entries(pageSections).forEach(([k, section]) => section.classList.toggle('hidden', k !== key));

  if (!pageSections[key]) {
    const section = document.createElement('section');
    section.className = 'page';
    main.appendChild(section);
    pageSections[key] = section;
    PAGES[key].module.render(section);
  } else if (key !== 'dashboard' && typeof PAGES[key].module.refresh === 'function') {
    PAGES[key].module.refresh();
  }

  if (key === 'dashboard') dashboard.startAutoRefresh();
}

function onVisibilityChange() {
  if (document.hidden) {
    if (currentPage === 'dashboard') dashboard.stopAutoRefresh();
  } else if (currentPage === 'dashboard') {
    dashboard.startAutoRefresh();
  }
}

async function onLogout() {
  dashboard.stopAutoRefresh();
  await auth.logout();
  showLogin();
}

async function onInstallClick() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.querySelector('[data-action="install"]')?.classList.add('hidden');
}

/* ------------------------------- لوحة الإشعارات ------------------------------ */

function toggleNotifPanel() {
  const panel = document.querySelector('[data-panel="notifications"]');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) renderNotifPanel();
  document.querySelector('[data-notif-dot]')?.classList.add('hidden');
}

function onNewNotification() {
  document.querySelector('[data-notif-dot]')?.classList.remove('hidden');
  const panel = document.querySelector('[data-panel="notifications"]');
  if (panel && !panel.classList.contains('hidden')) renderNotifPanel();
}

function renderNotifPanel() {
  const list = document.querySelector('[data-notif-list]');
  if (!list) return;
  const log = getLog();
  if (log.length === 0) {
    list.innerHTML = `<p class="empty-state">${t('no_notifications')}</p>`;
    return;
  }
  list.innerHTML = log
    .slice(0, 50)
    .map(
      (n) => `
      <div class="notif-item">
        <span class="notif-title">${n.title}</span>
        <span class="notif-time">${new Date(n.at).toLocaleString()}</span>
      </div>`
    )
    .join('');
}

/* ------------------------------ مراقبة صلاحية الجلسة -------------------------- */

function startSessionWatch() {
  stopSessionWatch();
  sessionWatchTimer = setInterval(async () => {
    const valid = await auth.verifySessionStillValid();
    if (!valid) {
      dashboard.stopAutoRefresh();
      showLogin(t('session_expired'));
    }
  }, 60_000);
}

function stopSessionWatch() {
  if (sessionWatchTimer) clearInterval(sessionWatchTimer);
  sessionWatchTimer = null;
}

boot();
