import 'dotenv/config';
import http from 'node:http';

const COZE_API_BASE = 'https://api.coze.cn';
const DEFAULT_BOT_ID = '7631445325035208742';
const PORT = Number(process.env.PORT || 8787);
const TOKEN = (process.env.COZE_API_TOKEN || '').trim();
const BOT_ID = (process.env.COZE_BOT_ID || DEFAULT_BOT_ID).trim();

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

function handleCozeEvent(eventName, data, res, state) {
  if (
    (eventName === 'conversation.message.delta' ||
      eventName === 'conversation.message.completed') &&
    data.role === 'assistant' &&
    data.type === 'answer' &&
    data.content_type === 'text'
  ) {
    if (!state.metaSent && data.conversation_id) {
      state.metaSent = true;
      sendSSE(res, 'meta', {
        conversation_id: data.conversation_id,
        chat_id: data.chat_id,
      });
    }
    if (eventName === 'conversation.message.delta' && data.content) {
      sendSSE(res, 'delta', { content: data.content });
    }
    return;
  }

  if (
    (eventName === 'conversation.chat.created' ||
      eventName === 'conversation.chat.in_progress') &&
    !state.metaSent &&
    data.conversation_id
  ) {
    state.metaSent = true;
    sendSSE(res, 'meta', {
      conversation_id: data.conversation_id,
      chat_id: data.id || data.chat_id,
    });
    return;
  }

  if (eventName === 'conversation.chat.failed') {
    throw new Error('Coze chat failed');
  }
  if (eventName === 'error') {
    throw new Error(data.msg || 'Coze stream error');
  }
}

function consumeSSEBlock(block, res, state) {
  if (!block.trim()) return;
  let eventName = 'message';
  let dataStr = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataStr = line.slice(5).trim();
  }
  if (!dataStr) return;
  let data;
  try {
    data = JSON.parse(dataStr);
  } catch {
    return;
  }
  handleCozeEvent(eventName, data, res, state);
}

async function streamCozeChat(body, res) {
  const payload = {
    bot_id: BOT_ID,
    user_id: body.user_id || 'chuan-yue-prototype',
    stream: true,
    auto_save_history: true,
    additional_messages: [
      {
        role: 'user',
        content: body.message,
        content_type: 'text',
      },
    ],
  };

  let chatURL = `${COZE_API_BASE}/v3/chat`;
  if (body.conversation_id) {
    chatURL += `?conversation_id=${encodeURIComponent(body.conversation_id)}`;
  }

  const upstream = await fetch(chatURL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    throw new Error(`Coze HTTP ${upstream.status}: ${errText.slice(0, 300)}`);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'X-Accel-Buffering': 'no',
  });

  let metaSent = false;
  const state = { metaSent: false };
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
      consumeSSEBlock(part, res, state);
    }
  }

  if (buffer.trim()) {
    consumeSSEBlock(buffer, res, state);
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
      coze_configured: Boolean(TOKEN),
      bot_id: BOT_ID,
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/coze/chat') {
    if (!TOKEN) {
      sendJSON(res, 503, { error: 'COZE_API_TOKEN is not configured in coze-proxy/.env' });
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
      await streamCozeChat(body, res);
    } catch (err) {
      if (!res.headersSent) {
        sendJSON(res, 502, { error: err.message || 'Coze proxy error' });
        return;
      }
      sendSSE(res, 'error', { error: err.message || 'Coze proxy error' });
      sendSSE(res, 'done', {});
      res.end();
    }
    return;
  }

  sendJSON(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[coze-proxy] http://localhost:${PORT}`);
  console.log(`[coze-proxy] chat -> POST /api/coze/chat`);
  if (!TOKEN) {
    console.warn('[coze-proxy] warning: COZE_API_TOKEN missing, copy .env.example to .env');
  }
});
