/**
 * dashboard.js
 * الصفحة الرئيسية: مقياس الإشارة (العنصر المميّز)، بطاقات الحالة، الرسوم
 * البيانية اللحظية، وإطلاق التنبيهات عند تجاوز العتبات المطلوبة.
 */

import * as api from './api.js';
import { t } from './i18n.js';
import { notify, createThresholdWatcher } from './notifications.js';
import { DataHistory, RealtimeChart } from './charts.js';
import { getJSON, setJSON } from './storage.js';

let container = null;
let timerId = null;
let manualPending = false;
let charts = {};
let histories = {};
const watcher = createThresholdWatcher();

const REFRESH_KEY = 'refreshIntervalMs';
const DEFAULT_INTERVAL = 1000;

export function getRefreshInterval() {
  return getJSON(REFRESH_KEY, DEFAULT_INTERVAL);
}
export function setRefreshInterval(ms) {
  setJSON(REFRESH_KEY, ms);
  if (timerId) restartAutoRefresh();
}

/* ------------------------------- الهيكل الثابت ------------------------------ */

function fieldRow(key, labelKey, opts = {}) {
  return `
    <div class="stat" data-field-wrap="${key}">
      <span class="stat-label">${t(labelKey)}</span>
      <span class="stat-value" data-field="${key}">—</span>
      ${opts.badge ? `<span class="stat-badge" data-field-badge="${key}"></span>` : ''}
    </div>`;
}

