/**
 * storage.js
 * غلاف صغير وآمن للتعامل مع LocalStorage (قراءة/كتابة JSON مع معالجة الأخطاء).
 * جميع مفاتيح التخزين في المشروع تبدأ بالبادئة "hlk." لتجنّب أي تعارض.
 */

const PREFIX = 'hlk.';

/** قراءة قيمة JSON من التخزين، مع قيمة افتراضية عند الفشل أو عدم الوجود */
export function getJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[storage] تعذرت قراءة المفتاح ${key}:`, err);
    return fallback;
  }
}

/** كتابة قيمة (سيتم تحويلها إلى JSON) */
export function setJSON(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (err) {
    // غالبًا يحدث هذا عند امتلاء مساحة التخزين
    console.warn(`[storage] تعذرت كتابة المفتاح ${key}:`, err);
    return false;
  }
}

/** حذف مفتاح */
export function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch (err) {
    console.warn(`[storage] تعذر حذف المفتاح ${key}:`, err);
  }
}

/** قراءة نص خام (بدون JSON.parse) */
export function getRaw(key, fallback = '') {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

/** كتابة نص خام */
export function setRaw(key, value) {
  try {
    localStorage.setItem(PREFIX + key, value);
    return true;
  } catch {
    return false;
  }
}

/** إرجاع كل المفاتيح الخاصة بالمشروع (بدون البادئة) */
export function allKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k.slice(PREFIX.length));
  }
  return keys;
}

/** حذف كل بيانات التطبيق فقط (لا يمس أي مفاتيح أخرى في نفس المتصفح) */
export function clearAll() {
  allKeys().forEach(remove);
}
