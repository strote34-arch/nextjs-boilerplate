export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ ok: true, service: 'afishiru-api', ts: Date.now(), version: '1.0.0' });
}