export function render(el) {
  container = el;
  container.innerHTML = `
    <div class="dash-hero card">
      <div class="gauge-wrap">
        <svg viewBox="0 0 200 120" class="gauge-svg" aria-hidden="true">
          <path d="M20,110 A80,80 0 0 1 180,110" class="gauge-track" />
          <path d="M20,110 A80,80 0 0 1 180,110" class="gauge-fill" data-gauge-fill pathLength="100" />
        </svg>
        <div class="gauge-center">
          <span class="gauge-value" data-field="rsrpGauge">—</span>
          <span class="gauge-unit">dBm · RSRP</span>
          <span class="gauge-quality" data-field="signalQuality">${t('status_unknown')}</span>
        </div>
      </div>
      <div class="hero-meta">
        <div class="conn-status">
          <span class="dot" data-field-dot="connStatus"></span>
          <span data-field="connStatus">${t('status_unknown')}</span>
        </div>
        <div class="hero-net">
          <span data-field="networkType">—</span>
          <span class="sep">·</span>
          <span data-field="operator">—</span>
        </div>
        <button class="btn btn-ghost btn-sm" data-action="manual-refresh">
          ↻ ${t('manual_refresh')}
        </button>
      </div>
    </div>

    <div class="grid-cards">
      <div class="card" data-group="speed">
        <h3 class="card-title">${t('download_speed')} / ${t('upload_speed')}</h3>
        <div class="stat-row">
          ${fieldRow('downloadSpeed', 'download_speed')}
          ${fieldRow('uploadSpeed', 'upload_speed')}
          ${fieldRow('ping', 'ping')}
        </div>
      </div>

      <div class="card" data-group="battery">
        <h3 class="card-title">${t('battery')}</h3>
        <div class="stat-row">
          ${fieldRow('batteryPercent', 'battery')}
          ${fieldRow('batteryState', 'battery_charging')}
          ${fieldRow('chargerState', 'charger_status')}
        </div>
      </div>

      <div class="card" data-group="signal-detail">
        <h3 class="card-title">${t('signal_strength')}</h3>
        <div class="stat-row">
          ${fieldRow('rssi', 'rssi')}
          ${fieldRow('rsrq', 'rsrq')}
          ${fieldRow('sinr', 'sinr')}
          ${fieldRow('pci', 'pci')}
          ${fieldRow('cellId', 'cell_id')}
          ${fieldRow('enbId', 'enb_id')}
          ${fieldRow('earfcn', 'earfcn')}
          ${fieldRow('band', 'band')}
        </div>
      </div>

      <div class="card" data-group="network">
        <h3 class="card-title">${t('network_info_title')}</h3>
        <div class="stat-row">
          ${fieldRow('internalIp', 'internal_ip')}
          ${fieldRow('externalIp', 'external_ip')}
          ${fieldRow('connDuration', 'connection_duration')}
          ${fieldRow('dailyUsage', 'daily_usage')}
          ${fieldRow('monthlyUsage', 'monthly_usage')}
        </div>
      </div>

      <div class="card" data-group="device">
        <h3 class="card-title">${t('nav_devices')}</h3>
        <div class="stat-row">
          ${fieldRow('deviceCount', 'connected_devices')}
          ${fieldRow('macAddress', 'mac_address')}
          ${fieldRow('imei', 'imei')}
          ${fieldRow('imsi', 'imsi')}
          ${fieldRow('firmware', 'firmware_version')}
          ${fieldRow('temperature', 'device_temperature')}
        </div>
      </div>
    </div>

    <div class="card charts-card">
      <h3 class="card-title">${t('live_charts')}</h3>
      <div class="charts-grid">
        <div class="chart-block">
          <span class="chart-label">${t('chart_download')}</span>
          <canvas class="chart-canvas" data-chart="download"></canvas>
        </div>
        <div class="chart-block">
          <span class="chart-label">${t('chart_upload')}</span>
          <canvas class="chart-canvas" data-chart="upload"></canvas>
        </div>
        <div class="chart-block">
          <span class="chart-label">${t('chart_signal')}</span>
          <canvas class="chart-canvas" data-chart="signal"></canvas>
        </div>
        <div class="chart-block">
          <span class="chart-label">${t('chart_usage')}</span>
          <canvas class="chart-canvas" data-chart="usage"></canvas>
        </div>
      </div>
    </div>

    <div class="last-updated" data-field="lastUpdated"></div>
  `;

  container.querySelector('[data-action="manual-refresh"]').addEventListener('click', () => refresh(true));

  charts.download = new RealtimeChart(container.querySelector('[data-chart="download"]'), { color: '#16d9c4' });
  charts.upload = new RealtimeChart(container.querySelector('[data-chart="upload"]'), { color: '#f5a83c' });
  charts.signal = new RealtimeChart(container.querySelector('[data-chart="signal"]'), { color: '#3add8b', maxY: 100 });
  charts.usage = new RealtimeChart(container.querySelector('[data-chart="usage"]'), { color: '#8c9aff' });

  histories.download = new DataHistory('download');
  histories.upload = new DataHistory('upload');
  histories.signal = new DataHistory('signal');
  histories.usage = new DataHistory('usage');
}

/* --------------------------------- مساعدات --------------------------------- */

function setField(key, value) {
  const el = container?.querySelector(`[data-field="${key}"]`);
  if (el) el.textContent = value ?? '—';
}

function markUnsupported(groupKey) {
  const wrap = container?.querySelector(`[data-field-wrap="${groupKey}"]`);
  if (wrap) {
    wrap.classList.add('is-unsupported');
    const val = wrap.querySelector('[data-field]');
    if (val) val.textContent = t('unsupported_short');
  }
}

function fmtBytes(bytes) {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return '—';
  const n = Number(bytes);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function fmtSpeed(bytesPerSec) {
  if (bytesPerSec === undefined || bytesPerSec === null || isNaN(bytesPerSec)) return '—';
  return `${fmtBytes(bytesPerSec)}/s`;
}

function fmtDuration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  return h > 0 ? `${h}${t('hours')} ${m}${t('minutes')}` : `${m}${t('minutes')} ${ss}${t('seconds')}`;
}

function signalQualityFromRsrp(rsrp) {
  const v = Number(rsrp);
  if (!Number.isFinite(v)) return { key: 'status_unknown', pct: 0 };
  if (v >= -80) return { key: 'signal_excellent', pct: 95 };
  if (v >= -95) return { key: 'signal_good', pct: 70 };
  if (v >= -105) return { key: 'signal_fair', pct: 40 };
  return { key: 'signal_weak', pct: 15 };
}

