import { calcOrder } from '../constant/pricing.js';

const ID_RE = /^[A-Za-z0-9]{20}$/;
const MAX_AGE_MS = 5 * 60 * 1000;
const FUTURE_SKEW_MS = 60 * 1000;
const DEDUP_TTL_S = 24 * 60 * 60;
const PAY_LABEL = { qris: 'QRIS', transfer: 'Transfer Bank', cod: 'Bayar di Tempat (COD)' };

const rupiah = (n) => 'Rp' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const clip = (s, n) => {
  const t = String(s ?? '').trim();
  return (t.length > n ? t.slice(0, n - 1) + '…' : t) || '-';
};

function json(body, status, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });
}

function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function jwtPayload(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4)));
  } catch {
    return null;
  }
}

function fromValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  return null;
}
function fromFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = fromValue(v);
  return out;
}

function buildMessage(order, calc, orderId, env) {
  const lines = calc.lines.map((l) => `${l.qty}× ${l.name} — ${rupiah(l.price * l.qty)}`).join('\n');
  return {
    username: 'Foody',
    allowed_mentions: { parse: [] },
    embeds: [{
      title: clip(`🛎️ Pesanan baru ${order.code || orderId}`, 200),
      url: env.ADMIN_URL || undefined,
      color: 0xe8431a,
      fields: [
        { name: 'Pelanggan', value: clip(`${order.name || '-'}\n${order.email || '-'}`, 300) },
        {
          name: 'Pesanan',
          value: clip(lines + (order.discount === true ? '\n_Diskon langganan 10% (lunch)_' : ''), 1000),
        },
        { name: 'Total (+ongkir)', value: rupiah(calc.total), inline: true },
        { name: 'Bayar', value: clip(PAY_LABEL[order.payment] || order.payment, 60), inline: true },
        { name: 'Alamat', value: clip(order.address, 500) },
      ],
      timestamp: order.createdAt,
    }],
  };
}

async function handleNotify(request, env, cors) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const claims = token ? jwtPayload(token) : null;
  const uid = claims && (claims.user_id || claims.sub);
  if (!uid || claims.aud !== env.FIREBASE_PROJECT_ID) return json({ ok: false, error: 'unauthorized' }, 401, cors);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400, cors); }
  const orderId = body && body.orderId;
  if (typeof orderId !== 'string' || !ID_RE.test(orderId)) return json({ ok: false, error: 'bad_order_id' }, 400, cors);

  const mark = `n:${orderId}`;
  if (await env.NOTIFIED.get(mark)) return json({ ok: true, duplicate: true }, 200, cors);

  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/orders/${orderId}`;
  const fs = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (fs.status === 404) return json({ ok: false, error: 'order_not_found' }, 404, cors);
  if (fs.status === 401 || fs.status === 403) return json({ ok: false, error: 'forbidden' }, 403, cors);
  if (!fs.ok) return json({ ok: false, error: 'firestore_error' }, 502, cors);

  const order = fromFields((await fs.json()).fields || {});
  if (order.customerId !== uid) return json({ ok: false, error: 'forbidden' }, 403, cors);
  if (order.status !== 'Baru') return json({ ok: false, error: 'not_new' }, 409, cors);

  const age = Date.now() - Date.parse(order.createdAt);
  if (!Number.isFinite(age) || age > MAX_AGE_MS || age < -FUTURE_SKEW_MS) {
    return json({ ok: false, error: 'stale_order' }, 409, cors);
  }

  const calc = calcOrder(order.items, order.discount === true);
  if (!calc.valid) return json({ ok: false, error: 'invalid_order' }, 422, cors);
  
  await env.NOTIFIED.put(mark, '1', { expirationTtl: DEDUP_TTL_S });
  let sent = false;
  try {
    const res = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildMessage(order, calc, orderId, env)),
    });
    sent = res.ok;
  } catch { sent = false; }
  if (!sent) {
    await env.NOTIFIED.delete(mark);
    return json({ ok: false, error: 'discord_failed' }, 502, cors);
  }
  return json({ ok: true }, 200, cors);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get('origin'), env);

    if (request.method === 'OPTIONS') {
      return cors ? new Response(null, { status: 204, headers: cors }) : new Response(null, { status: 403 });
    }
    if (url.pathname !== '/notify' || request.method !== 'POST') return json({ ok: false, error: 'not_found' }, 404);
    if (!cors) return json({ ok: false, error: 'origin_not_allowed' }, 403);

    try {
      return await handleNotify(request, env, cors);
    } catch (err) {
      console.error('notify error', err && err.message);
      return json({ ok: false, error: 'internal' }, 500, cors);
    }
  },
};