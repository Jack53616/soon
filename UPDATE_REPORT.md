# تقرير التحديثات - QL Trading Bot

## ملخص التحديثات المنفذة

تم تنفيذ جميع التعديلات المطلوبة بنجاح ورفعها إلى GitHub.

---

## 1. إصلاح الخط الأزرق في الرسم البياني

**الملفات المعدلة:** `client/style.css`, `client/index.html`

**التحسينات:**
- إضافة gradient متدرج للخط (أزرق → سماوي → أخضر)
- إضافة تأثير توهج متحرك (pulse animation)
- إضافة منطقة ملونة تحت الخط (fill gradient)
- تحسين سمك الخط وانحناءاته

---

## 2. إزالة "النشاط الأخير" من الصفحة الرئيسية

**الملفات المعدلة:** `client/index.html`, `client/style.css`

**التغييرات:**
- إزالة قسم "Recent activity" بالكامل
- تعديل التخطيط ليعرض فقط "Live feed"

---

## 3. تحسين نظام السحب

**الملفات المعدلة:** `client/index.html`, `client/app.js`, `server/controllers/wallet.controller.js`

**التحسينات:**
- إزالة شرط حفظ المحفظة المسبق
- إضافة حقل إدخال العنوان مباشرة مع طلب السحب
- تحسين رسائل الخطأ
- ربط نظام السحب بإعدادات الـ Panel

---

## 4. نظام الصيانة الجديد

**الملفات المعدلة:** `server/bot/bot.js`, `client/index.html`, `client/style.css`, `client/app.js`, `server/index.js`

**الأوامر الجديدة:**
| الأمر | الوظيفة |
|-------|---------|
| `/maintenance` | تفعيل وضع الصيانة |
| `/endmaintenance` | إنهاء وضع الصيانة |
| `/maintenancestatus` | عرض حالة الصيانة |
| `/stopbot` | إيقاف البوت بالكامل |
| `/startbot` | تشغيل البوت |

**شاشة الصيانة:**
- تصميم أنيق مع تروس متحركة
- رسالة بالعربية والإنجليزية
- نقاط تحميل متحركة

---

## 5. تطوير Admin Panel الشامل

**الملفات المعدلة:** `client/admin.html`, `client/admin.css`, `client/admin.js`, `server/controllers/admin.controller.js`, `server/routes/admin.routes.js`

### الوظائف الجديدة:

**إدارة المستخدمين:**
- البحث بالاسم أو Telegram ID
- عرض تفاصيل المستخدم الكاملة
- إضافة/خصم/تصفير الرصيد
- تمديد الاشتراك بعدد أيام محدد
- إضافة صفقات جديدة
- تصفير السجل
- حظر المستخدم

**إدارة السحوبات:**
- عرض طلبات السحب مع الفلترة (قيد الانتظار/مقبولة/مرفوضة/الكل)
- موافقة أو رفض الطلبات مباشرة
- عرض تفاصيل كل طلب

**إدارة الصفقات:**
- عرض جميع الصفقات مع الفلترة (مفتوحة/مغلقة/الكل)
- إغلاق الصفقات يدوياً

**الإعدادات:**
- تبديل حالة السحب (مفعّل/متوقف)
- تبديل وضع الصيانة
- إنشاء مفاتيح اشتراك جديدة
- إرسال رسائل جماعية

---

## 6. إصلاح تسجيل الدخول في Panel

**الملفات المعدلة:** `client/admin.js`, `server/routes/admin.routes.js`

**الإصلاحات:**
- تصحيح endpoint المصادقة
- إضافة حفظ التوكن في localStorage
- تسجيل خروج تلقائي عند انتهاء الصلاحية

---

## 7. إصلاح نظام الصفقات

**الملف المعدل:** `server/services/tradingEngine.js`

**التحسينات:**
- تحسين خوارزمية حساب الربح/الخسارة
- إضافة مراحل ذكية للتذبذب
- حفظ الصفقات في سجل التاريخ
- تسجيل العمليات في جدول ops
- إرسال إشعارات محسنة

---

## 8. تحسين التصميم العام

**الملف المعدل:** `client/style.css`

**التحسينات:**
- تحسين تصميم الأزرار السريعة
- تحسين بطاقات الإحصائيات
- إضافة تأثيرات hover محسنة
- تحسين الألوان والتدرجات

---

## الـ API Endpoints الجديدة

| Endpoint | Method | الوظيفة |
|----------|--------|---------|
| `/api/admin/dashboard` | GET | لوحة التحكم |
| `/api/admin/users` | GET | قائمة المستخدمين |
| `/api/admin/user/search` | GET | البحث عن مستخدم |
| `/api/admin/user/:id` | GET | تفاصيل مستخدم |
| `/api/admin/user/balance` | POST | تعديل الرصيد |
| `/api/admin/user/subscription` | POST | تمديد الاشتراك |
| `/api/admin/user/trade` | POST | إضافة صفقة |
| `/api/admin/user/clear-history` | POST | تصفير السجل |
| `/api/admin/user/ban` | POST | حظر المستخدم |
| `/api/admin/withdrawals` | GET | طلبات السحب |
| `/api/admin/withdraw/approve` | POST | موافقة على السحب |
| `/api/admin/withdraw/reject` | POST | رفض السحب |
| `/api/admin/trades` | GET | الصفقات |
| `/api/admin/trade/close` | POST | إغلاق صفقة |
| `/api/admin/settings/withdrawal` | GET | حالة السحب |
| `/api/admin/settings/withdrawal/toggle` | POST | تبديل السحب |
| `/api/admin/settings/maintenance` | GET | حالة الصيانة |
| `/api/admin/settings/maintenance/toggle` | POST | تبديل الصيانة |
| `/api/admin/key/create` | POST | إنشاء مفتاح |
| `/api/admin/broadcast` | POST | رسالة جماعية |
| `/api/settings/maintenance` | GET | فحص الصيانة (عام) |

---

## ملاحظات مهمة

1. **ADMIN_TOKEN**: تأكد من تعيين متغير البيئة `ADMIN_TOKEN` في السيرفر
2. **قاعدة البيانات**: تأكد من تشغيل `db.sql` لإضافة الجداول والإعدادات الجديدة
3. **إعادة التشغيل**: يجب إعادة تشغيل السيرفر بعد التحديث

---

## رابط GitHub

تم رفع جميع التحديثات إلى: https://github.com/Jack53616/soon

---

*تاريخ التحديث: 4 فبراير 2026*
