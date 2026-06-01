export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { link } = req.body;
  if (!link) return res.status(400).json({ error: 'Link obrigatório' });

  try {
    // Resolve shortened URL
    let finalUrl = link;
    try {
      const r = await fetch(link, { method: 'HEAD', redirect: 'follow' });
      finalUrl = r.url || link;
    } catch {}

    // Fetch Shopee page
    let nome = '', preco_de = '', preco_por = '', img_url = '', desconto = '';
    try {
      const pageRes = await fetch(finalUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
          'Accept-Language': 'pt-BR,pt;q=0.9'
        }
      });
      const html = await pageRes.text();

      // Extract product name
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) nome = titleMatch[1].replace(/\s*[\|\-].*$/, '').replace('Compre ', '').trim();

      // Extract OG image
      const imgMatch = html.match(/property="og:image"\s+content="([^"]+)"/i) ||
                       html.match(/content="([^"]+)"\s+property="og:image"/i);
      if (imgMatch) img_url = imgMatch[1];

      // Extract price from JSON-LD or meta
      const priceMatch = html.match(/"price"\s*:\s*"?([\d.,]+)"?/i) ||
                         html.match(/R\$\s*([\d.,]+)/g);
      if (priceMatch && priceMatch[0]) {
        const prices = (html.match(/R\$\s*([\d.,]+)/g) || []).map(p => {
          const n = parseFloat(p.replace('R$','').replace('.','').replace(',','.').trim());
          return isNaN(n) ? 0 : n;
        }).filter(n => n > 0).sort((a,b) => a-b);
        if (prices.length >= 2) {
          preco_por = `R$ ${prices[0].toFixed(2).replace('.',',')}`;
          preco_de = `R$ ${prices[prices.length-1].toFixed(2).replace('.',',')}`;
          const pct = Math.round((1 - prices[0]/prices[prices.length-1]) * 100);
          if (pct > 0 && pct < 100) desconto = `${pct}%`;
        } else if (prices.length === 1) {
          preco_por = `R$ ${prices[0].toFixed(2).replace('.',',')}`;
        }
      }
    } catch {}

    // Generate post with OpenRouter
    const prompt = `Você é especialista em grupos de achadinos da Shopee no WhatsApp.
Produto: ${nome || 'Produto Shopee'}
Preço DE: ${preco_de || 'não informado'}
Preço POR: ${preco_por || 'não informado'}
Desconto: ${desconto || 'não informado'}
Link: ${link}

Crie um post MUITO chamativo pra grupo de WhatsApp com emojis, urgência e o link no final.
Responda SOMENTE JSON puro sem markdown:
{"post_text":"texto animado com emojis e urgência, preços em destaque, link no final"}`;

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
        'HTTP-Referer': 'https://achadinos.vercel.app',
        'X-Title': 'Achadinos Shopee'
      },
      body: JSON.stringify({
        model: 'openrouter/free',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800
      })
    });

    const aiData = await aiRes.json();
    const text = aiData.choices?.[0]?.message?.content || '';
    const clean = text.replace(/```json|```/g, '').trim();
    let post_text = '';
    try { post_text = JSON.parse(clean).post_text; } catch { post_text = text; }

    return res.status(200).json({ nome, preco_de, preco_por, desconto, img_url, post_text, link });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
