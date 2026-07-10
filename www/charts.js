/**
 * charts.js
 * رسوم بيانية لحظية (Canvas بدون أي مكتبة خارجية) + سجل احتفاظ بآخر 24 ساعة
 * من القراءات مخزّن في LocalStorage، بأسلوب "شاشة راسم الإشارة" يلائم طبيعة
 * البيانات (سرعة، إشارة).
 */

import { getJSON, setJSON } from './storage.js';

const HISTORY_PREFIX = 'history:';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_POINTS = 2000; // سقف أمان لحجم التخزين حتى مع تحديث كل ثانية

export class DataHistory {
  constructor(key) {
    this.key = HISTORY_PREFIX + key;
    this.points = getJSON(this.key, []);
    this._prune();
  }

  push(value, timestamp = Date.now()) {
    this.points.push({ t: timestamp, v: value });
    if (this.points.length > MAX_POINTS) {
      this.points.splice(0, this.points.length - MAX_POINTS);
    }
    this._prune();
    setJSON(this.key, this.points);
  }

  _prune() {
    const cutoff = Date.now() - MAX_AGE_MS;
    let i = 0;
    while (i < this.points.length && this.points[i].t < cutoff) i++;
    if (i > 0) this.points.splice(0, i);
  }

  /** آخر نافذة زمنية (بالمللي ثانية)، افتراضيًا كل الـ24 ساعة المحفوظة */
  recent(windowMs = MAX_AGE_MS) {
    const cutoff = Date.now() - windowMs;
    return this.points.filter((p) => p.t >= cutoff);
  }

  clear() {
    this.points = [];
    setJSON(this.key, this.points);
  }
}

/** رسم خط بسيط بأسلوب "شاشة راسم الإشارة" داخل Canvas */
export class RealtimeChart {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{color?:string, gridColor?:string, fill?:boolean, unit?:string, maxY?:number}} opts
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.color = opts.color || '#16d9c4';
    this.gridColor = opts.gridColor || 'rgba(140,160,172,0.15)';
    this.fill = opts.fill !== false;
    this.unit = opts.unit || '';
    this.maxYOverride = opts.maxY ?? null;
    this._dpr = window.devicePixelRatio || 1;
    this._resizeObserver = new ResizeObserver(() => this._syncSize());
    this._resizeObserver.observe(canvas);
    this._syncSize();
  }

  _syncSize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.canvas.width = Math.round(rect.width * this._dpr);
    this.canvas.height = Math.round(rect.height * this._dpr);
  }

  destroy() {
    this._resizeObserver.disconnect();
  }

  /** points: [{t, v}], noDataLabel: نص يظهر إن لم توجد بيانات كافية */
  render(points, noDataLabel = '') {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!points || points.length < 2) {
      if (noDataLabel) {
        ctx.fillStyle = this.gridColor;
        ctx.font = `${13 * this._dpr}px "IBM Plex Sans Arabic", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(noDataLabel, w / 2, h / 2);
      }
      return;
    }

    const padding = 8 * this._dpr;
    const values = points.map((p) => p.v);
    const minV = 0;
    const maxV = this.maxYOverride ?? Math.max(...values, 1) * 1.15;
    const minT = points[0].t;
    const maxT = points[points.length - 1].t;
    const spanT = Math.max(maxT - minT, 1);

    const xFor = (t) => padding + ((t - minT) / spanT) * (w - padding * 2);
    const yFor = (v) => h - padding - ((v - minV) / (maxV - minV || 1)) * (h - padding * 2);

    // شبكة أفقية خفيفة (4 خطوط)
    ctx.strokeStyle = this.gridColor;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = padding + ((h - padding * 2) * i) / 3;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(w - padding, y);
      ctx.stroke();
    }

    // مسار الخط
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xFor(p.t);
      const y = yFor(p.v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    if (this.fill) {
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, this._withAlpha(this.color, 0.28));
      gradient.addColorStop(1, this._withAlpha(this.color, 0));
      ctx.save();
      ctx.lineTo(xFor(points[points.length - 1].t), h - padding);
      ctx.lineTo(xFor(points[0].t), h - padding);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.restore();
      // إعادة رسم الخط فوق التعبئة
      ctx.beginPath();
      points.forEach((p, i) => {
        const x = xFor(p.t);
        const y = yFor(p.v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
    }

    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2 * this._dpr;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = this._withAlpha(this.color, 0.6);
    ctx.shadowBlur = 6 * this._dpr;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // آخر نقطة كنقطة مضيئة
    const last = points[points.length - 1];
    ctx.beginPath();
    ctx.fillStyle = this.color;
    ctx.arc(xFor(last.t), yFor(last.v), 3 * this._dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  _withAlpha(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
}
