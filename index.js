// ============================================================
//  CP Fresh Products LINE Bot
//  รับออเดอร์จากทุกกลุ่มลูกค้า → ส่งสรุปไปกลุ่มแอดมิน/คลัง
// ============================================================

const express = require('express');
const line = require('@line/bot-sdk');

// ─── CONFIG ─────────────────────────────────────────────────
const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET || 'YOUR_CHANNEL_SECRET',
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'YOUR_CHANNEL_ACCESS_TOKEN',
};

// กลุ่มแอดมิน/คลัง — Bot จะ push สรุปออเดอร์มาที่นี่
const ADMIN_GROUP_ID = process.env.LINE_ADMIN_GROUP_ID || 'YOUR_ADMIN_GROUP_ID';

// ─── รอบส่งของ ───────────────────────────────────────────────
const DELIVERY_ROUNDS = [
  { id: 'morning',   label: 'รอบเช้า',  deliveryTime: '08:00', cutoffTime: '06:00' },
  { id: 'afternoon', label: 'รอบบ่าย',  deliveryTime: '13:00', cutoffTime: '11:00' },
  { id: 'evening',   label: 'รอบเย็น',  deliveryTime: '18:00', cutoffTime: '16:00' },
];

// ─── ORDER STORE ─────────────────────────────────────────────
const orders = {};
let orderCounter = 1;

// ─── HELPERS ─────────────────────────────────────────────────
function genOrderId() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  return `CP${ymd}-${String(orderCounter++).padStart(4,'0')}`;
}

