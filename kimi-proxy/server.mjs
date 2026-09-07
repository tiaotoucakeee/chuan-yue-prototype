import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KIMI_API_BASE = 'https://api.moonshot.cn/v1';
const PORT = Number(process.env.PORT || 8787);
const TOKEN = (process.env.KIMI_API_KEY || '').trim();
/** 当前可用最便宜档：kimi-k2.6（moonshot-v1-8k 已下线） */
const MODEL = (process.env.KIMI_MODEL || 'kimi-k2.6').trim();
const MAX_ROUNDS = 20;

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'system-prompt.txt'), 'utf8').trim();
const sessions = new Map();

function sendJSON(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
  });
  res.end(JSON.stringify(body));
}

function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function newConversationId() {
  return 'kimi_' + crypto.randomBytes(8).toString('hex');
}

function getHistory(conversationId) {
  if (!sessions.has(conversationId)) {
    sessions.set(conversationId, []);
  }
  return sessions.get(conversationId);
}

function trimHistory(history) {
  const maxMessages = MAX_ROUNDS * 2;
  if (history.length <= maxMessages) return history;
  return history.slice(-maxMessages);
}

function consumeMoonshotSSEBlock(block, res, state) {
  if (!block.trim() || block.trim() === 'data: [DONE]') return;
  let dataStr = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('data:')) dataStr = line.slice(5).trim();
  }
  if (!dataStr || dataStr === '[DONE]') return;
  let data;
  try {
    data = JSON.parse(dataStr);
  } catch {
    return;
  }
  const delta = data.choices?.[0]?.delta?.content;
  if (delta) {
    state.full += delta;
    sendSSE(res, 'delta', { content: delta });
  }
}

async function streamKimiChat(body, res) {
  let conversationId = String(body.conversation_id || '').trim();
  if (!conversationId || !sessions.has(conversationId)) {
    conversationId = conversationId || newConversationId();
    sessions.set(conversationId, []);
  }

  const history = getHistory(conversationId);
  const userMessage = String(body.message || '').trim();
  history.push({ role: 'user', content: userMessage });
  sessions.set(conversationId, trimHistory(history));

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...getHistory(conversationId),
  ];

  const upstream = await fetch(`${KIMI_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: true,
      temperature: 1,
    }),
  });

  if (!upstream.ok) {
    history.pop();
    sessions.set(conversationId, history);
    const errText = await upstream.text();
    throw new Error(`Kimi HTTP ${upstream.status}: ${errText.slice(0, 400)}`);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'X-Accel-Buffering': 'no',
  });

  sendSSE(res, 'meta', { conversation_id: conversationId });

  const state = { full: '' };
  let buffer = '';
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      consumeMoonshotSSEBlock(part, res, state);
    }
  }
  if (buffer.trim()) {
    consumeMoonshotSSEBlock(buffer, res, state);
  }

  if (state.full) {
    history.push({ role: 'assistant', content: state.full });
    sessions.set(conversationId, trimHistory(history));
  }

  sendSSE(res, 'done', {});
  res.end();
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJSON(res, 200, {
      ok: true,
      kimi_configured: Boolean(TOKEN),
      model: MODEL,
    });
    return;
  }

  if (req.method === 'POST' && (req.url === '/api/kimi/chat' || req.url === '/api/coze/chat')) {
    if (!TOKEN) {
      sendJSON(res, 503, { error: 'KIMI_API_KEY is not configured in kimi-proxy/.env' });
      return;
    }

    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      sendJSON(res, 400, { error: 'invalid JSON body' });
      return;
    }

    body.message = String(body.message || '').trim();
    if (!body.message) {
      sendJSON(res, 400, { error: 'message is required' });
      return;
    }

    try {
      await streamKimiChat(body, res);
    } catch (err) {
      if (!res.headersSent) {
        sendJSON(res, 502, { error: err.message || 'Kimi proxy error' });
        return;
      }
      sendSSE(res, 'error', { error: err.message || 'Kimi proxy error' });
      sendSSE(res, 'done', {});
      res.end();
    }
    return;
  }

  sendJSON(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[kimi-proxy] http://0.0.0.0:${PORT}`);
  console.log(`[kimi-proxy] chat -> POST /api/kimi/chat (model: ${MODEL})`);
  if (!TOKEN) {
    console.warn('[kimi-proxy] warning: KIMI_API_KEY missing, copy .env.example to .env');
  }
});