function updateGauge(rsrp) {
  const fillPath = container.querySelector('[data-gauge-fill]');
  const q = signalQualityFromRsrp(rsrp);
  setField('rsrpGauge', Number.isFinite(Number(rsrp)) ? Math.round(Number(rsrp)) : '—');
  setField('signalQuality', t(q.key));
  if (fillPath) {
    fillPath.style.strokeDasharray = '100';
    fillPath.style.strokeDashoffset = String(100 - q.pct);
    fillPath.setAttribute('data-quality', q.key.replace('signal_', ''));
  }
  return q.pct;
}

/* ---------------------------------- التحديث --------------------------------- */

export async function refresh(isManual = false) {
  if (!container) return;
  if (manualPending) return;
  manualPending = true;

  const t0 = performance.now();
  try {
    const [status, traffic, monthStats, signal, plmn, deviceInfo, hosts] = await Promise.all([
      api.getMonitoringStatus(),
      api.getTrafficStatistics(),
      api.getMonthStatistics(),
      api.getSignalInfo(),
      api.getCurrentPlmn(),
      api.getDeviceInfo(),
      api.getHostList(),
    ]);
    const pingMs = Math.round(performance.now() - t0);
    applyData({ status, traffic, monthStats, signal, plmn, deviceInfo, hosts, pingMs });
  } catch (err) {
    if (err.code === 'NETWORK') {
      setField('connStatus', t('error_network'));
      const dot = container.querySelector('[data-field-dot="connStatus"]');
      if (dot) dot.setAttribute('data-state', 'down');
    }
  } finally {
    manualPending = false;
    const stamp = new Date().toLocaleTimeString();
    setField('lastUpdated', `${t('last_updated')}: ${stamp}`);
  }
}

let wasOnline = null;

