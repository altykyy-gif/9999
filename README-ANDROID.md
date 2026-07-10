# تطبيق أندرويد (APK) — لوحة تحكم راوتر Huawei HiLink

هذا المشروع يحوّل تطبيق الويب إلى تطبيق أندرويد حقيقي عبر **Capacitor**، بحيث
يتصل بالراوتر عبر شبكة أندرويد الأصلية (native networking) بدل متصفح الويب —
وبالتالي **لا تنطبق عليه قيود CORS إطلاقًا**، لأن CORS أصلًا قيد خاص بالمتصفحات
فقط، وليس بالتطبيقات الأصلية.

---

## ⚠️ لم أتمكن من بناء ملف APK جاهز هنا مباشرة

بيئة التنفيذ التي أعمل بها معزولة عن الشبكة إلا لعدد محدود من النطاقات (npm،
GitHub، PyPI...)، ولا تشمل خوادم Google/Gradle الضرورية لبناء تطبيقات أندرويد
فعليًا (`services.gradle.org`, `dl.google.com`, `maven.google.com`). حاولت
البناء وهذا ما ظهر فعليًا:

```
Downloading https://services.gradle.org/distributions/gradle-8.14.3-all.zip
Exception: Server returned HTTP response code: 403
```

لذلك جهّزت لك **مشروع Android/Capacitor كامل وحقيقي وقابل للبناء مباشرة**
(وليس مجرد كود تجريبي)، مع طريقتين لإكمال البناء فعليًا:

### الطريقة 1 — الأسهل: بناء تلقائي على GitHub (بدون تثبيت أي شيء)

1. ارفع محتوى هذا المجلد إلى مستودع GitHub جديد.
2. أضفت لك ملف `.github/workflows/build-android.yml` جاهزًا: بمجرد الرفع
   (push) سيبني GitHub تلقائيًا ملف APK.
3. من تبويب **Actions** في المستودع ← افتح آخر تشغيل ← حمّل الملف من
   قسم **Artifacts** باسم `huawei-hilink-dashboard-debug-apk`.
4. انقل ملف الـAPK إلى هاتفك وثبّته (فعّل "السماح بالتثبيت من مصادر غير
   معروفة" إن طُلب ذلك).

هذه الطريقة لا تحتاج Android Studio ولا أي إعداد على جهازك.

### الطريقة 2 — Android Studio على جهازك

1. ثبّت [Android Studio](https://developer.android.com/studio) (يشمل JDK
   وAndroid SDK اللازمين).
2. من داخل هذا المجلد:
   ```bash
   npm install
   npx cap sync android
   ```
3. افتح مجلد `android/` في Android Studio (File → Open).
4. انتظر اكتمال مزامنة Gradle (أول مرة قد تستغرق دقائق لتحميل الاعتماديات).
5. لتشغيله مباشرة على جهاز/محاكي: زر ▶ Run.
   لإنشاء ملف APK: **Build → Build Bundle(s) / APK(s) → Build APK(s)**،
   ثم ستجده في `android/app/build/outputs/apk/debug/app-debug.apk`.

### الطريقة 3 — سطر الأوامر (إن كان لديك Android SDK مُعد مسبقًا)

```bash
npm install
npx cap sync android
cd android
./gradlew assembleDebug
# الناتج: android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 🔓 كيف يحل هذا مشكلة CORS بالضبط

فعّلت في `capacitor.config.json`:

```json
"plugins": {
  "CapacitorHttp": { "enabled": true },
  "CapacitorCookies": { "enabled": true }
}
```

- **CapacitorHttp** يُعيد توجيه كل استدعاءات `fetch()` تلقائيًا (بلا أي تعديل
  على `api.js`) لتُنفَّذ عبر مكتبات الشبكة الأصلية لأندرويد (`HttpURLConnection`)
  بدل شبكة WebView — وشبكة أندرويد الأصلية لا تطبّق سياسة CORS إطلاقًا (هذه
  السياسة مفهوم متصفح وليست مفهوم شبكة).
- **CapacitorCookies** يُبقي إدارة الكوكيز (مثل SessionID الخاص بجلسة تسجيل
  الدخول في الراوتر) متزامنة عبر مخزن كوكيز أصلي، فتستمر الجلسة تعمل تمامًا
  كما في المتصفح.
- النتيجة: **لم يتطلب الأمر أي تعديل على `api.js`** — نفس الكود المُختبر
  مسبقًا يعمل كما هو.

## 🌐 حركة HTTP الصريحة (Cleartext)

أضفت `network_security_config.xml` يسمح بحركة HTTP العادية (بلا TLS) لأن
الراوتر لا يقدّم شهادة HTTPS. هذا مُفعّل بشكل عام هنا لأن هذا التطبيق أصلًا
لا يتحدث إلا مع عنوان الراوتر الذي يحدده المستخدم — إن كنت تعرف عنوان راوترك
تحديدًا ولن يتغيّر، الملف نفسه يشرح كيف تُضيّق النطاق لعنوان واحد فقط.

## 🔔 الإشعارات

بدّلت آلية الإشعارات لتستخدم `@capacitor/local-notifications` (إشعارات نظام
أندرويد الحقيقية) بدل Web Notification API غير المدعومة جيدًا داخل WebView.
هذا تلقائي بالكامل — `notifications.js` يكتشف أنه يعمل داخل تطبيق أصلي
ويستخدم المسار الصحيح تلقائيًا.

## 🎨 الأيقونات وشاشة البدء

استبدلت شعار Capacitor الافتراضي بأيقونة العلامة نفسها المستخدمة في نسخة
الويب (رمز موجات الإشارة بالتركواز على خلفية داكنة)، بكل الأحجام والصيغ التي
يحتاجها أندرويد (عادية + قابلة للتكيّف Adaptive + شاشة بدء Splash).
لتخصيصها لاحقًا: Android Studio ← كليك يمين على `res` ← New ← Image Asset.

## ✏️ قبل النشر الفعلي (اختياري)

- **معرّف التطبيق**: غيّر `appId` في `capacitor.config.json` من
  `com.hilink.dashboard` إلى معرّف خاص بك، ثم أعد `npx cap sync android`.
- **التوقيع**: لنشر التطبيق فعليًا (وليس فقط تثبيته يدويًا) ستحتاج توليد
  مفتاح توقيع (`keystore`) وضبط `Build → Generate Signed Bundle/APK` في
  Android Studio — هذه خطوة قياسية موثّقة في دليل أندرويد الرسمي.
- ملفات الويب نفسها (`www/`) هي نفس نسخة PWA بلا أي تعديل تقريبًا، فيمكنك
  الاستمرار في تطوير الميزات هناك ثم `npx cap sync android` لتحديث التطبيق.

## 📁 بنية المشروع

```
huawei-android/
├── www/                    ← نفس ملفات تطبيق الويب (PWA)
├── capacitor.config.json   ← إعدادات Capacitor (هنا تفعيل تجاوز CORS)
├── android/                ← مشروع أندرويد الأصلي (Android Studio/Gradle)
├── .github/workflows/      ← بناء APK تلقائي على GitHub
└── package.json
```
