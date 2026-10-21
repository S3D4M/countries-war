// سيرفر وسيط: يقرأ تعليقات وهدايا بثك من تيك توك ويبعتها لصفحة اللعبة
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import * as zlib from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { createWebSocketUrl } from '@eulerstream/euler-websocket-sdk';
import * as Proto from 'tiktok-live-proto/v2';
import { normalize } from './normalize.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const USER = (process.env.TIKTOK_USERNAME || process.env.TIKTOK_USER || 'prnk911').replace(/^@/, '');
const PORT = process.env.PORT || 3000;
const DEBUG = process.env.DEBUG === '1';
const unzip = promisify(zlib.unzip);
const html = fs.readFileSync(path.join(dir, 'index.html'));
const routes = fs.readFileSync(path.join(dir, 'manus-routes.json'));
const state = { connected: false, last: null, error: null, events: 0 };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, user: USER, tiktokConnected: state.connected, viewersPages: wss.clients.size, events: state.events, lastEvent: state.last, error: state.error }));
    return;
  }
  if (u.pathname === '/manus-routes.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(routes);
    return;
  }
  if (u.pathname === '/' || u.pathname === '/index.html') {
    if (!u.searchParams.has('ws')) { u.searchParams.set('ws', 'auto'); res.writeHead(302, { Location: u.pathname + '?' + u.searchParams.toString() }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
    return;
  }
  res.writeHead(404); res.end('not found');
});

const wss = new WebSocketServer({ server });
setInterval(() => wss.clients.forEach(c => c.readyState === 1 && c.ping()), 25000);

function send(event, data) {
  const msg = JSON.stringify({ event, data });
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}

function sendStatus() {
  send('status', { connected: state.connected, user: USER, error: state.error });
}

let conn = null, retrying = false;
function retry() {
  if (retrying) return;
  retrying = true;
  setTimeout(() => { retrying = false; run(); }, 5000);
}
function relayEventName(type) {
  if (/ChatMessage$/i.test(type)) return 'chat';
  if (/GiftMessage$/i.test(type)) return 'gift';
  if (/LikeMessage$/i.test(type)) return 'like';
  if (/MemberMessage$/i.test(type)) return 'member';
  return null;
}
async function decodeRelayFrame(raw) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (!bytes.length || bytes[0] === 123) return [];
  const frame = Proto.WebcastPushFrame.decode(bytes);
  let payload = Buffer.from(frame.payload || []);
  if (payload[0] === 31 && payload[1] === 139 && payload[2] === 8) payload = await unzip(payload);
  const batch = Proto.ProtoMessageFetchResult.decode(payload);
  return (batch.messages || []).flatMap(message => {
    const Type = Proto[message.type];
    if (!Type || !message.payload) return [];
    try { return [{ type: message.type, data: Type.decode(message.payload) }]; } catch (_) { return []; }
  });
}
async function run() {
  const apiKey = process.env.EULER_API_KEY || process.env.SIGN_API_KEY;
  if (!apiKey) { state.error = 'EULER_API_KEY or SIGN_API_KEY is not configured'; sendStatus(); return; }
  try { conn && conn.close && conn.close(); } catch (_) {}
  const url = createWebSocketUrl({ uniqueId: USER, apiKey, features: { schemaVersion: 'v2', bundleEvents: true, syntheticPresence: true, rawMessages: false } });
  conn = new WebSocket(url);
  conn.binaryType = 'arraybuffer';
  conn.on('open', () => { state.connected = false; state.error = null; sendStatus(); console.log('Euler Relay socket open; waiting for live confirmation @' + USER); });
  conn.on('message', async raw => {
    try {
      const messages = await decodeRelayFrame(raw);
      if (!state.connected) { state.connected = true; state.error = null; sendStatus(); console.log('Euler Relay confirmed live @' + USER); }
      for (const message of messages) {
        const type = message.type || '';
        const name = relayEventName(type);
        const data = message.data;
        if (DEBUG) console.log(type, JSON.stringify(data).slice(0, 700));
        if (!name || !data) continue;
        const n = normalize(name, data);
        if (n) { state.last = name; state.events++; send(n.event, n.data); }
      }
    } catch (e) { state.error = `relay decode: ${String(e.message || e)}`; console.error(state.error); }
  });
  conn.on('close', (code, reason) => { state.connected = false; state.error = `Euler Relay closed ${code}${reason ? `: ${reason}` : ''}`; sendStatus(); console.log(state.error); retry(); });
  conn.on('error', e => { state.error = String((e && e.message) || e); sendStatus(); console.error('Euler Relay error:', state.error); });
}

wss.on('connection', ws => {
  if (ws.readyState === 1) ws.send(JSON.stringify({ event: 'status', data: { connected: state.connected, user: USER, error: state.error } }));
});

server.listen(PORT, () => { console.log('server on port ' + PORT + ' | account @' + USER); run(); });
