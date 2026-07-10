/**
 * auth.js
 * إدارة تسجيل الدخول والجلسة. لا يتم تخزين كلمة المرور نفسها أبدًا — فقط
 * "حالة تسجيل الدخول" ووقت انتهائها التقديري، حتى لا يُطلب إدخال كلمة المرور
 * إلا عند انتهاء الجلسة فعليًا (كما طُلب).
 */

import * as api from './api.js';
import { getJSON, setJSON, remove } from './storage.js';

const SESSION_KEY = 'session';
// مدة افتراضية نعتبر بعدها الجلسة "على الأرجح" منتهية إن لم نتمكن من التحقق
// من الراوتر (مثلاً عند فتح التطبيق دون اتصال بالشبكة) — تُستخدم كتخمين أولي
// فقط، والمصدر الحقيقي دائمًا هو /api/user/state-login عند توفر الاتصال.
const ASSUME_VALID_MS = 30 * 60 * 1000;

function readSession() {
  return getJSON(SESSION_KEY, null);
}

function writeSession(loggedIn) {
  setJSON(SESSION_KEY, { loggedIn, at: Date.now() });
}

export function clearSession() {
  remove(SESSION_KEY);
}

/** هل نملك مؤشرًا محليًا على أن المستخدم كان مسجّلاً دخوله سابقًا؟ */
export function hasLocalSession() {
  const s = readSession();
  return !!s?.loggedIn;
}

/**
 * محاولة استعادة الجلسة عند فتح التطبيق: إن وُجد مؤشر محلي، تحقق من الراوتر
 * فعليًا. في حال تعذّر الوصول للشبكة (لسنا متصلين بشبكة الراوتر الآن) نفترض
 * الجلسة صالحة مؤقتًا بدل إجبار المستخدم على كلمة المرور فورًا.
 */
export async function restoreSession() {
  if (!hasLocalSession()) return false;
  try {
    const { loggedIn } = await api.getLoginState();
    if (loggedIn) {
      writeSession(true);
      return true;
    }
    clearSession();
    return false;
  } catch (err) {
    if (err.code === 'NETWORK') {
      // لا يوجد اتصال بالراوتر الآن — لا نسجل الخروج قسرًا، فقط ننتظر
      const s = readSession();
      const stillFresh = s && Date.now() - s.at < ASSUME_VALID_MS;
      return !!stillFresh;
    }
    clearSession();
    return false;
  }
}

export async function login(username, password) {
  await api.login(username, password);
  writeSession(true);
  return true;
}

export async function logout() {
  await api.logout();
  clearSession();
}

/** فحص دوري خفيف للتأكد من أن الجلسة ما زالت صالحة من جهة الراوتر */
export async function verifySessionStillValid() {
  try {
    const { loggedIn } = await api.getLoginState();
    if (!loggedIn) clearSession();
    return loggedIn;
  } catch (err) {
    if (err.code === 'NETWORK') return hasLocalSession();
    return false;
  }
}
