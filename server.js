import http from 'node:http';
import { readFileSync } from 'node:fs';
import WebSocket, { WebSocketServer } from 'ws';

const USER = (process.env.TIKTOK_USER || '').replace('@', '').trim();
const KEY = process.env.SIGN_API_KEY || '';
const PORT = process.env.PORT || 3000;
const MID = Number(process.env.GIFT_MID || 100);
const BIG = Number(process.env.GIFT_BIG || 1000);
const EULER_URL = 'wss://ws.eulerstream.com';

if (!USER) console.error('ناقص المتغير TIKTOK_USER');
if (!KEY) console.error('ناقص المتغير SIGN_API_KEY');

const page = readFileSync(new URL('./index.html', import.meta.url));
const sseClients = new Set();
let status = 'wait';
let conn = null;
let retryTimer = null;
let stopped = false;

function userId(d) {
  return d?.user?.uniqueId || d?.user?.unique_id || d?.user?.unique_id_name ||
    d?.user?.displayId || d?.user?.display_id || d?.uniqueId || d?.unique_id || 'viewer';
}
function eventData(m) { return m?.data || m?.message || m; }
function eventType(m) { return String(m?.type || m?.event || m?.method || m?.name || '').toLowerCase(); }
function emit(ev) {
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  sseClients.forEach((res) => res.write(line));
  console.log('event', JSON.stringify(ev));
}
function setStatus(s) { status = s; }
function retry(ms = 10000) {
  if (retryTimer || stopped) return;
  setStatus('wait');
  retryTimer = setTimeout(() => { retryTimer = null; start(); }, ms);
}
function handleMessage(raw) {
  let packet;
  try { packet = JSON.parse(raw.toString()); } catch { return; }
  const messages = Array.isArray(packet?.messages) ? packet.messages : [packet];
  for (const msg of messages) {
    const d = eventData(msg);
    const type = eventType(msg);
    const user = userId(d) || userId(msg);
    if (type.includes('chat') || type.includes('comment')) {
      const text = d?.comment || d?.content || d?.message || '';
      if (text) emit({ type: 'comment', user, text });
      continue;
    }
    if (type.includes('gift')) {
      const giftType = d?.giftType ?? d?.gift_type;
      const repeatEnd = d?.repeatEnd ?? d?.repeat_end;
      if (giftType === 1 && repeatEnd === false) continue;
      const diamonds = Number(d?.diamondCount || d?.diamond_count || d?.giftDetails?.diamondCount || d?.gift?.diamondCount || 1) * Number(d?.repeatCount || d?.repeat_count || 1);
      const giftName = String(d?.giftName || d?.gift_name || d?.giftDetails?.giftName || d?.gift?.name || '').toLowerCase();
      emit({ type: 'gift', user, gift: giftName === 'rose' ? 'rose' : giftName, count: Number(d?.repeatCount || d?.repeat_count || 1), diamonds });
      continue;
    }
    if (type.includes('follow')) { emit({ type: 'follow', user }); continue; }
    if (type.includes('share')) { emit({ type: 'share', user }); continue; }
    if (type.includes('like')) { emit({ type: 'like', user, count: d?.likeCount || d?.like_count || 1 }); }
  }
}
function start() {
  if (!USER || !KEY || stopped || conn) return;
  const url = `${EULER_URL}?uniqueId=${encodeURIComponent(USER)}&apiKey=${encodeURIComponent(KEY)}`;
  console.log('محاولة الاتصال ببث', USER);
  conn = new WebSocket(url);
  conn.on('open', () => { setStatus('live'); console.log('متصل بالبث عبر Euler WebSocket'); });
  conn.on('message', handleMessage);
  conn.on('error', (e) => console.error('خطأ اتصال Euler:', e?.message || e));
  conn.on('close', (code, reason) => { console.error('انقطع اتصال Euler:', code, reason?.toString() || ''); conn = null; retry(code === 4404 ? 15000 : 10000); });
}
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/health')) { res.writeHead(200, {'content-type':'text/plain'}); return res.end('status: ' + status + ' | viewers on page: ' + sseClients.size); }
  if (req.url.startsWith('/events')) {
    res.writeHead(200, {'content-type':'text/event-stream', 'cache-control':'no-cache', connection:'keep-alive', 'access-control-allow-origin':'*'});
    res.write(': ok\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  res.writeHead(200, {'content-type':'text/html; charset=utf-8'});
  res.end(page);
});
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => ws.send(JSON.stringify({ t: 'status', s: status })));
setInterval(() => sseClients.forEach((res) => res.write(': ping\n\n')), 20000);
server.listen(PORT, () => { console.log('يعمل على المنفذ ' + PORT); start(); });
process.on('SIGTERM', () => { stopped = true; clearTimeout(retryTimer); conn?.close(); server.close(); });
process.on('SIGINT', () => { stopped = true; clearTimeout(retryTimer); conn?.close(); server.close(); });
