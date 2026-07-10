/**
 * qrcode-lib.js
 * ============================================================================
 * مولّد رموز QR مستقل بالكامل (بدون أي مكتبة خارجية) يطبّق مواصفة
 * ISO/IEC 18004 (وضع البايت فقط) — يكفي لعرض رمز QR للاتصال بشبكة واي فاي.
 *
 * يدعم الإصدارات 1 إلى 10 (تكفي بسهولة لأطول سلسلة WIFI:... واقعية) بمستوى
 * تصحيح خطأ M افتراضيًا مع التراجع التلقائي لمستوى L عند الحاجة لسعة أكبر.
 * جداول بنية الترميز (عدد الكتل/الكلمات الرمزية) ومواضع أنماط المحاذاة هنا هي
 * حقائق ثابتة يفرضها المعيار القياسي (لا مجال للاجتهاد فيها)، أما حساب كثيرة
 * حدود Reed-Solomon ومعلومات الصيغة (Format/Version Info) فيُشتق هنا رياضيًا
 * بدلاً من تخزينه كجدول جاهز.
 * ============================================================================
 */

/* ---------------------------- حقل جالوا GF(256) --------------------------- */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function buildGaloisTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // كثيرة حدود الحقل القياسية لـ QR: x^8+x^4+x^3+x^2+1
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** كثيرة حدود مولّد Reed-Solomon لعدد ecCount من كلمات تصحيح الخطأ (لوغاريتمات المعاملات، بدون المعامل الرائد=1) */
function rsGeneratorPolyLogs(ecCount) {
  let poly = [1];
  for (let i = 0; i < ecCount; i++) {
    poly.push(0);
    const c = GF_EXP[i];
    for (let j = poly.length - 1; j > 0; j--) {
      poly[j] = poly[j] ^ gfMul(poly[j - 1], c);
    }
  }
  return poly.slice(1).map((v) => GF_LOG[v]);
}

/** قسمة اصطناعية للحصول على كلمات تصحيح الخطأ لكتلة بيانات واحدة */
function rsComputeEcCodewords(dataBytes, ecCount) {
  const gen = rsGeneratorPolyLogs(ecCount);
  const buf = new Uint8Array(dataBytes.length + ecCount);
  buf.set(dataBytes, 0);
  for (let k = 0; k < dataBytes.length; k++) {
    const coef = buf[k];
    if (coef !== 0) {
      const lcoef = GF_LOG[coef];
      for (let n = 0; n < ecCount; n++) {
        buf[k + n + 1] ^= GF_EXP[(lcoef + gen[n]) % 255];
      }
    }
  }
  return Array.from(buf.slice(dataBytes.length));
}

/* --------------------- جداول بنية الترميز (ISO/IEC 18004) ------------------ */
// كل مُدخل: [عدد_الكتل, إجمالي_الكلمات_الرمزية_للكتلة, كلمات_البيانات_للكتلة]
// قد يحتوي إصدار على مجموعتين بحجمين مختلفين (كما في النسخة القياسية).

const ECC_TABLE = {
  1: { L: [[1, 26, 19]], M: [[1, 26, 16]] },
  2: { L: [[1, 44, 34]], M: [[1, 44, 28]] },
  3: { L: [[1, 70, 55]], M: [[1, 70, 44]] },
  4: { L: [[1, 100, 80]], M: [[2, 50, 32]] },
  5: { L: [[1, 134, 108]], M: [[2, 67, 43]] },
  6: { L: [[2, 86, 68]], M: [[4, 43, 27]] },
  7: { L: [[2, 98, 78]], M: [[4, 49, 31]] },
  8: { L: [[2, 121, 97]], M: [[2, 60, 38], [2, 61, 39]] },
  9: { L: [[2, 146, 116]], M: [[3, 58, 36], [2, 59, 37]] },
  10: { L: [[2, 86, 68], [2, 87, 69]], M: [[4, 69, 43], [1, 70, 44]] },
};

const ALIGNMENT_POS = {
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

function remainderBits(version) {
  if (version === 1) return 0;
  if (version >= 2 && version <= 6) return 7;
  return 0; // 7..10
}

/* ------------------------------ اختيار الإصدار ----------------------------- */

function totalDataBytes(version, level) {
  return ECC_TABLE[version][level].reduce((sum, [blocks, , data]) => sum + blocks * data, 0);
}

function chooseVersion(byteLen, preferredLevel) {
  const levels = preferredLevel === 'L' ? ['L'] : ['M', 'L'];
  for (const level of levels) {
    for (let v = 1; v <= 10; v++) {
      const countBits = v <= 9 ? 8 : 16;
      const capacityBits = totalDataBytes(v, level) * 8;
      const neededBits = 4 + countBits + byteLen * 8;
      if (neededBits <= capacityBits) return { version: v, level };
    }
  }
  return null; // البيانات أطول مما يدعمه هذا المولّد (نادر جدًا لسلسلة واي فاي)
}

/* -------------------------------- كاتب البتات ------------------------------ */

class BitWriter {
  constructor() {
    this.bits = [];
  }
  push(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }
  get length() {
    return this.bits.length;
  }
  toBytes() {
    const bytes = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | (this.bits[i + j] || 0);
      bytes.push(b);
    }
    return bytes;
  }
}

