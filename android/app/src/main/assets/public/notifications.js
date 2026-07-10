/**
 * notifications.js
 * تنبيهات المتصفح + سجل محلي للإشعارات. الوحدات الأخرى (dashboard.js, sms.js,
 * network.js...) تستدعي notify() عند اكتشاف حدث يستحق تنبيهًا؛ هذه الوحدة لا
 * تراقب البيانات بنفسها، فقط تعرض/تُسجّل ما يُطلب منها.
 */

import { getJSON, setJSON } from './storage.js';
import { t } from './i18n.js';

const LOG_KEY = 'notificationLog';
const MAX_LOG = 200;

/**
 * عند التشغيل داخل تطبيق أندرويد (Capacitor) بدل المتصفح، تُستخدم إشعارات
 * النظام الحقيقية عبر @capacitor/local-notifications، لأن Web Notification
 * API غير مدعومة (أو غير موثوقة) داخل WebView. الكشف يتم عبر الكائن العام
 * window.Capacitor الذي يُضيفه غلاف التطبيق تلقائيًا عند التشغيل كتطبيق أصلي.
 */
function isNativeApp() {
  return !!window.Capacitor?.isNativePlatform?.();
}

function nativePlugin() {
  return window.Capacitor?.Plugins?.LocalNotifications ?? null;
}

export function getPermissionState() {
  if (isNativeApp()) return '_native'; // يُتحقق فعليًا بشكل غير متزامن عند الحاجة عبر requestPermission
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'granted' | 'denied' | 'default'
}

export async function requestPermission() {
  if (isNativeApp()) {
    const plugin = nativePlugin();
    if (!plugin) return 'unsupported';
    try {
      const res = await plugin.requestPermissions();
      return res?.display === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'denied';
    }
  }
  if (!('Notification' in window)) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function readLog() {
  return getJSON(LOG_KEY, []);
}

function writeLog(entries) {
  setJSON(LOG_KEY, entries.slice(0, MAX_LOG));
}

export function getLog() {
  return readLog();
}

export function clearLog() {
  writeLog([]);
}

/**
 * يسجّل إشعارًا في السجل، ويعرضه كإشعار متصفح حقيقي إن كان مسموحًا.
 * @param {string} titleKey مفتاح ترجمة للعنوان
 * @param {string} [body] نص إضافي اختياري (لا يُترجم تلقائيًا)
 * @param {string} [tag] لتقليل تكرار نفس نوع الإشعار خلال فترة قصيرة
 */
export function notify(titleKey, body = '', tag = titleKey) {
  const title = t(titleKey);
  const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, titleKey, title, body, tag, at: Date.now() };
  const log = readLog();
  log.unshift(entry);
  writeLog(log);

  if (isNativeApp()) {
    const plugin = nativePlugin();
    if (plugin) {
      // معرّف رقمي مستقر من الطابع الزمني (تتطلبه واجهة الإشعارات الأصلية)
      const numericId = Number(String(Date.now()).slice(-9));
      plugin
        .schedule({ notifications: [{ id: numericId, title, body, schedule: { at: new Date() } }] })
        .catch((err) => console.warn('[notifications] تعذر عرض إشعار النظام:', err));
    }
  } else if (getPermissionState() === 'granted') {
    try {
      new Notification(title, { body, tag });
    } catch (err) {
      console.warn('[notifications] تعذر عرض إشعار المتصفح:', err);
    }
  }

  document.dispatchEvent(new CustomEvent('hlk:notification', { detail: entry }));
  return entry;
}

/**
 * أداة مساعدة لتفادي تكرار نفس التنبيه كل ثانية: تُطلق notify() فقط عند
 * تحوّل الحالة من "خارج الحد" إلى "داخل الحد" (edge-trigger)، وليس في كل قراءة.
 */
export function createThresholdWatcher() {
  const state = new Map();
  return function check(key, isTriggered, onTrigger) {
    const was = state.get(key) || false;
    state.set(key, isTriggered);
    if (isTriggered && !was) onTrigger();
  };
}
