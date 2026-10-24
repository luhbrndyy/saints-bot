const express = require('express');
const app = express();
app.use(express.json());

const WORKER_URL    = process.env.WORKER_URL;
const WORKER_SECRET = process.env.WORKER_SECRET || 'sqx_worker_9f2a7c1e4b8d3f60';
const OWNER_CODE    = process.env.OWNER_CODE    || 'brndyy';
const OWNER_SECRET  = process.env.OWNER_SECRET  || 'saints_owner_secret';

async function callWorker(path, method = 'GET', body) {
  try {
    const r = await fetch(WORKER_URL.replace(/\/$/, '') + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-worker-secret': WORKER_SECRET },
      body: body ? JSON.stringify(body) : undefined
    });
    return await r.json();
  } catch { return null; }
}

app.get('/api/stats', async (_q, res) => {
  const s = await callWorker('/api/status');
  res.json({ online: s?.activeSessions ?? 0, max: s?.maxSessions ?? 100 });
});

app.get('/api/paired-list', async (_q, res) => {
  const s = await callWorker('/api/sessions');
  res.json({ numbers: (s || []).map(x => ({ numero: x.numero, status: x.status })) });
});

app.get('/api/my-numbers', async (req, res) => {
  const wanted = (req.query.numbers || '').split(',').filter(Boolean);
  const s = await callWorker('/api/sessions');
  const map = new Map((s || []).map(x => [x.numero, x.status]));
  res.json({ numbers: wanted.map(n => ({ numero: n, status: map.get(n) || 'disconnected' })) });
});

app.post('/api/pair', async (req, res) => {
  const clean = String(req.body?.number || '').replace(/\D/g, '');
  if (!clean) return res.json({ success: false, error: 'numero_required' });
  const status = await callWorker('/api/status');
  if (!status || !status.available) return res.json({ success: false, error: 'no_server_available' });
  const r = await callWorker('/api/generate-pair', 'POST', { numero: clean });
  res.json(r || { success: false, error: 'unknown' });
});

app.post('/api/disconnect', async (req, res) => {
  const clean = String(req.body?.number || '').replace(/\D/g, '');
  const r = await callWorker('/api/disconnect', 'POST', { numero: clean });
  res.json({ success: true, ok: !!r });
});

// ---- owner panel ----
app.post('/api/owner/verify', (req, res) => {
  if (req.body?.code === OWNER_CODE) return res.json({ token: OWNER_SECRET });
  res.json({ error: 'bad_code' });
});
function ownerAuth(req) { return req.headers.authorization === 'Bearer ' + OWNER_SECRET; }
app.get('/api/owner/sessions', async (req, res) => {
  if (!ownerAuth(req)) return res.json({ error: 'unauthorized' });
  const s = await callWorker('/api/sessions');
  res.json({ numbers: s || [] });
});
app.post('/api/owner/disconnect', async (req, res) => {
  if (!ownerAuth(req)) return res.json({ error: 'unauthorized' });
  await callWorker('/api/disconnect', 'POST', { numero: String(req.body?.number || '').replace(/\D/g, '') });
  res.json({ success: true });
});

module.exports = app;
