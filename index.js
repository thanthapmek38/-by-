// ============================================================
//  CP Fresh Products LINE Bot
//  ลูกค้าพิมพ์แค่สินค้า → Bot ดึงชื่อ LINE เอง → ส่งกลุ่มแอดมิน
// ============================================================

const express = require('express');
const line = require('@line/bot-sdk');

const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET || 'YOUR_CHANNEL_SECRET',
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'YOUR_CHANNEL_ACCESS_TOKEN',
};

const ADMIN_GROUP_ID = process.env.LINE_ADMIN_GROUP_ID || 'YOUR_ADMIN_GROUP_ID';

const client = new line.Client(config);

// ─── HELPERS ────────────────────────────────────────────────
function thaiTime() {
  return new Date().toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── ตรวจว่าข้อความเป็นออเดอร์สินค้า ───────────────────────
// มีตัวเลข (จำนวน) อย่างน้อย 1 บรรทัด
function isOrderMessage(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.some(l => /\d/.test(l));
}

// ─── MAIN EVENT HANDLER ─────────────────────────────────────
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const text = event.message.text.trim();
  const userId = event.source.userId;
  const groupId = event.source.groupId;

  // ── ส่ง Group ID ทาง DM (สำหรับตั้งค่า) ──
  if (event.source.type === 'group') {
    console.log(`GROUP ID: ${groupId}`);
    // ถ้าพิมพ์ /groupid ให้ส่ง DM
    if (text === '/groupid') {
      try {
        await client.pushMessage(userId, {
          type: 'text',
          text: `Group ID: ${groupId}`,
        });
      } catch (_) {}
      return;
    }
  }

  // ── กลุ่มแอดมิน ──
  if (event.source.type === 'group' && groupId === ADMIN_GROUP_ID) return;

  // ── กลุ่มลูกค้า ──
  if (event.source.type === 'group' && groupId !== ADMIN_GROUP_ID) {
    if (!isOrderMessage(text)) return;

    const replyToken = event.replyToken;

    // ดึงชื่อ LINE และชื่อกลุ่ม
    let memberName = 'ไม่ทราบ';
    let groupName = 'ไม่ทราบ';
    try {
      const [profile, summary] = await Promise.all([
        client.getGroupMemberProfile(groupId, userId),
        client.getGroupSummary(groupId),
      ]);
      memberName = profile.displayName;
      groupName = summary.groupName;
    } catch (_) {}

    const time = thaiTime();
    const items = text.split('\n').map(l => l.trim()).filter(Boolean);
    const itemLines = items.map((item, i) => `  ${i+1}. ${item}`).join('\n');
    const div = '─'.repeat(28);

    // ── ส่งไปกลุ่มแอดมิน ──
    const adminMsg = [
      `🔔 ออเดอร์ใหม่!`,
      div,
      `🏪 กลุ่ม  : ${groupName}`,
      `👤 ชื่อ   : ${memberName}`,
      `🕐 เวลา   : ${time}`,
      div,
      `📋 รายการสินค้า`,
      itemLines,
      div,
    ].join('\n');

    await client.pushMessage(ADMIN_GROUP_ID, { type: 'text', text: adminMsg });

    // ── ตอบกลับในกลุ่มลูกค้า ──
    await client.replyMessage(replyToken, {
      type: 'text',
      text: [
        `✅ รับออเดอร์แล้วค่ะ`,
        `👤 ${memberName}`,
        div,
        itemLines,
        div,
        `🕐 ${time}`,
        `ทางร้านจะแจ้งยืนยันกลับนะคะ 🙏`,
      ].join('\n'),
    });
  }
}

// ─── SERVER ─────────────────────────────────────────────────
const app = express();
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.json({ status: 'ok' }))
    .catch(err => { console.error(err); res.status(500).end(); });
});

app.get('/', (_, res) => res.send('CP Fresh Bot is running 🚀'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ CP Bot running on port ${PORT}`));
