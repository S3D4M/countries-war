// جسر مباشر: يقرأ أحداث TikTok ويرسلها بصيغة اللعبة الجديدة
import http from 'node:http';
import { readFileSync } from 'node:fs';
import WebSocket, { WebSocketServer } from 'ws';

const USER = (process.env.TIKTOK_USERNAME || process.env.TIKTOK_USER || 'prnk911').replace(/^@/, '').trim();
const KEY = process.env.EULER_API_KEY || process.env.SIGN_API_KEY || '';
const PORT = process.env.PORT || 3000;
const EULER_URL = 'wss://ws.eulerstream.com';

const page = readFileSync(new URL('./index.html', import.meta.url));
const state = { connected: false, events: 0, last: null, error: null };
let wss;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, user: USER, tiktokConnected: state.connected, viewersPages: wss?.clients.size || 0, events: state.events, lastEvent: state.last, error: state.error }));
    return;
  }
  if (u.pathname === '/' || u.pathname === '/index.html') {
    if (!u.searchParams.has('ws')) { u.searchParams.set('ws', 'auto'); res.writeHead(302, { location: u.pathname + '?' + u.searchParams.toString() }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(page);
    return;
  }
  res.writeHead(404); res.end('not found');
});

wss = new WebSocketServer({ server });
function send(event, data) {
  const msg = JSON.stringify({ event, data });
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(msg);
}
function setConnection(connected, error = null) {
  state.connected = connected; state.error = error; send('status', { connected, user: USER, error });
}
function userId(d) {
  return d?.user?.uniqueId || d?.user?.unique_id || d?.user?.unique_id_name || d?.user?.displayId || d?.user?.display_id || d?.userInfo?.uniqueId || d?.userInfo?.unique_id || d?.uniqueId || d?.unique_id || d?.username;
}
function eventData(m) { return m?.data || m?.message || m?.msg || m?.payload || m; }
function eventType(m) { return String(m?.type || m?.event || m?.method || m?.name || '').toLowerCase(); }

function handleMessage(raw) {
  let packet;
  try { packet = JSON.parse(raw.toString()); } catch { return; }
  const messages = Array.isArray(packet?.messages) ? packet.messages : [packet];
  for (const msg of messages) {
    const d = eventData(msg); const type = eventType(msg); const who = userId(d) || userId(msg);
    if (!who) continue;
    if (type.includes('chat') || type.includes('comment')) {
      const comment = d?.comment || d?.content || d?.message || d?.text;
      if (comment) { state.last = 'chat'; state.events++; console.log('تعليق من', who, ':', comment); send('chat', { uniqueId: who, nickname: who, comment }); }
    } else if (type.includes('gift')) {
      const giftType = d?.giftType ?? d?.gift_type; const repeatEnd = d?.repeatEnd ?? d?.repeat_end;
      if (giftType === 1 && repeatEnd === false) continue;
      const diamonds = Number(d?.diamondCount || d?.diamond_count || d?.giftDetails?.diamondCount || d?.gift?.diamondCount || d?.diamonds || 1) * Number(d?.repeatCount || d?.repeat_count || 1);
      state.last = 'gift'; state.events++; send('gift', { uniqueId: who, nickname: who, diamondCount: diamonds, repeatCount: 1 });
    } else if (type.includes('like')) {
      const likes = Number(d?.likeCount || d?.like_count || d?.count || d?.likeNum || d?.like_num || d?.totalLikeCount || d?.total_like_count || 1) || 1;
      state.last = 'like'; state.events++; console.log('تكبيس من', who, ':', likes); send('like', { uniqueId: who, nickname: who, likeCount: likes });
    } else if (type.includes('member') || type.includes('join') || type.includes('roomuser')) {
      state.last = 'member'; state.events++; send('member', { uniqueId: who, nickname: who });
    }
  }
}

let conn = null; let retryTimer = null; let stopped = false;
function start() {
  if (!KEY || stopped || conn) return;
  const url = `${EULER_URL}?uniqueId=${encodeURIComponent(USER)}&apiKey=${encodeURIComponent(KEY)}`;
  console.log('محاولة الاتصال ببث', USER);
  conn = new WebSocket(url);
  conn.on('open', () => { console.log('اتصال Euler المباشر مفتوح'); setConnection(true); });
  conn.on('message', handleMessage);
  conn.on('error', e => { state.error = String(e?.message || e); console.error('خطأ Euler:', state.error); });
  conn.on('close', (code, reason) => {
    const why = reason?.toString() || ''; conn = null; setConnection(false, `Euler closed ${code}${why ? `: ${why}` : ''}`); console.error(state.error);
    if (!stopped) { clearTimeout(retryTimer); retryTimer = setTimeout(() => { retryTimer = null; start(); }, code === 4404 ? 15000 : 10000); }
  });
}

wss.on('connection', ws => ws.send(JSON.stringify({ event: 'status', data: { connected: state.connected, user: USER, error: state.error } })));
server.listen(PORT, () => { console.log('server on port ' + PORT + ' | account @' + USER); start(); });
process.on('SIGTERM', () => { stopped = true; clearTimeout(retryTimer); try { conn?.close(); } catch {} server.close(); });
process.on('SIGINT', () => { stopped = true; clearTimeout(retryTimer); try { conn?.close(); } catch {} server.close(); });
