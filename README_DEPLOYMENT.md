# 🚀 دليل النشر الكامل - QL Trading AI v2.4

## 📋 المحتويات
1. [المتطلبات](#المتطلبات)
2. [إعداد قاعدة البيانات](#إعداد-قاعدة-البيانات)
3. [إعداد Telegram Bot](#إعداد-telegram-bot)
4. [المتغيرات البيئية](#المتغيرات-البيئية)
5. [النشر على Render](#النشر-على-render)
6. [الاختبار](#الاختبار)
7. [حل المشاكل](#حل-المشاكل)

---

## 🔧 المتطلبات

### 1. قاعدة بيانات PostgreSQL
- يمكنك استخدام:
  - [Render PostgreSQL](https://render.com) (مجاني)
  - [Supabase](https://supabase.com) (مجاني)
  - [ElephantSQL](https://www.elephantsql.com) (مجاني)
  - [Neon](https://neon.tech) (مجاني)

### 2. Telegram Bot
- احصل على Bot Token من [@BotFather](https://t.me/BotFather)

### 3. حساب Render
- سجل في [Render.com](https://render.com) (مجاني)

---

## 🗄️ إعداد قاعدة البيانات

### الخطوة 1: إنشاء قاعدة بيانات

#### على Render:
1. اذهب إلى [Render Dashboard](https://dashboard.render.com)
2. اضغط **New** → **PostgreSQL**
3. اختر:
   - **Name**: `ql-trading-db`
   - **Database**: `ql_trading`
   - **User**: `ql_user`
   - **Region**: أقرب منطقة لك
   - **Plan**: **Free**
4. اضغط **Create Database**
5. انسخ **Internal Database URL** (سنحتاجها لاحقاً)

#### على Supabase:
1. اذهب إلى [Supabase Dashboard](https://app.supabase.com)
2. اضغط **New Project**
3. املأ البيانات واضغط **Create**
4. من **Settings** → **Database**
5. انسخ **Connection String** (URI format)

### الخطوة 2: تشغيل SQL Schema

1. افتح **SQL Editor** في Render أو Supabase
2. انسخ محتوى ملف `db.sql`
3. الصقه في SQL Editor
4. اضغط **Run** أو **Execute**

**أو** استخدم psql من Terminal:
```bash
psql "YOUR_DATABASE_URL" -f db.sql
```

---

## 🤖 إعداد Telegram Bot

### الخطوة 1: إنشاء Bot

1. افتح Telegram وابحث عن [@BotFather](https://t.me/BotFather)
2. أرسل `/newbot`
3. اختر اسم للبوت (مثال: `QL Trading AI`)
4. اختر username (يجب أن ينتهي بـ `bot`، مثال: `ql_trading_bot`)
5. احفظ **Bot Token** الذي سيرسله لك

### الخطوة 2: الحصول على Telegram ID الخاص بك

1. افتح [@userinfobot](https://t.me/userinfobot)
2. أرسل `/start`
3. احفظ **Your ID** (هذا هو ADMIN_ID)

### الخطوة 3: تفعيل Inline Mode (اختياري)

1. أرسل لـ [@BotFather](https://t.me/BotFather): `/setinline`
2. اختر البوت الخاص بك
3. أرسل placeholder text (مثال: `Search...`)

---

## 🔐 المتغيرات البيئية

### ملف `.env` للتطوير المحلي:

```env
# Telegram Bot
BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
ADMIN_ID=123456789
WEBHOOK_URL=https://your-app-name.onrender.com

# Database
DATABASE_URL=postgresql://user:password@host:5432/database
PGSSLMODE=true

# Security
JWT_SECRET=ql_secret_2025_CHANGE_THIS
ADMIN_TOKEN=ql_admin_2025_CHANGE_THIS

# Server
PORT=10000
NODE_ENV=production
```

### ⚠️ مهم:
- **BOT_TOKEN**: من [@BotFather](https://t.me/BotFather)
- **ADMIN_ID**: Telegram ID الخاص بك
- **DATABASE_URL**: من Render أو Supabase
- **WEBHOOK_URL**: رابط تطبيقك على Render (سنحصل عليه بعد النشر)
- **JWT_SECRET**: غيّره لشيء عشوائي وقوي
- **ADMIN_TOKEN**: غيّره لشيء عشوائي وقوي

---

## 🚀 النشر على Render

### الخطوة 1: رفع الكود على GitHub

```bash
# إذا لم يكن لديك Git repository
cd /workspace/ql_soon_project
git init
git add .
git commit -m "Initial commit - QL Trading AI v2.4"

# إنشاء repository على GitHub
# اذهب إلى github.com → New Repository
# اسم الـ repo: ql-trading-ai

# ربط الـ repo المحلي بـ GitHub
git remote add origin https://github.com/YOUR_USERNAME/ql-trading-ai.git
git branch -M main
git push -u origin main
```

### الخطوة 2: إنشاء Web Service على Render

1. اذهب إلى [Render Dashboard](https://dashboard.render.com)
2. اضغط **New** → **Web Service**
3. اختر **Connect a repository**
4. اختر الـ repository: `ql-trading-ai`
5. املأ البيانات:
   - **Name**: `ql-trading-ai`
   - **Region**: نفس منطقة قاعدة البيانات
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: **Free**

### الخطوة 3: إضافة Environment Variables

في صفحة Web Service، اذهب إلى **Environment**:

```
BOT_TOKEN = 1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
ADMIN_ID = 123456789
WEBHOOK_URL = https://ql-trading-ai.onrender.com
DATABASE_URL = postgresql://user:password@host:5432/database
PGSSLMODE = true
JWT_SECRET = ql_secret_2025_CHANGE_THIS
ADMIN_TOKEN = ql_admin_2025_CHANGE_THIS
PORT = 10000
NODE_ENV = production
```

⚠️ **مهم**: استبدل القيم بالقيم الحقيقية الخاصة بك!

### الخطوة 4: النشر

1. اضغط **Create Web Service**
2. انتظر حتى ينتهي البناء (3-5 دقائق)
3. بعد النجاح، احفظ رابط التطبيق (مثال: `https://ql-trading-ai.onrender.com`)

### الخطوة 5: تحديث WEBHOOK_URL

1. ارجع إلى **Environment Variables**
2. عدّل `WEBHOOK_URL` إلى رابط تطبيقك الفعلي
3. احفظ التغييرات (سيعيد النشر تلقائياً)

---

## ✅ الاختبار

### 1. تحقق من الصحة

افتح المتصفح واذهب إلى:
```
https://your-app-name.onrender.com/health
```

يجب أن ترى:
```json
{
  "ok": true,
  "status": "running",
  "timestamp": "2025-12-03T23:45:00.000Z"
}
```

### 2. اختبار الأسعار

```
https://your-app-name.onrender.com/api/markets
```

يجب أن ترى:
```json
{
  "ok": true,
  "marketClosed": false,
  "data": {
    "XAUUSD": 2653.45,
    "XAGUSD": 24.12,
    "BTCUSDT": 43250.50,
    "ETHUSDT": 2315.80
  }
}
```

### 3. اختبار Telegram Bot

1. افتح Telegram
2. ابحث عن البوت الخاص بك
3. أرسل `/start`
4. يجب أن يرد البوت بالرسالة الترحيبية

### 4. اختبار الأوامر

```bash
# التسجيل
/start

# الإيداع (للأدمن فقط)
/deposit 123456789 1000

# فتح صفقة (للأدمن فقط)
/open 123456789 2 10

# عرض الرصيد
/balance

# عرض الصفقات
/trades
```

---

## 🐛 حل المشاكل

### المشكلة 1: البوت لا يرد

**الأسباب المحتملة:**
- BOT_TOKEN خاطئ
- WEBHOOK_URL خاطئ
- التطبيق لم يبدأ بشكل صحيح

**الحل:**
1. تحقق من Logs في Render
2. تأكد من BOT_TOKEN صحيح
3. تأكد من WEBHOOK_URL يطابق رابط التطبيق
4. أعد نشر التطبيق

### المشكلة 2: خطأ في قاعدة البيانات

**الأسباب المحتملة:**
- DATABASE_URL خاطئ
- قاعدة البيانات غير متاحة
- Schema لم يُنفذ

**الحل:**
1. تحقق من DATABASE_URL في Environment Variables
2. تأكد من تشغيل `db.sql`
3. تحقق من اتصال قاعدة البيانات في Logs

### المشكلة 3: الأسعار لا تتحدث

**الأسباب المحتملة:**
- مشكلة في الاتصال بـ Binance API
- Trading Engine لم يبدأ

**الحل:**
1. تحقق من Logs
2. تأكد من رؤية: `🤖 Trading engine started with real Binance prices`
3. تحقق من `/api/markets` endpoint

### المشكلة 4: الصفقات لا تُغلق تلقائياً

**الأسباب المحتملة:**
- Trading Engine متوقف
- خطأ في حساب PnL

**الحل:**
1. تحقق من Logs للأخطاء
2. تأكد من رؤية: `✅ Trade #X closed by TARGET/DURATION`
3. أعد تشغيل التطبيق

---

## 📊 مراقبة الأداء

### Render Logs

1. اذهب إلى [Render Dashboard](https://dashboard.render.com)
2. اختر Web Service الخاص بك
3. اضغط **Logs**
4. راقب:
   - `🟢 QL Trading AI Server started`
   - `✅ Telegram webhook set`
   - `🤖 Trading engine started`
   - `✅ Trade #X closed`

### Metrics

في Render Dashboard → **Metrics**:
- **CPU Usage**: يجب أن يكون < 50%
- **Memory**: يجب أن يكون < 256 MB
- **Response Time**: يجب أن يكون < 1s

---

## 🔄 التحديثات

### تحديث الكود:

```bash
# في المشروع المحلي
git add .
git commit -m "Update: description of changes"
git push origin main

# Render سيعيد النشر تلقائياً
```

### تحديث قاعدة البيانات:

```bash
# إذا أضفت جداول أو أعمدة جديدة
psql "YOUR_DATABASE_URL" -f migrations/new_migration.sql
```

---

## 📞 الدعم

### روابط مفيدة:
- [Render Docs](https://render.com/docs)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [PostgreSQL Docs](https://www.postgresql.org/docs/)
- [Node.js Docs](https://nodejs.org/docs/)

### إذا واجهت مشكلة:
1. تحقق من Logs في Render
2. تحقق من Environment Variables
3. تحقق من قاعدة البيانات
4. راجع هذا الدليل
5. ابحث عن الخطأ في Google

---

## 🎉 تم بنجاح!

إذا اتبعت كل الخطوات، يجب أن يكون لديك الآن:

✅ تطبيق يعمل على Render  
✅ قاعدة بيانات PostgreSQL نشطة  
✅ Telegram Bot يستجيب للأوامر  
✅ أسعار حقيقية من Binance  
✅ نظام تداول كامل يعمل 24/7  

---

**تم التطوير بواسطة:** Alex (MetaGPT Engineer)  
**التاريخ:** 2025-12-03  
**الإصدار:** v2.4  

🚀 **مبروك! المشروع جاهز للإنتاج!** 🎯