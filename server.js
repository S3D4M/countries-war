import http from 'node:http';
import { readFileSync } from 'node:fs';
import WebSocket, { WebSocketServer } from 'ws';

const USER = (process.env.TIKTOK_USER || '').replace('@', '').trim();
const KEY = process.env.SIGN_API_KEY || '';
const PORT = process.env.PORT || 3000;
const MID = Number(process.env.GIFT_MID || 100);
const BIG = Number(process.env.GIFT_BIG || 1000);
const EULER_URL = 'wss://ws.eulerstream.com';

if (!USER) console.error('ناقص المتغير TIKTOK_USER (اسم حسابك بدون @)');
if (!KEY) console.error('ناقص المتغير SIGN_API_KEY');

const page = readFileSync(new URL('./index.html', import.meta.url));
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/health')) { res.end('ok'); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page);
});
const wss = new WebSocketServer({ server, path: '/ws' });

let status = 'wait';
function send(o) {
  const s = JSON.stringify(o);
  wss.clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(s));
}
function setStatus(s) { status = s; send({ t: 'status', s }); }
function userId(d) {
  return d?.user?.uniqueId || d?.user?.unique_id || d?.user?.unique_id_name ||
    d?.user?.displayId || d?.user?.display_id || d?.userInfo?.uniqueId ||
    d?.userInfo?.unique_id || d?.uniqueId || d?.unique_id;
}
function eventData(m) { return m?.data || m?.message || m?.msg || m?.payload || m; }
function avatarUrl(d) { return d?.user?.profilePictureUrl || d?.user?.profilePicture?.urls?.[0] || d?.userInfo?.profilePictureUrl || d?.avatar || ""; }
function eventType(m) {
  return String(m?.type || m?.event || m?.method || m?.name || '').toLowerCase();
}

wss.on('connection', (ws) => ws.send(JSON.stringify({ t: 'status', s: status })));

let conn = null;
let retryTimer = null;
let stopped = false;
function retry(ms = 10000) {
  if (retryTimer || stopped) return;
  setStatus('wait');
  retryTimer = setTimeout(() => { retryTimer = null; start(); }, ms);
}
function closeConnection() {
  try { conn?.close(); } catch {}
  conn = null;
}

function handleMessage(raw) {
  let packet;
  try { packet = JSON.parse(raw.toString()); } catch { return; }
  const messages = Array.isArray(packet?.messages) ? packet.messages : [packet];
  for (const msg of messages) {
    const d = eventData(msg);
    const type = eventType(msg);
    const who = userId(d) || userId(msg);

    if (type.includes('chat') || type.includes('comment')) {
      const comment = d?.comment || d?.content || d?.message;
      if (who && comment) {
        console.log('تعليق من', who, ':', comment);
        send({ t: 'chat', u: who, c: comment, av: avatarUrl(d) });
      }
      continue;
    }
    if (type.includes('gift')) {
      const giftType = d?.giftType ?? d?.gift_type;
      const repeatEnd = d?.repeatEnd ?? d?.repeat_end;
      if (giftType === 1 && repeatEnd === false) continue;
      const diamondCount = d?.diamondCount || d?.diamond_count || d?.giftDetails?.diamondCount || d?.gift?.diamondCount || 1;
      const repeatCount = d?.repeatCount || d?.repeat_count || 1;
      const diamonds = Number(diamondCount) * Number(repeatCount);
      const k = diamonds >= BIG ? 20 : diamonds >= MID ? 5 : 1;
      if (who) {
        console.log('هدية من', who, 'قيمتها', diamonds);
        send({ t: 'gift', u: who, k, v: diamonds });
      }
      continue;
    }
    if (type.includes('like')) {
      const likes = d?.likeCount || d?.like_count || d?.count || d?.likeNum || d?.like_num || d?.totalLikeCount || d?.total_like_count || 1;
      if (who) {
        console.log('تكبيس من', who, ':', Number(likes) || 1);
        send({ t: 'like', u: who, n: Number(likes) || 1 });
      }
      continue;
    }
    if (type.includes('member') || type.includes('join') || type.includes('roomuser')) {
      if (who) send({ t: 'enter', u: who });
      continue;
    }
    if (type.includes('follow')) {
      if (who) send({ t: 'follow', u: who });
      continue;
    }
    if (type.includes('share')) {
      if (who) send({ t: 'share', u: who });
    }
  }
}

function start() {
  if (!USER || !KEY || stopped || conn) return;
  const url = `${EULER_URL}?uniqueId=${encodeURIComponent(USER)}&apiKey=${encodeURIComponent(KEY)}`;
  console.log('محاولة الاتصال ببث', USER);
  conn = new WebSocket(url);
  conn.on('open', () => { console.log('متصل بالبث عبر Euler WebSocket'); setStatus('live'); });
  conn.on('message', handleMessage);
  conn.on('error', (e) => console.error('خطأ اتصال Euler:', e?.message || e));
  conn.on('close', (code, reason) => {
    const why = reason?.toString() || '';
    console.error('انقطع اتصال Euler:', code, why);
    conn = null;
    retry(code === 4404 ? 15000 : 10000);
  });
}

server.listen(PORT, () => console.log('يعمل على المنفذ ' + PORT));
start();
process.on('SIGTERM', () => { stopped = true; clearTimeout(retryTimer); closeConnection(); server.close(); });
process.on('SIGINT', () => { stopped = true; clearTimeout(retryTimer); closeConnection(); server.close(); });
