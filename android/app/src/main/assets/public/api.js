/**
 * api.js
 * ============================================================================
 * عميل واجهة برمجة التطبيقات (API) الخاصة براوترات Huawei HiLink.
 *
 * ملاحظة هامة عن التوافق:
 * أسماء نقاط النهاية (endpoints) والحقول هنا مبنية على السلوك الشائع لواجهة
 * HiLink كما تستخدمها الواجهة الرسمية على معظم أجهزة Huawei (سلسلة B3xx/B5xx/
 * E5xxx وغيرها). قد تختلف بعض الأسماء أو تكون غير مدعومة حسب الطراز وإصدار
 * البرنامج الثابت. لهذا كل دالة هنا "آمنة الفشل": إن لم يدعم الجهاز نقطة نهاية
 * معينة يتم تسجيل ذلك في capabilities بدلاً من افتراض نجاحها.
 *
 * إن لاحظت أن حقلًا معينًا لا يظهر رغم أن جهازك يدعمه فعليًا، افتح صفحة إدارة
 * الراوتر الأصلية (http://192.168.1.1) وأدوات المطوّر (Network tab) لمقارنة
 * أسماء الحقول الحقيقية، ثم عدّل خريطة ENDPOINTS/الدوال أدناه. راجع README.md.
 * ============================================================================
 */

import { getRaw, setRaw, getJSON, setJSON } from './storage.js';

/* ------------------------------------------------------------------------ */
/* الإعداد الأساسي                                                          */
/* ------------------------------------------------------------------------ */

const BASE_URL_KEY = 'baseUrl';
const DEFAULT_BASE_URL = 'http://192.168.1.1';