function applyData({ status, traffic, monthStats, signal, plmn, deviceInfo, hosts, pingMs }) {
  // حالة الاتصال
  const connected = status?.ConnectionStatus === '901' || status?.ConnectionStatus === '900';
  setField('connStatus', connected ? t('status_connected') : t('status_disconnected'));
  const dot = container.querySelector('[data-field-dot="connStatus"]');
  if (dot) dot.setAttribute('data-state', connected ? 'up' : 'down');

  watcher('internet', !connected, () => notify('alert_internet_down'));
  if (wasOnline === false && connected) notify('alert_internet_up');
  wasOnline = connected;

  setField('networkType', status?.CurrentNetworkTypeEx || status?.CurrentNetworkType || '—');
  setField('operator', plmn?.FullName || plmn?.ShortName || '—');

  // السرعات
  const dl = Number(traffic?.CurrentDownloadRate);
  const ul = Number(traffic?.CurrentUploadRate);
  setField('downloadSpeed', fmtSpeed(dl));
  setField('uploadSpeed', fmtSpeed(ul));
  setField('ping', Number.isFinite(pingMs) ? `${pingMs} ms` : '—');
  if (Number.isFinite(dl)) {
    histories.download.push(dl);
    charts.download.render(histories.download.recent(), t('chart_no_data'));
  }
  if (Number.isFinite(ul)) {
    histories.upload.push(ul);
    charts.upload.render(histories.upload.recent(), t('chart_no_data'));
  }

  // البطارية
  if (status?.BatteryPercent !== undefined && status?.BatteryPercent !== '') {
    const pct = Number(status.BatteryPercent);
    setField('batteryPercent', `${pct}%`);
    const charging = status?.BatteryStatus === '1' || status?.BatteryStatus === 1;
    setField('batteryState', charging ? t('battery_charging') : t('battery_not_charging'));
    setField('chargerState', charging ? t('charger_connected') : t('charger_disconnected'));
    watcher('batteryFull', pct >= 100, () => notify('alert_battery_full'));
    watcher('batteryLow', pct <= 25, () => notify('alert_battery_low'));
  } else {
    markUnsupported('batteryPercent');
    markUnsupported('batteryState');
    markUnsupported('chargerState');
  }

  // تفاصيل الإشارة
  if (signal) {
    setField('rssi', signal.rssi ? `${signal.rssi} dBm` : '—');
    setField('rsrq', signal.rsrq ? `${signal.rsrq} dB` : '—');
    setField('sinr', signal.sinr ? `${signal.sinr} dB` : '—');
    setField('pci', signal.pci ?? '—');
    setField('cellId', signal.cell_id ?? '—');
    setField('earfcn', signal.earfcn ?? signal.dl_earfcn ?? '—');
    setField('band', signal.band ?? '—');
    const enb = api.deriveEnbId(signal.cell_id);
    setField('enbId', enb ? enb.enbId : '—');

    const rsrpVal = Number(signal.rsrp);
    const pct = updateGauge(signal.rsrp);
    watcher('weakSignal', Number.isFinite(rsrpVal) && rsrpVal < -105, () => notify('alert_signal_weak'));
    if (Number.isFinite(pct)) {
      histories.signal.push(pct);
      charts.signal.render(histories.signal.recent(), t('chart_no_data'));
    }
  } else {
    ['rssi', 'rsrq', 'sinr', 'pci', 'cellId', 'enbId', 'earfcn', 'band'].forEach(markUnsupported);
    updateGauge(null);
  }

  // الشبكة
  setField('internalIp', deviceInfo?.WanIPAddress ?? status?.PrimaryDns ?? '—');
  setField('externalIp', status?.wanIPAddress ?? '—');
  setField('connDuration', fmtDuration(traffic?.CurrentConnectTime));

  if (monthStats?.CurrentDayUsed !== undefined) {
    setField('dailyUsage', fmtBytes(monthStats.CurrentDayUsed));
    setField('monthlyUsage', fmtBytes(monthStats.CurrentMonthDownload && monthStats.CurrentMonthUpload
      ? Number(monthStats.CurrentMonthDownload) + Number(monthStats.CurrentMonthUpload)
      : monthStats.CurrentMonthDownload));
    const usageVal = Number(monthStats.CurrentDayUsed);
    if (Number.isFinite(usageVal)) {
      histories.usage.push(usageVal);
      charts.usage.render(histories.usage.recent(), t('chart_no_data'));
    }
  } else {
    markUnsupported('dailyUsage');
    markUnsupported('monthlyUsage');
  }

  // الأجهزة
  setField('deviceCount', Array.isArray(hosts) ? `${hosts.length} ${t('device_count')}` : '—');
  setField('macAddress', deviceInfo?.MacAddress1 ?? deviceInfo?.WifiMacAddrWl0 ?? '—');
  setField('imei', deviceInfo?.Imei ?? '—');
  setField('imsi', deviceInfo?.Imsi ?? '—');
  setField('firmware', deviceInfo?.SoftwareVersion ?? '—');
  if (deviceInfo?.DeviceTemperature !== undefined) {
    const temp = Number(deviceInfo.DeviceTemperature);
    setField('temperature', `${temp}°C`);
    watcher('highTemp', temp >= 60, () => notify('alert_high_temp'));
  } else {
    markUnsupported('temperature');
  }
}

/* ------------------------------ التحديث التلقائي ----------------------------- */

export function startAutoRefresh() {
  stopAutoRefresh();
  refresh();
  timerId = setInterval(refresh, getRefreshInterval());
}

export function stopAutoRefresh() {
  if (timerId) clearInterval(timerId);
  timerId = null;
}

function restartAutoRefresh() {
  if (timerId) startAutoRefresh();
}

export function destroy() {
  stopAutoRefresh();
  Object.values(charts).forEach((c) => c.destroy());
  charts = {};
}
