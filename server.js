import http from 'node:http';
import { readFileSync } from 'node:fs';
import WebSocket, { WebSocketServer } from 'ws';
import {
  TikTokLiveConnection,
  WebcastEvent,
  ControlEvent
} from 'tiktok-live-connector';

const USER = (process.env.TIKTOK_USER || process.env.TIKTOK_USERNAME || 'prnk911')
  .replace(/^@/, '')
  .trim();
const PORT = process.env.PORT || 3000;
const page = readFileSync(new URL('./index.html', import.meta.url));

const state = { connected: false, events: 0, last: null, error: null };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    });
    res.end(JSON.stringify({
      ok: true,
      user: USER,
      tiktokConnected: state.connected,
      events: state.events,
      lastEvent: state.last,
      error: state.error
    }));
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    if (!url.searchParams.has('ws')) {
      url.searchParams.set('ws', 'auto');
      res.writeHead(302, { location: url.pathname + '?' + url.searchParams.toString() });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    });
    res.end(page);
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

const wss = new WebSocketServer({ server });
function send(event, data) {
  const message = JSON.stringify({ event, data });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}
function userData(data) {
  const user = data?.user || {};
  return {
    uniqueId: user.uniqueId || data?.uniqueId || data?.unique_id || '',
    nickname: user.nickname || user.uniqueId || data?.nickname || data?.uniqueId || ''
  };
}
function setStatus(connected, error = null) {
  state.connected = connected;
  state.error = error;
  send('status', { connected, user: USER, error });
}

let connection = null;
let retryTimer = null;
let stopped = false;
function scheduleReconnect() {
  if (stopped || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connectTikTok();
  }, 30000);
}
function handleError(error) {
  state.error = String(error?.message || error);
  console.error('TikTok connection error:', state.error);
  setStatus(false, state.error);
  scheduleReconnect();
}
function connectTikTok() {
  if (stopped || connection?.isConnected || connection?.isConnecting) return;
  connection = new TikTokLiveConnection(USER, {
    // لا نمرر SIGN_API_KEY هنا حتى لا يعود الاتصال إلى EulerStream.
    processInitialData: false,
    fetchRoomInfoOnConnect: false
  });
  console.log('محاولة اتصال مباشر بحساب', USER);

  connection.on(WebcastEvent.CHAT, data => {
    const u = userData(data);
    if (!u.uniqueId || !data.comment) return;
    state.events++;
    state.last = 'chat';
    console.log('تعليق من', u.uniqueId, ':', data.comment);
    send('chat', { ...u, comment: data.comment });
  });

  connection.on(WebcastEvent.LIKE, data => {
    const u = userData(data);
    if (!u.uniqueId) return;
    state.events++;
    state.last = 'like';
    send('like', { ...u, likeCount: Number(data.likeCount || 1) });
  });

  connection.on(WebcastEvent.GIFT, data => {
    if (data.giftType === 1 && data.repeatEnd === false) return;
    const u = userData(data);
    if (!u.uniqueId) return;
    state.events++;
    state.last = 'gift';
    send('gift', {
      ...u,
      diamondCount: Number(data.diamondCount || data.giftDetails?.diamondCount || 1),
      repeatCount: Number(data.repeatCount || 1)
    });
  });

  connection.on(WebcastEvent.MEMBER, data => {
    const u = userData(data);
    if (!u.uniqueId) return;
    state.events++;
    state.last = 'member';
    send('member', u);
  });

  connection.on(ControlEvent.DISCONNECTED, () => {
    connection = null;
    setStatus(false, 'TikTok disconnected');
    scheduleReconnect();
  });
  connection.on(ControlEvent.ERROR, handleError);

  connection.connect()
    .then(() => {
      state.error = null;
      setStatus(true);
      console.log('TikTok direct connection live:', USER);
    })
    .catch(handleError);
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({
    event: 'status',
    data: { connected: state.connected, user: USER, error: state.error }
  }));
});

server.listen(PORT, () => {
  console.log(`server on port ${PORT} | direct TikTok connector | @${USER}`);
  connectTikTok();
});

function shutdown() {
  stopped = true;
  clearTimeout(retryTimer);
  try { connection?.disconnect(); } catch {}
  server.close();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
