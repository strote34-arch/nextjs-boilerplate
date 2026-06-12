
// /api/kudago.js — прокси для KudaGo API (решает CORS)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');
  const city = req.query.city || 'volgograd';
  const today = Math.floor(Date.now() / 1000);
  const url = `https://kudago.com/public-api/v1.4/events/?location=${city}&actual_since=${today}&page_size=20&fields=id,title,description,dates,images,place,categories,price&expand=images,place`;
  try {
    const r = await fetch(url);
    const data = await r.json();
    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({error: e.message});
  }
}
