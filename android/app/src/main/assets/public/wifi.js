/**
 * wifi.js
 * صفحة إعدادات الواي فاي: تعديل الاسم/كلمة المرور/القناة/التشفير، تشغيل
 * وإيقاف الشبكة، وعرض رمز QR للاتصال السريع (باستخدام qrcode-lib.js المحلي).
 */

import * as api from './api.js';
import { t } from './i18n.js';
import { notify } from './notifications.js';
import { drawQRCode } from './qrcode-lib.js';

let container = null;
let currentSettings = {};

export function render(el) {
  container = el;
  container.innerHTML = `
    <div class="card">
      <div class="card-title-row">
        <h3 class="card-title">${t('wifi_settings_title')}</h3>
        <label class="switch">
          <input type="checkbox" data-field="wifiToggle" />
          <span class="switch-track"></span>
        </label>
      </div>

      <form data-form="wifi">
        <label class="field">
          <span>${t('ssid_label')}</span>
          <input type="text" name="ssid" maxlength="32" required />
        </label>
        <label class="field">
          <span>${t('wifi_password_label')}</span>
          <div class="password-field">
            <input type="password" name="password" minlength="8" maxlength="63" />
            <button type="button" class="icon-btn" data-action="toggle-password">👁</button>
          </div>
          <small class="hint">${t('wifi_password_hint')}</small>
        </label>
        <div class="field-grid">
          <label class="field">
            <span>${t('channel_label')}</span>
            <select name="channel">
              <option value="0">${t('channel_auto')}</option>
              ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((c) => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>${t('channel_width_label')}</span>
            <select name="channelWidth">
              <option value="0">20MHz</option>
              <option value="1">40MHz</option>
            </select>
          </label>
        </div>
        <label class="field">
          <span>${t('encryption_label')}</span>
          <select name="encryption">
            <option value="wpa2psk">WPA2-PSK</option>
            <option value="wpawpa2psk">WPA/WPA2-PSK</option>
            <option value="wpa3psk">WPA3-PSK</option>
            <option value="open">${t('off')}</option>
          </select>
        </label>
        <div class="form-actions">
          <button type="submit" class="btn">${t('save_wifi_settings')}</button>
          <button type="button" class="btn btn-outline" data-action="show-qr">${t('show_qr')}</button>
        </div>
        <p class="form-status" data-form-status></p>
      </form>
    </div>

    <div class="card qr-card hidden" data-block="qr">
      <h3 class="card-title">${t('qr_title')}</h3>
      <canvas class="qr-canvas" data-qr-canvas></canvas>
      <p class="qr-ssid" data-qr-ssid></p>
    </div>
  `;

  container.querySelector('[data-form="wifi"]').addEventListener('submit', onSubmit);
  container.querySelector('[data-action="toggle-password"]').addEventListener('click', togglePasswordVisibility);
  container.querySelector('[data-action="show-qr"]').addEventListener('click', showQr);
  container.querySelector('[data-field="wifiToggle"]').addEventListener('change', onToggleWifi);

  refresh();
}

function togglePasswordVisibility() {
  const input = container.querySelector('input[name="password"]');
  input.type = input.type === 'password' ? 'text' : 'password';
}

function setStatus(msg) {
  const el = container?.querySelector('[data-form-status]');
  if (el) el.textContent = msg;
}

async function onToggleWifi(e) {
  const enabled = e.target.checked;
  const res = await api.setWifiToggle(enabled);
  if (res === null) {
    setStatus(t('unsupported'));
    e.target.checked = !enabled;
  }
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const ssid = form.elements.ssid.value.trim();
  const password = form.elements.password.value;
  const channel = form.elements.channel.value;
  const channelWidth = form.elements.channelWidth.value;
  const encryption = form.elements.encryption.value;

  setStatus(t('action_in_progress'));

  const basicRes = await api.setWlanBasicSettings({
    WifiSsid: ssid,
    WifiChannel: channel,
    WifiBandwidth: channelWidth,
  });

  let secRes = null;
  if (password) {
    secRes = await api.setWlanSecuritySettings({
      WifiAuthmode: encryption === 'open' ? 'OPEN' : 'WPA2PSK',
      WifiWpapsk: password,
      WifiBasicEncryptionModes: encryption.toUpperCase(),
    });
  }

  if (basicRes === null && secRes === null) {
    setStatus(t('unsupported'));
  } else {
    setStatus(t('wifi_save_success'));
    notify('wifi_save_success', '', 'wifi-save');
    currentSettings.ssid = ssid;
    currentSettings.password = password || currentSettings.password;
  }
}

function showQr() {
  const block = container.querySelector('[data-block="qr"]');
  block.classList.remove('hidden');
  const ssid = currentSettings.ssid || container.querySelector('input[name="ssid"]').value;
  const password = currentSettings.password || container.querySelector('input[name="password"]').value;
  const authRaw = container.querySelector('select[name="encryption"]').value;
  const wifiType = authRaw === 'open' ? 'nopass' : 'WPA';

  const esc = (s) => String(s || '').replace(/([\\;,":])/g, '\\$1');
  const payload = `WIFI:T:${wifiType};S:${esc(ssid)};P:${wifiType === 'nopass' ? '' : esc(password)};;`;

  const canvas = container.querySelector('[data-qr-canvas]');
  try {
    drawQRCode(canvas, payload, { scale: 6, margin: 3 });
  } catch (err) {
    setStatus(t('error_generic'));
  }
  container.querySelector('[data-qr-ssid]').textContent = ssid;
  block.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
}

export async function refresh() {
  if (!container) return;
  const [basic, security] = await Promise.all([api.getWlanBasicSettings(), api.getWlanSecuritySettings()]);

  if (basic) {
    const form = container.querySelector('[data-form="wifi"]');
    if (basic.WifiSsid) form.elements.ssid.value = basic.WifiSsid;
    if (basic.WifiChannel) form.elements.channel.value = basic.WifiChannel;
    if (basic.WifiBandwidth) form.elements.channelWidth.value = basic.WifiBandwidth;
    currentSettings.ssid = basic.WifiSsid;
    const toggle = container.querySelector('[data-field="wifiToggle"]');
    if (toggle && basic.WifiEnable !== undefined) toggle.checked = basic.WifiEnable === '1';
  } else {
    setStatus(t('unsupported'));
  }

  if (security?.WifiAuthmode) {
    const sel = container.querySelector('select[name="encryption"]');
    const map = { WPA2PSK: 'wpa2psk', WPAWPA2PSK: 'wpawpa2psk', WPA3PSK: 'wpa3psk', OPEN: 'open' };
    sel.value = map[security.WifiAuthmode] || 'wpa2psk';
  }
}
