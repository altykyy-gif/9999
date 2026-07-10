/**
 * devices.js
 * صفحة الأجهزة المتصلة: عرض القائمة (الاسم/IP/MAC) وإمكانية الحظر/السماح إن
 * كان الراوتر يدعم ذلك.
 */

import * as api from './api.js';
import { t } from './i18n.js';

let container = null;

export function render(el) {
  container = el;
  container.innerHTML = `
    <div class="card">
      <h3 class="card-title">${t('devices_title')}</h3>
      <div class="device-list" data-list="devices">
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
      </div>
    </div>
  `;
  refresh();
}

function deviceRow(host) {
  const mac = host.MacAddress || '';
  const blocked = host.MacFilterStatus === '1' || host.Blacklist === '1';
  return `
    <div class="device-row" data-mac="${mac}">
      <div class="device-info">
        <span class="device-name">${host.HostName || t('not_available')}</span>
        <span class="device-sub">${host.IpAddress || '—'} · ${mac || '—'}</span>
      </div>
      <button class="btn btn-sm ${blocked ? 'btn-outline' : 'btn-danger-outline'}" data-block-toggle="${mac}" data-blocked="${blocked}">
        ${blocked ? t('allow_device') : t('block_device')}
      </button>
    </div>`;
}

export async function refresh() {
  if (!container) return;
  const hosts = await api.getHostList();
  const list = container.querySelector('[data-list="devices"]');
  if (!list) return;

  if (!hosts) {
    list.innerHTML = `<p class="empty-state">${t('unsupported')}</p>`;
    return;
  }
  if (hosts.length === 0) {
    list.innerHTML = `<p class="empty-state">${t('no_devices')}</p>`;
    return;
  }

  list.innerHTML = hosts.map(deviceRow).join('');
  list.querySelectorAll('[data-block-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => onToggleBlock(btn));
  });
}

async function onToggleBlock(btn) {
  const mac = btn.dataset.blockToggle;
  const currentlyBlocked = btn.dataset.blocked === 'true';
  btn.disabled = true;
  const res = await api.setDeviceBlocked(mac, !currentlyBlocked);
  btn.disabled = false;
  if (res === null) {
    btn.textContent = t('unsupported_short');
    return;
  }
  refresh();
}