export function getBaseUrl() {
  return getRaw(BASE_URL_KEY, DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export function setBaseUrl(url) {
  setRaw(BASE_URL_KEY, url.replace(/\/+$/, ''));
}

/* ------------------------------------------------------------------------ */
/* حالة الجلسة (Token/Cookie)                                               */
/* ------------------------------------------------------------------------ */

let sessionToken = null; // آخر __RequestVerificationToken معروف
let tokenQueue = [];      // بعض الأجهزة القديمة ترسل عدة رموز دفعة واحدة

function pushTokens(raw) {
  if (!raw) return;
  // بعض الأجهزة تفصل عدة رموز بـ "#"
  const parts = String(raw).split('#').filter(Boolean);
  if (parts.length) {
    tokenQueue.push(...parts);
    sessionToken = tokenQueue[tokenQueue.length - 1];
  }
}

function nextToken() {
  if (tokenQueue.length > 1) return tokenQueue.shift();
  return sessionToken;
}

/* ------------------------------------------------------------------------ */
/* تحويل XML <-> JS Object                                                  */
/* ------------------------------------------------------------------------ */

/** يحوّل عنصر XML إلى كائن JS بسيط (نصوص/كائنات متداخلة فقط، يكفي لهذه الواجهة) */
function xmlNodeToObject(node) {
  const children = Array.from(node.children);
  if (children.length === 0) {
    const text = node.textContent?.trim() ?? '';
    return text;
  }
  const obj = {};
  for (const child of children) {
    const value = xmlNodeToObject(child);
    if (obj[child.tagName] !== undefined) {
      // عناصر متكررة (مثل قوائم الأجهزة/الرسائل) => مصفوفة
      if (!Array.isArray(obj[child.tagName])) obj[child.tagName] = [obj[child.tagName]];
      obj[child.tagName].push(value);
    } else {
      obj[child.tagName] = value;
    }
  }
  return obj;
}

export function parseXml(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');
  const errorNode = doc.querySelector('parsererror');
  if (errorNode) throw new ApiError('استجابة XML غير صالحة', 'BAD_XML');
  const root = doc.documentElement;
  return { rootName: root.tagName, data: xmlNodeToObject(root) };
}

/**
 * يبني جسم طلب XML من كائن JS، بدعم القيم البسيطة والكائنات المتداخلة
 * والمصفوفات (لعناصر متكررة مثل <Phones><Phone>...</Phone></Phones>).
 */
export function buildXml(rootTag, obj) {
  const esc = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  function encodeValue(key, value) {
    if (Array.isArray(value)) {
      return value.map((v) => encodeValue(key, v)).join('');
    }
    if (value && typeof value === 'object') {
      const inner = Object.entries(value)
        .map(([k, v]) => encodeValue(k, v))
        .join('');
      return `<${key}>${inner}</${key}>`;
    }
    return `<${key}>${esc(value)}</${key}>`;
  }

  const inner = Object.entries(obj)
    .map(([k, v]) => encodeValue(k, v))
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${rootTag}>${inner}</${rootTag}>`;
}

/* ------------------------------------------------------------------------ */
/* أخطاء مخصّصة                                                             */
/* ------------------------------------------------------------------------ */

export class ApiError extends Error {
  constructor(message, code = 'UNKNOWN', raw = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code; // NETWORK | BAD_XML | AUTH | UNSUPPORTED | DEVICE_ERROR | UNKNOWN
    this.raw = raw;
  }
}

/* ------------------------------------------------------------------------ */
/* سجل القدرات المدعومة — يُستخدم لإخفاء/تعطيل الميزات غير المدعومة تلقائيًا */
/* ------------------------------------------------------------------------ */

const CAPS_KEY = 'capabilities';
let capabilities = getJSON(CAPS_KEY, {});

function markCapability(name, supported) {
  if (capabilities[name] === supported) return;
  capabilities[name] = supported;
  setJSON(CAPS_KEY, capabilities);
}

export function isSupported(name) {
  return capabilities[name] !== false; // متفائل افتراضيًا حتى يثبت العكس
}

export function getCapabilities() {
  return { ...capabilities };
}

/* ------------------------------------------------------------------------ */
/* طبقة الاتصال المنخفضة المستوى                                            */
/* ------------------------------------------------------------------------ */

async function rawFetch(path, { method = 'GET', xmlBody = null } = {}) {
  const url = `${getBaseUrl()}${path}`;
  const headers = {};
  if (xmlBody) headers['Content-Type'] = 'text/xml; charset=UTF-8';
  const token = nextToken();
  if (token) headers['__RequestVerificationToken'] = token;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: xmlBody || undefined,
      credentials: 'include',
      mode: 'cors',
    });
  } catch (err) {
    // فشل الشبكة نفسه (تعذّر الوصول) أو رفض CORS من المتصفح
    throw new ApiError('تعذر الوصول إلى الراوتر', 'NETWORK', err);
  }

  // التقط أي رمز جديد من رؤوس الاستجابة لاستخدامه في الطلب التالي
  const newTokenHeader =
    res.headers.get('__requestverificationtoken') ||
    res.headers.get('__requestverificationtokenone');
  if (newTokenHeader) pushTokens(newTokenHeader);

  const text = await res.text();
  if (!text) return { rootName: '', data: {} };

  const parsed = parseXml(text);

  // التقط التوكن أيضًا إن كان داخل جسم XML (شائع في SesTokInfo وتسجيل الدخول)
  if (parsed.data?.TokInfo) pushTokens(parsed.data.TokInfo);

  if (parsed.rootName === 'error') {
    const code = parsed.data?.code ?? 'UNKNOWN';
    throw new ApiError(`خطأ من الراوتر (${code})`, 'DEVICE_ERROR', parsed.data);
  }

  return parsed;
}

/**
 * يضمن وجود جلسة/توكن صالحين قبل أي طلب. يُستدعى تلقائيًا، ولا حاجة لاستدعائه
 * يدويًا في الحالات العادية.
 */
export async function ensureSessionToken() {
  const { data } = await rawFetch('/api/webserver/SesTokInfo');
  if (data?.SesInfo) {
    // بعض الأجهزة تُعيد "SessionID=xxxx" هنا فقط للعِلم؛ الكوكي تُضبط تلقائيًا
    // من طرف المتصفح بفضل Set-Cookie، لا حاجة لتخزينها يدويًا.
  }
  return sessionToken;
}

/** طلب GET عام مع إعادة محاولة واحدة عند فشل التوكن */
async function apiGet(path) {
  try {
    return await rawFetch(path, { method: 'GET' });
  } catch (err) {
    if (err.code === 'NETWORK') throw err;
    // إعادة محاولة واحدة بعد تجديد التوكن
    await ensureSessionToken();
    return rawFetch(path, { method: 'GET' });
  }
}

/** طلب POST عام (يبني XML تلقائيًا) مع إعادة محاولة واحدة عند فشل التوكن */
async function apiPost(path, bodyObj, rootTag = 'request') {
  const xml = buildXml(rootTag, bodyObj);
  try {
    return await rawFetch(path, { method: 'POST', xmlBody: xml });
  } catch (err) {
    if (err.code === 'NETWORK') throw err;
    await ensureSessionToken();
    return rawFetch(path, { method: 'POST', xmlBody: xml });
  }
}

/**
 * يستدعي دالة API وإن فشلت بسبب DEVICE_ERROR أو عدم الدعم يُسجَّل ذلك في
 * capabilities ويعاد null بدلاً من رمي الاستثناء — يستخدمها كل استدعاء "قراءة"
 * غير جوهري حتى لا تتعطل بقية اللوحة بسبب ميزة واحدة غير مدعومة.
 */
async function safeCapability(name, fn) {
  try {
    const result = await fn();
    markCapability(name, true);
    return result;
  } catch (err) {
    if (err.code === 'NETWORK') throw err; // مشكلة اتصال عامة، ليست خاصة بالميزة
    markCapability(name, false);
    return null;
  }
}

/* ------------------------------------------------------------------------ */
/* تجزئة كلمة المرور (SHA-256)                                              */
/* ------------------------------------------------------------------------ */
// ملاحظة: crypto.subtle متاح فقط في "سياق آمن" (HTTPS أو localhost). بما أن
// هذا التطبيق غالبًا سيُفتح عبر عنوان IP على الشبكة المحلية عبر HTTP عادي
// (وليس localhost)، فـ crypto.subtle قد يكون غير متاح فعليًا في أكثر سيناريو
// استخدام شيوعًا لهذا التطبيق تحديدًا. لذلك نضع تطبيق SHA-256 مكتوبًا بجافا
// سكريبت خالص كبديل احتياطي تلقائي (مُتحقَّق منه مقابل تطبيقات SHA-256 مرجعية).

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

/** تطبيق SHA-256 خالص (FIPS 180-4)، يُستخدم فقط عند غياب crypto.subtle */
function sha256Pure(bytes) {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const bitLen = bytes.length * 8;
  const padLen = (bytes.length + 1 + 8 + 63) & ~63;
  const padded = new Uint8Array(padLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 4, bitLen >>> 0, false);
  dv.setUint32(padLen - 8, Math.floor(bitLen / 4294967296), false);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return Array.from(H).map((x) => x.toString(16).padStart(8, '0')).join('');
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  if (window.isSecureContext && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return sha256Pure(bytes);
}

function base64OfAscii(asciiString) {
  return btoa(asciiString);
}

/** يبني كلمة المرور المشفّرة بالطريقة الشائعة (password_type = 4) */
async function buildHashedPassword(username, password, token) {
  const pwdHashHex = await sha256Hex(password);
  const pwdB64 = base64OfAscii(pwdHashHex);
  const combined = username + pwdB64 + token;
  const combinedHashHex = await sha256Hex(combined);
  return base64OfAscii(combinedHashHex);
}

/* ------------------------------------------------------------------------ */
/* المصادقة                                                                 */
/* ------------------------------------------------------------------------ */

export async function getLoginState() {
  const { data } = await apiGet('/api/user/state-login');
  return {
    // State === '0' يعني: مسجّل الدخول بالفعل
    loggedIn: data?.State === '0',
    raw: data,
  };
}

/**
 * تسجيل الدخول. يجرّب أولًا كلمة المرور المُجزّأة (password_type=4) وهي
 * الأشيع في الأجهزة الحديثة، ثم يعود تلقائيًا لإرسال كلمة المرور كنص عادي
 * إن رفض الجهاز الطريقة الأولى (أجهزة/برامج ثابتة أقدم).
 */
export async function login(username, password) {
  await ensureSessionToken();
  const token = sessionToken;
  if (!token) throw new ApiError('تعذر الحصول على رمز الجلسة من الراوتر', 'AUTH');

  const attempts = [
    async () => {
      const hashed = await buildHashedPassword(username, password, token);
      return apiPost('/api/user/login', {
        Username: username,
        Password: hashed,
        password_type: 4,
      });
    },
    async () =>
      apiPost('/api/user/login', {
        Username: username,
        Password: base64OfAscii(password),
        password_type: 0,
      }),
  ];

  let lastErr = null;
  for (const attempt of attempts) {
    try {
      await attempt();
      markCapability('login', true);
      return true;
    } catch (err) {
      if (err.code === 'NETWORK') throw err;
      lastErr = err;
    }
  }
  throw new ApiError('بيانات الدخول غير صحيحة، أو أن هذا الجهاز يستخدم آلية تشفير مختلفة لكلمة المرور', 'AUTH', lastErr);
}

export async function logout() {
  try {
    await apiPost('/api/user/logout', { Logout: 1 });
  } catch {
    /* لا بأس إن فشل الطلب — سنمسح حالة الجلسة محليًا بأي حال */
  }
  sessionToken = null;
  tokenQueue = [];
}

/* ------------------------------------------------------------------------ */
/* معلومات الجهاز والحالة العامة                                            */
/* ------------------------------------------------------------------------ */

export const getDeviceInfo = () =>
  safeCapability('deviceInfo', async () => (await apiGet('/api/device/information')).data);

export const getMonitoringStatus = () =>
  safeCapability('monitoringStatus', async () => (await apiGet('/api/monitoring/status')).data);

export const getTrafficStatistics = () =>
  safeCapability('trafficStats', async () => (await apiGet('/api/monitoring/traffic-statistics')).data);

export const getMonthStatistics = () =>
  safeCapability('monthStats', async () => (await apiGet('/api/monitoring/month_statistics')).data);

export const getSignalInfo = () =>
  safeCapability('signalInfo', async () => (await apiGet('/api/device/signal')).data);

export const getCurrentPlmn = () =>
  safeCapability('plmn', async () => (await apiGet('/api/net/current-plmn')).data);

export const getNetMode = () =>
  safeCapability('netModeRead', async () => (await apiGet('/api/net/net-mode')).data);

export const setNetMode = (networkMode, lteBand = 'FFFFFFFFFFFFFFFF', networkBand = '3FFFFFFF') =>
  safeCapability('netModeWrite', async () =>
    apiPost('/api/net/net-mode', {
      NetworkMode: networkMode, // '00' تلقائي، '03' يجبر 4G فقط، '09'/'0D' حسب الطراز لـ5G
      NetworkBand: networkBand,
      LTEBand: lteBand,
    })
  );

/* ------------------------------------------------------------------------ */
/* إجراءات الاتصال                                                          */
/* ------------------------------------------------------------------------ */

export const dialConnect = () =>
  safeCapability('dialConnect', async () => apiPost('/api/dialup/dial', { Action: 1 }));

export const dialDisconnect = () =>
  safeCapability('dialDisconnect', async () => apiPost('/api/dialup/dial', { Action: 0 }));

export const rebootDevice = () =>
  safeCapability('reboot', async () => apiPost('/api/device/control', { Control: 1 }));

/** لا توجد نقطة نهاية موحّدة رسمية لإيقاف التشغيل الكامل في معظم الطُرز؛
 * نحاول القيم الشائعة ونعطّل الزر تلقائيًا إن فشلت جميعها. */
export const powerOffDevice = () =>
  safeCapability('powerOff', async () => {
    try {
      return await apiPost('/api/device/control', { Control: 4 });
    } catch (err) {
      if (err.code === 'NETWORK') throw err;
      return apiPost('/api/system/power-off', { Action: 1 });
    }
  });

/* ------------------------------------------------------------------------ */
/* الواي فاي                                                                */
/* ------------------------------------------------------------------------ */

export const getWlanBasicSettings = () =>
  safeCapability('wlanBasic', async () => (await apiGet('/api/wlan/basic-settings')).data);

export const setWlanBasicSettings = (fields) =>
  safeCapability('wlanBasicWrite', async () => apiPost('/api/wlan/basic-settings', fields));

export const getWlanSecuritySettings = () =>
  safeCapability('wlanSecurity', async () => (await apiGet('/api/wlan/security-settings')).data);

export const setWlanSecuritySettings = (fields) =>
  safeCapability('wlanSecurityWrite', async () => apiPost('/api/wlan/security-settings', fields));

export const setWifiToggle = (enabled) =>
  safeCapability('wifiToggle', async () =>
    apiPost('/api/wlan/wifi-switch', { WifiSwitch: enabled ? 1 : 0 })
  );

/* ------------------------------------------------------------------------ */
/* الأجهزة المتصلة                                                          */
/* ------------------------------------------------------------------------ */

export const getHostList = () =>
  safeCapability('hostList', async () => {
    const { data } = await apiGet('/api/wlan/host-list');
    const hosts = data?.Hosts?.Host ?? data?.Host ?? [];
    return Array.isArray(hosts) ? hosts : [hosts];
  });

export const setDeviceBlocked = (mac, blocked) =>
  safeCapability('macFilter', async () =>
    apiPost('/api/security/mac-filter', {
      MacAddress: mac,
      Status: blocked ? 1 : 0,
    })
  );

/* ------------------------------------------------------------------------ */
/* الرسائل النصية (SMS)                                                     */
/* ------------------------------------------------------------------------ */

export const getSmsCount = () =>
  safeCapability('smsCount', async () => (await apiGet('/api/sms/sms-count')).data);

export const getSmsList = (page = 1, count = 20, boxType = 1) =>
  safeCapability('smsList', async () => {
    const { data } = await apiPost('/api/sms/sms-list', {
      PageIndex: page,
      ReadCount: count,
      BoxType: boxType, // 1=الوارد, 2=الصادر, 3=المسودات
      SortType: 0,
      Ascending: 0,
      UnreadPreferred: 0,
    });
    const list = data?.Messages?.Message ?? [];
    return Array.isArray(list) ? list : [list];
  });

export const sendSms = (phone, content) =>
  safeCapability('smsSend', async () => {
    const date = new Date()
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d+Z$/, '');
    return apiPost('/api/sms/send-sms', {
      Index: -1,
      Phones: { Phone: phone },
      Sca: '',
      Content: content,
      Length: content.length,
      Reserved: 1,
      Date: date,
    });
  });

export const deleteSms = (index) =>
  safeCapability('smsDelete', async () => apiPost('/api/sms/delete-sms', { Index: index }));

export const setSmsRead = (index) =>
  safeCapability('smsRead', async () => apiPost('/api/sms/set-read', { Index: index }));

/* ------------------------------------------------------------------------ */
/* مساعدات مشتقة (لا تستدعي الشبكة)                                        */
/* ------------------------------------------------------------------------ */

/** يشتق معرّف المحطة eNB ID من Cell ID القياسي لشبكات LTE (28 بت = eNB[20] + قطاع[8]) */
export function deriveEnbId(cellIdRaw) {
  if (cellIdRaw === undefined || cellIdRaw === null || cellIdRaw === '') return null;
  const n = /^[0-9a-fA-F]+$/.test(String(cellIdRaw)) && String(cellIdRaw).length > 8
    ? parseInt(cellIdRaw, 16)
    : parseInt(cellIdRaw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return {
    enbId: n >> 8,
    sectorId: n & 0xff,
  };
}