function buildDataCodewords(bytes, version, level) {
  const capacityBytes = totalDataBytes(version, level);
  const capacityBits = capacityBytes * 8;
  const bw = new BitWriter();
  bw.push(0b0100, 4); // مؤشر الوضع: Byte mode
  const countBits = version <= 9 ? 8 : 16;
  bw.push(bytes.length, countBits);
  for (const b of bytes) bw.push(b, 8);
  const termLen = Math.max(0, Math.min(4, capacityBits - bw.length));
  bw.push(0, termLen);
  // محاذاة إلى حدود البايت التالية — تُضاف دائمًا (حتى عند المحاذاة التامة، أي 8
  // بتات كاملة)، تماشيًا مع الممارسة القياسية المتبعة في التطبيقات المرجعية.
  // القيمة الفعلية لبتات الحشو لا تغيّر المحتوى المُفكّك لاحقًا لأن أي قارئ QR
  // يتوقف عند طول المحتوى المُعلَن في مؤشر عدّ الأحرف ويتجاهل ما بعده.
  const padBits = Math.min(8 - (bw.length % 8), capacityBits - bw.length);
  if (padBits > 0) bw.push(0, padBits);
  const codewords = bw.toBytes();
  const padBytes = [0xec, 0x11];
  let i = 0;
  while (codewords.length < capacityBytes) {
    codewords.push(padBytes[i % 2]);
    i++;
  }
  return codewords;
}

function interleave(version, level, dataCodewords) {
  const groups = ECC_TABLE[version][level];
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const [numBlocks, numTotal, numData] of groups) {
    const ecCount = numTotal - numData;
    for (let b = 0; b < numBlocks; b++) {
      const block = dataCodewords.slice(offset, offset + numData);
      offset += numData;
      dataBlocks.push(block);
      ecBlocks.push(rsComputeEcCodewords(block, ecCount));
    }
  }
  const out = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  const maxEc = Math.max(...ecBlocks.map((b) => b.length));
  for (let i = 0; i < maxEc; i++) {
    for (const block of ecBlocks) if (i < block.length) out.push(block[i]);
  }
  return out;
}

/* --------------------------- BCH: معلومات الصيغة/الإصدار ------------------- */

function bchRemainder(data, generator, genDegree) {
  let val = data << genDegree;
  let valDeg = 31 - Math.clz32(val);
  while (valDeg >= genDegree && val !== 0) {
    val ^= generator << (valDeg - genDegree);
    valDeg = 31 - Math.clz32(val);
  }
  return val;
}

function formatInfoBits(levelBits, maskId) {
  // levelBits: مؤشر مستوى تصحيح الخطأ القياسي (M=00,L=01,H=10,Q=11)
  const data5 = (levelBits << 3) | maskId;
  const G = 0b10100110111; // درجة 10
  const rem = bchRemainder(data5, G, 10);
  const bits15 = (data5 << 10) | rem;
  return bits15 ^ 0x5412;
}

function versionInfoBits(version) {
  const G = 0b1111100100101; // درجة 12
  const rem = bchRemainder(version, G, 12);
  return (version << 12) | rem;
}

/* --------------------------------- المصفوفة -------------------------------- */

const EC_LEVEL_BITS = { M: 0b00, L: 0b01, H: 0b10, Q: 0b11 };

