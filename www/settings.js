/**
 * settings.js
 * صفحة الإعدادات: المظهر (فاتح/داكن/حسب النظام)، اللغة، فترة التحديث،
 * عنوان الراوتر، تصدير/استيراد/نسخ احتياطي، وحذف كل بيانات التطبيق.
 */

import { t, getLang, setLang } from './i18n.js';
import { getBaseUrl, setBaseUrl } from './api.js';
import { getRefreshInterval, setRefreshInterval } from './dashboard.js';
import { allKeys, getRaw, setRaw, clearAll } from './storage.js';
import { requestPermission, getPermissionState, getLog, clearLog } from './notifications.js';

let container = null;

const THEME_KEY = 'theme'; // 'light' | 'dark' | 'system'

export function getTheme() {
  return getRaw(THEME_KEY, 'system');
}

export function applyTheme(theme) {
  const t = theme || getTheme();
  const resolved = t === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
  document.documentElement.setAttribute('data-theme', resolved);
}

export function render(el) {
  container = el;
  const theme = getTheme();
  const lang = getLang();
  const interval = getRefreshInterval();

  container.innerHTML = `
    <div class="card">
      <h3 class="card-title">${t('appearance_section')}</h3>
      <label class="field">
        <span>${t('theme_label')}</span>
        <select data-setting="theme">
          <option value="light" ${theme === 'light' ? 'selected' : ''}>${t('theme_light')}</option>
          <option value="dark" ${theme === 'dark' ? 'selected' : ''}>${t('theme_dark')}</option>
          <option value="system" ${theme === 'system' ? 'selected' : ''}>${t('theme_system')}</option>
        </select>
      </label>
      <label class="field">
        <span>${t('language_label')}</span>
        <select data-setting="lang">
          <option value="ar" ${lang === 'ar' ? 'selected' : ''}>العربية</option>
          <option value="en" ${lang === 'en' ? 'selected' : ''}>English</option>
        </select>
      </label>
    </div>

    <div class="card">
      <h3 class="card-title">${t('general_section')}</h3>
      <label class="field">
        <span>${t('update_interval_label')}</span>
        <select data-setting="interval">
          <option value="1000" ${interval === 1000 ? 'selected' : ''}>1 ${t('seconds')}</option>
          <option value="2000" ${interval === 2000 ? 'selected' : ''}>2 ${t('seconds')}</option>
          <option value="5000" ${interval === 5000 ? 'selected' : ''}>5 ${t('seconds')}</option>
          <option value="10000" ${interval === 10000 ? 'selected' : ''}>10 ${t('seconds')}</option>
        </select>
      </label>
      <label class="field">
        <span>${t('enable_notifications')}</span>
        <button class="btn btn-outline btn-sm" data-action="request-notifications">
          ${getPermissionState() === 'granted' ? '✓' : t('enable_notifications')}
        </button>
      </label>
    </div>

    <div class="card">
      <h3 class="card-title">${t('connection_section')}</h3>
      <label class="field">
        <span>${t('router_address_label')}</span>
        <input type="text" data-setting="baseUrl" value="${getBaseUrl()}" placeholder="http://192.168.1.1" />
      </label>
      <p class="hint">${t('error_cors_hint')}</p>
    </div>

    <div class="card">
      <h3 class="card-title">${t('data_section')}</h3>
      <div class="action-grid">
        <button class="btn btn-outline" data-action="export">${t('export_settings')}</button>
        <button class="btn btn-outline" data-action="import">${t('import_settings')}</button>
        <button class="btn btn-outline" data-action="backup">${t('backup_settings')}</button>
        <button class="btn btn-outline" data-action="clear-log">${t('clear_log')}</button>
      </div>
      <input type="file" accept="application/json" data-file-input class="hidden" />
      <p class="form-status" data-form-status></p>
    </div>

    <div class="card">
      <h3 class="card-title">${t('about_section')}</h3>
      <p class="about-text">${t('about_text')}</p>
      <button class="btn btn-danger-outline btn-sm" data-action="clear-data">${t('clear_data')}</button>
    </div>
  `;

  container.querySelector('[data-setting="theme"]').addEventListener('change', (e) => {
    setRaw(THEME_KEY, e.target.value);
    applyTheme(e.target.value);
  });
  container.querySelector('[data-setting="lang"]').addEventListener('change', (e) => {
    setLang(e.target.value);
    window.location.reload();
  });
  container.querySelector('[data-setting="interval"]').addEventListener('change', (e) => {
    setRefreshInterval(Number(e.target.value));
  });
  container.querySelector('[data-setting="baseUrl"]').addEventListener('change', (e) => {
    setBaseUrl(e.target.value.trim());
    setStatus(t('success'));
  });
  container.querySelector('[data-action="request-notifications"]').addEventListener('click', async (e) => {
    const perm = await requestPermission();
    e.target.textContent = perm === 'granted' ? '✓' : t('notifications_blocked');
  });
  container.querySelector('[data-action="export"]').addEventListener('click', exportSettings);
  container.querySelector('[data-action="backup"]').addEventListener('click', exportSettings);
  container.querySelector('[data-action="import"]').addEventListener('click', () => {
    container.querySelector('[data-file-input]').click();
  });
  container.querySelector('[data-file-input]').addEventListener('change', importSettings);
  container.querySelector('[data-action="clear-log"]').addEventListener('click', () => {
    clearLog();
    setStatus(t('success'));
  });
  container.querySelector('[data-action="clear-data"]').addEventListener('click', () => {
    if (window.confirm(t('clear_data_confirm'))) {
      clearAll();
      window.location.reload();
    }
  });
}

function setStatus(msg) {
  const el = container?.querySelector('[data-form-status]');
  if (el) el.textContent = msg;
}

function exportSettings() {
  const dump = {};
  allKeys().forEach((k) => {
    try {
      dump[k] = JSON.parse(getRaw(k));
    } catch {
      dump[k] = getRaw(k);
    }
  });
  dump._notificationLogSnapshot = getLog();
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `router-dashboard-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus(t('export_success'));
}

function importSettings(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      Object.entries(data).forEach(([k, v]) => {
        if (k === '_notificationLogSnapshot') return;
        setRaw(k, typeof v === 'string' ? v : JSON.stringify(v));
      });
      setStatus(t('import_success'));
      setTimeout(() => window.location.reload(), 800);
    } catch {
      setStatus(t('import_error'));
    }
  };
  reader.readAsText(file);
}
