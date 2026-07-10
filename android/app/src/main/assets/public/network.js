/**
 * network.js
 * صفحة الشبكة: عرض تفصيلي لكل معلومات الشبكة، اختيار وضع الشبكة، وإجراءات
 * التحكم (إعادة اتصال / قطع / إعادة تشغيل / إيقاف تشغيل).
 */

import * as api from './api.js';
import { t } from './i18n.js';
import { notify } from './notifications.js';

let container = null;

function infoRow(labelKey, value) {
  return `<div class="info-row"><span class="info-label">${t(labelKey)}</span><span class="info-value">${value ?? '—'}</span></div>`;
}

export function render(el) {
  container = el;
  container.innerHTML = `
    <div class="card">
      <h3 class="card-title">${t('network_info_title')}</h3>
      <div class="info-list" data-list="network-info">
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">${t('network_mode')}</h3>
      <div class="segmented" data-group="mode-select">
        <button class="segmented-btn" data-mode="00">${t('mode_auto')}</button>
        <button class="segmented-btn" data-mode="03">${t('mode_4g_only')}</button>
        <button class="segmented-btn" data-mode="09">${t('mode_5g_only')}</button>
      </div>
      <p class="hint" data-mode-hint></p>
    </div>

    <div class="card">
      <h3 class="card-title">${t('network_actions')}</h3>
      <div class="action-grid">
        <button class="btn" data-action="reconnect">${t('reconnect')}</button>
        <button class="btn btn-outline" data-action="disconnect">${t('disconnect')}</button>
        <button class="btn btn-outline" data-action="reboot">${t('reboot_router')}</button>
        <button class="btn btn-danger" data-action="poweroff">${t('power_off')}</button>
      </div>
      <p class="action-status" data-action-status></p>
    </div>
  `;

  container.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  container.querySelector('[data-action="reconnect"]').addEventListener('click', doReconnect);
  container.querySelector('[data-action="disconnect"]').addEventListener('click', () => confirmThen('confirm_disconnect', doDisconnect));
  container.querySelector('[data-action="reboot"]').addEventListener('click', () => confirmThen('confirm_reboot', doReboot));
  container.querySelector('[data-action="poweroff"]').addEventListener('click', () => confirmThen('confirm_poweroff', doPowerOff));

  refresh();
}

function confirmThen(messageKey, fn) {
  if (window.confirm(t(messageKey))) fn();
}

function setActionStatus(msg) {
  const el = container?.querySelector('[data-action-status]');
  if (el) el.textContent = msg;
}

async function doReconnect() {
  setActionStatus(t('action_in_progress'));
  const res = await api.dialConnect();
  setActionStatus(res === null ? t('unsupported') : t('success'));
  setTimeout(refresh, 1500);
}
async function doDisconnect() {
  setActionStatus(t('action_in_progress'));
  const res = await api.dialDisconnect();
  setActionStatus(res === null ? t('unsupported') : t('success'));
  setTimeout(refresh, 1500);
}
async function doReboot() {
  setActionStatus(t('action_in_progress'));
  const res = await api.rebootDevice();
  setActionStatus(res === null ? t('unsupported') : t('success'));
}
async function doPowerOff() {
  setActionStatus(t('action_in_progress'));
  const res = await api.powerOffDevice();
  setActionStatus(res === null ? t('unsupported') : t('success'));
}

async function setMode(mode) {
  container.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  const res = await api.setNetMode(mode);
  const hint = container.querySelector('[data-mode-hint]');
  if (hint) hint.textContent = res === null ? t('unsupported') : '';
  if (res !== null) notify('success', '', 'net-mode');
  setTimeout(refresh, 1000);
}

export async function refresh() {
  if (!container) return;
  const [status, signal, plmn, netMode, deviceInfo] = await Promise.all([
    api.getMonitoringStatus(),
    api.getSignalInfo(),
    api.getCurrentPlmn(),
    api.getNetMode(),
    api.getDeviceInfo(),
  ]);

  const list = container.querySelector('[data-list="network-info"]');
  if (list) {
    const enb = api.deriveEnbId(signal?.cell_id);
    list.innerHTML = [
      infoRow('connection_status', status?.ConnectionStatus === '901' ? t('status_connected') : t('status_disconnected')),
      infoRow('network_type', status?.CurrentNetworkTypeEx || status?.CurrentNetworkType),
      infoRow('operator', plmn?.FullName || plmn?.ShortName),
      infoRow('signal_strength', status?.SignalStrength ? `${status.SignalStrength}/5` : null),
      infoRow('rssi', signal?.rssi ? `${signal.rssi} dBm` : null),
      infoRow('rsrp', signal?.rsrp ? `${signal.rsrp} dBm` : null),
      infoRow('rsrq', signal?.rsrq ? `${signal.rsrq} dB` : null),
      infoRow('sinr', signal?.sinr ? `${signal.sinr} dB` : null),
      infoRow('pci', signal?.pci),
      infoRow('cell_id', signal?.cell_id),
      infoRow('enb_id', enb ? enb.enbId : null),
      infoRow('earfcn', signal?.earfcn ?? signal?.dl_earfcn),
      infoRow('band', signal?.band),
      infoRow('internal_ip', deviceInfo?.WanIPAddress),
      infoRow('external_ip', status?.wanIPAddress),
      infoRow('mac_address', deviceInfo?.MacAddress1),
      infoRow('firmware_version', deviceInfo?.SoftwareVersion),
    ].join('');
  }

  if (netMode) {
    container.querySelectorAll('[data-mode]').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === netMode.NetworkMode);
    });
  }
}