function buildMatrix(version, level, allCodewords, maskId) {
  const size = version * 4 + 17;
  const dark = new Uint8Array(size * size);
  const isFn = new Uint8Array(size * size);
  const at = (r, c) => r * size + c;
  const inBounds = (r, c) => r >= 0 && r < size && c >= 0 && c < size;

  function setFn(r, c, isDark) {
    if (!inBounds(r, c)) return;
    dark[at(r, c)] = isDark ? 1 : 0;
    isFn[at(r, c)] = 1;
  }

  function placeFinder(row, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r;
        const cc = col + c;
        if (!inBounds(rr, cc)) continue;
        let d;
        if (r === -1 || r === 7 || c === -1 || c === 7) d = false;
        else if (r === 0 || r === 6 || c === 0 || c === 6) d = true;
        else if (r >= 2 && r <= 4 && c >= 2 && c <= 4) d = true;
        else d = false;
        setFn(rr, cc, d);
      }
    }
  }
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  for (let i = 8; i <= size - 9; i++) {
    const d = i % 2 === 0;
    setFn(6, i, d);
    setFn(i, 6, d);
  }

  // الوحدة الداكنة الثابتة
  setFn(4 * version + 9, 8, true);

  // أنماط المحاذاة
  const positions = ALIGNMENT_POS[version] || [];
  for (const r of positions) {
    for (const c of positions) {
      const overlaps =
        (r <= 9 && c <= 9) || (r <= 9 && c >= size - 10) || (r >= size - 10 && c <= 9);
      if (overlaps) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const d = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFn(r + dr, c + dc, d);
        }
      }
    }
  }

  // إحداثيات معلومات الصيغة (15 بت، نسختان مكرّرتان) — تُستخدم نفس القوائم
  // لكل من "الحجز" (منع اعتبارها بيانات) و"الكتابة" لاحقًا، لضمان التطابق.
  const fmtCopy1 = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  const fmtCopy2 = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8],
    [size - 6, 8], [size - 7, 8],
    [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5],
    [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
  ];
  for (const [r, c] of fmtCopy1) setFn(r, c, false);
  for (const [r, c] of fmtCopy2) setFn(r, c, false);

  // إحداثيات معلومات الإصدار (v7+، 18 بت، نسختان)
  const verCopyA = []; // يسار الزاوية العلوية اليمنى
  const verCopyB = []; // أعلى الزاوية السفلية اليسرى
  if (version >= 7) {
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 3; c++) {
        verCopyA.push([r, size - 11 + c]);
        verCopyB.push([size - 11 + c, r]);
      }
    }
    for (const [r, c] of verCopyA) setFn(r, c, false);
    for (const [r, c] of verCopyB) setFn(r, c, false);
  }

  // ------ ترتيب بيانات على شكل تعرّج (zigzag) ------
  const bits = [];
  for (const byte of allCodewords) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  for (let i = 0; i < remainderBits(version); i++) bits.push(0);

  let bitIndex = 0;
  let upward = true;
  let col = size - 1;
  while (col > 0) {
    if (col === 6) col--; // تخطّي عمود التوقيت بالكامل (بدل معالجته كعمود بيانات)
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (isFn[at(row, c)]) continue;
        const bit = bitIndex < bits.length ? bits[bitIndex] : 0;
        bitIndex++;
        dark[at(row, c)] = bit;
      }
    }
    upward = !upward;
    col -= 2;
  }

  // ------ القناع (نستخدم القناع الثابت 0: (row+col)%2===0) ------
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (isFn[at(r, c)]) continue;
      if ((r + c) % 2 === 0) dark[at(r, c)] ^= 1;
    }
  }

  // ------ كتابة معلومات الصيغة الحقيقية ------
  const fBits = formatInfoBits(EC_LEVEL_BITS[level], maskId); // 15 بت
  const fBit = (i) => (fBits >> (14 - i)) & 1; // i=0 يقابل أعلى بت (bit14) أولاً

  fmtCopy1.forEach(([r, c], i) => {
    dark[at(r, c)] = fBit(i);
  });

  fmtCopy2.forEach(([r, c], i) => {
    dark[at(r, c)] = fBit(i);
  });

  // ------ كتابة معلومات الإصدار (v7+) ------
  if (version >= 7) {
    const vBits = versionInfoBits(version); // 18 بت
    const vBit = (i) => (vBits >> i) & 1;
    verCopyA.forEach(([r, c], i) => {
      dark[at(r, c)] = vBit(i);
    });
    verCopyB.forEach(([r, c], i) => {
      dark[at(r, c)] = vBit(i);
    });
  }

  return { size, dark };
}

/**
 * يولّد مصفوفة رمز QR لنص ما.
 * @returns {{size:number, dark:Uint8Array, version:number, level:string}}
 */
export function encodeQR(text, options = {}) {
  const bytes = new TextEncoder().encode(text);
  const chosen = chooseVersion(bytes.length, options.level || 'M');
  if (!chosen) throw new Error('النص طويل جدًا لتوليد رمز QR');
  const { version, level } = chosen;
  const dataCodewords = buildDataCodewords(bytes, version, level);
  const allCodewords = interleave(version, level, dataCodewords);
  const { size, dark } = buildMatrix(version, level, allCodewords, options.mask ?? 0);
  return { size, dark, version, level };
}

/** يرسم رمز QR داخل عنصر <canvas> */
export function drawQRCode(canvas, text, { scale = 8, margin = 4, dark = '#000000', light = '#ffffff' } = {}) {
  const { size, dark: modules } = encodeQR(text);
  const total = size + margin * 2;
  canvas.width = total * scale;
  canvas.height = total * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = dark;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r * size + c]) {
        ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
      }
    }
  }
  return canvas;
}
