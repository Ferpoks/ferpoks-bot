// netlify/functions/salla-webhook.js
const twilio = require('twilio');

exports.handler = async (event, context) => {
  try {
    // تحقق من السر
    const incomingSecret = event.headers['x-webhook-secret'] || event.headers['X-Webhook-Secret'] || '';
    const expected = process.env.SALLA_WEBHOOK_SECRET || '';
    if (!expected || incomingSecret !== expected) {
      console.log('Forbidden: bad secret', { incomingSecret });
      return { statusCode: 403, body: 'Forbidden' };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const body = JSON.parse(event.body || '{}');

    // دوال مساعدة لالتقاط قيم من مسارات متعددة
    const pick = (...candidates) => {
      for (const c of candidates) {
        if (c !== undefined && c !== null && c !== '') return c;
      }
      return undefined;
    };

    // حاول نكتشف إذا اللي جانا "طلب" أو "فاتورة" أو payload عام بداخل data
    const data = body.data || body.order || body.invoice || body;

    // مسارات محتملة لرقم العميل
    const rawPhone = pick(
      data?.customer?.mobile,
      data?.customer?.phone,
      data?.order?.customer?.mobile,
      body?.order?.customer?.mobile,
      body?.invoice?.customer?.mobile
    );

    if (!rawPhone) {
      console.log('No phone found in payload', body);
      return { statusCode: 200, body: 'No phone in payload, skipped.' };
    }

    // تأكد من صيغة واتساب
    const toWhatsApp = rawPhone.startsWith('whatsapp:')
      ? rawPhone
      : `whatsapp:${rawPhone}`;

    const customerName = pick(
      data?.customer?.name,
      data?.order?.customer?.name,
      body?.order?.customer?.name,
      body?.invoice?.customer?.name,
      'عميل سلة'
    );

    const orderId = pick(
      data?.id,
      data?.order_id,
      data?.order?.id,
      body?.order?.id,
      body?.invoice?.id
    );

    const amount = pick(
      data?.total, data?.amount, data?.grand_total, data?.payment_total
    );

    // حدد نوع الرسالة حسب الموجود
    const hasInvoice = !!(body.invoice || data?.invoice_type || body?.data?.invoice);
    const hasOrder = !!(body.order || data?.items || body?.data?.order);

    const title = hasInvoice ? 'فاتورة جديدة' : (hasOrder ? 'طلب جديد' : 'حدث جديد');

    const message =
      `${title} #${orderId ?? ''}\n` +
      `العميل: ${customerName}\n` +
      (amount ? `المبلغ: ${amount}\n` : '') +
      `سنقوم بالتحديث برسالة أخرى عند تغيّر الحالة.\n\n` +
      `— نظام واتس بوت فيربوكس`;

    // أرسل واتساب عبر Twilio
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const res = await client.messages.create({
      from: process.env.TWILIO_FROM, // مثال Sandbox: whatsapp:+14155238886
      to: toWhatsApp,               // مثال: whatsapp:+9665XXXXXXXX
      body: message
    });

    console.log('Twilio queued:', res.sid);
    return { statusCode: 200, body: 'ok' };

  } catch (err) {
    console.error('Handler error', err);
    return { statusCode: 500, body: 'Internal Error' };
  }
};