function thaiTime() {
  return new Date().toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function getAvailableRounds() {
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  return DELIVERY_ROUNDS.filter(r => hhmm < r.cutoffTime);
}

// ─── PARSE ชื่อ + รายการออเดอร์ ─────────────────────────────
// รูปแบบ:
//   บรรทัดแรก  = ชื่อลูกค้า (ไม่มีตัวเลข)
//   บรรทัดถัดไป = รายการสินค้า เช่น "หมูบด 50 กก"
function parseOrderMessage(text) {
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const firstLine = lines[0];
  // บรรทัดแรกต้องไม่มีตัวเลข และความยาวสมเหตุสมผล
  if (/\d/.test(firstLine) || firstLine.length > 60) return null;

  const items = lines.slice(1);
  // ต้องมีอย่างน้อย 1 รายการที่มีตัวเลข (จำนวน)
  if (!items.some(l => /\d/.test(l))) return null;

  return { name: firstLine, items };
}

// ─── ข้อความตอบกลับในกลุ่มลูกค้า ────────────────────────────
function buildCustomerReply(orderId, name, items, round) {
  const itemLines = items.map((item, i) => `  ${i+1}. ${item}`).join('\n');
  return [
    `✅ รับออเดอร์แล้วค่ะ!`,
    `👤 ${name}`,
    `─────────────────────`,
    itemLines,
    `─────────────────────`,
    `🚚 ${round.label} (ส่ง ${round.deliveryTime} น.)`,
    `📌 เลขออเดอร์: #${orderId}`,
    ``,
    `ทางร้านจะแจ้งยืนยันกลับนะคะ 🙏`,
  ].join('\n');
}

// ─── ข้อความส่งไปกลุ่มแอดมิน ────────────────────────────────
function buildAdminMessage(orderId, name, items, round, senderName, groupName) {
  const itemLines = items.map((item, i) => `  ${i+1}. ${item}`).join('\n');
  const div = '─'.repeat(28);
  return [
    `🔔 ออเดอร์ใหม่ #${orderId}`,
    div,
    `🏪 กลุ่ม   : ${groupName}`,
    `👤 ลูกค้า  : ${name}`,
    `📱 LINE    : ${senderName}`,
    `🕐 เวลา    : ${thaiTime()}`,
    `🚚 รอบส่ง  : ${round.label} (${round.deliveryTime} น.)`,
    div,
    `📋 รายการสินค้า`,
    itemLines,
    div,
    `⏳ สถานะ: รอดำเนินการ`,
    ``,
    `พิมพ์ "รับ #${orderId}" หรือ "ยกเลิก #${orderId}"`,
  ].join('\n');
}

// ─── MAIN EVENT HANDLER ──────────────────────────────────────
const client = new line.Client(config);

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const text = event.message.text.trim();
  const userId = event.source.userId;
  const groupId = event.source.groupId;

  // ส่ง Group ID มาหาคนที่พิมพ์ทาง DM
  if (event.source.type === 'group') {
    console.log(`==== GROUP ID: ${groupId} ====`);
    try {
      await client.pushMessage(userId, {
        type: 'text',
        text: `🔔 Group ID ของกลุ่มนี้คือ:

${groupId}

นำไปใส่ใน LINE_ADMIN_GROUP_ID ใน Railway ได้เลยครับ`,
      });
    } catch (_) {}
  }

  // ════════════════════════════════════════════════════
  //  กลุ่มแอดมิน: รับ / ยกเลิก ออเดอร์
  // ════════════════════════════════════════════════════
  if (event.source.type === 'group' && groupId === ADMIN_GROUP_ID) {
    const replyToken = event.replyToken;

    // รับออเดอร์
    const acceptMatch = text.match(/^รับ #(CP\d{8}-\d{4})$/);
    if (acceptMatch) {
      const orderId = acceptMatch[1];
      const order = orders[orderId];
      if (!order) return client.replyMessage(replyToken, { type: 'text', text: `❌ ไม่พบออเดอร์ #${orderId}` });
      if (order.status !== 'pending') return client.replyMessage(replyToken, { type: 'text', text: `⚠️ ออเดอร์ #${orderId} อัปเดตไปแล้ว (${order.status})` });

      order.status = 'confirmed';

      // แจ้งกลับในกลุ่มลูกค้าที่ออเดอร์มา
      await client.pushMessage(order.sourceGroupId, {
        type: 'text',
        text: [
          `✅ ยืนยันออเดอร์แล้วค่ะ`,
          `👤 ${order.name}`,
          `📌 #${orderId}`,
          `🚚 ${order.round.label} (ส่ง ${order.round.deliveryTime} น.)`,
          `📦 กำลังจัดเตรียมสินค้าให้ค่ะ 🙏`,
        ].join('\n'),
      });

      return client.replyMessage(replyToken, {
        type: 'text',
        text: `✅ รับออเดอร์ #${orderId} แล้ว\n🏪 กลุ่ม: ${order.groupName}\n👤 ${order.name}\n\nแจ้งกลุ่มลูกค้าแล้ว`,
      });
    }

    // ยกเลิกออเดอร์
    const cancelMatch = text.match(/^ยกเลิก #(CP\d{8}-\d{4})$/);
    if (cancelMatch) {
      const orderId = cancelMatch[1];
      const order = orders[orderId];
      if (!order) return client.replyMessage(replyToken, { type: 'text', text: `❌ ไม่พบออเดอร์ #${orderId}` });

      order.status = 'cancelled';

      await client.pushMessage(order.sourceGroupId, {
        type: 'text',
        text: [
          `❌ ขออภัยค่ะ ออเดอร์ถูกยกเลิก`,
          `👤 ${order.name}`,
          `📌 #${orderId}`,
          `กรุณาติดต่อร้านค้าเพื่อสอบถามเพิ่มเติมนะคะ`,
        ].join('\n'),
      });

      return client.replyMessage(replyToken, {
        type: 'text',
        text: `❌ ยกเลิกออเดอร์ #${orderId} แล้ว\n🏪 กลุ่ม: ${order.groupName}\n👤 ${order.name}\n\nแจ้งกลุ่มลูกค้าแล้ว`,
      });
    }

    return; // ข้อความอื่นในกลุ่มแอดมิน → ไม่ทำอะไร
  }

  // ════════════════════════════════════════════════════
  //  ทุกกลุ่มที่ไม่ใช่กลุ่มแอดมิน = กลุ่มลูกค้า
  // ════════════════════════════════════════════════════
  if (event.source.type === 'group' && groupId !== ADMIN_GROUP_ID) {
    const replyToken = event.replyToken;

    const parsed = parseOrderMessage(text);
    if (!parsed) return; // ข้อความทั่วไปในกลุ่ม → ไม่ทำอะไร

    const { name, items } = parsed;

    // เช็คว่ายังมีรอบรับออเดอร์อยู่ไหม
    const availableRounds = getAvailableRounds();
    if (availableRounds.length === 0) {
      return client.replyMessage(replyToken, {
        type: 'text',
        text: `⚠️ ขออภัยค่ะ ปิดรับออเดอร์ทุกรอบแล้วสำหรับวันนี้\nกรุณาสั่งใหม่พรุ่งนี้ตั้งแต่ 06:00 น. นะคะ`,
      });
    }
    const round = availableRounds[0];

    // ดึงชื่อ LINE และชื่อกลุ่ม
    let senderName = 'ไม่ทราบ';
    let groupName = 'ไม่ทราบ';
    try {
      const [memberProfile, groupSummary] = await Promise.all([
        client.getGroupMemberProfile(groupId, userId),
        client.getGroupSummary(groupId),
      ]);
      senderName = memberProfile.displayName;
      groupName = groupSummary.groupName;
    } catch (_) {}

    const orderId = genOrderId();

    // บันทึกออเดอร์ พร้อม sourceGroupId เพื่อแจ้งกลับถูกกลุ่ม
    orders[orderId] = {
      orderId,
      userId,
      name,
      senderName,
      groupName,
      sourceGroupId: groupId,   // ← จำไว้ว่าออเดอร์นี้มาจากกลุ่มไหน
      items,
      round,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    // ตอบกลับในกลุ่มลูกค้า
    await client.replyMessage(replyToken, {
      type: 'text',
      text: buildCustomerReply(orderId, name, items, round),
    });

    // ส่งสรุปไปกลุ่มแอดมิน
    await client.pushMessage(ADMIN_GROUP_ID, {
      type: 'text',
      text: buildAdminMessage(orderId, name, items, round, senderName, groupName),
    });

    return;
  }
}

// ─── SERVER ──────────────────────────────────────────────────
const app = express();
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.json({ status: 'ok' }))
    .catch(err => { console.error(err); res.status(500).end(); });
});

app.get('/', (_, res) => res.send('CP Fresh Bot is running 🚀'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ CP Bot running on port ${PORT}`));
