export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { link } = req.body;
  if (!link) return res.status(400).json({ error: 'Link obrigatório' });

  try {
    // Try to fetch Shopee page for any data
    let html = '';
    let finalUrl = link;
    try {
      const r = await fetch(link, { 
        method: 'GET', 
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9'
        }
      });
      finalUrl = r.url || link;
      html = await r.text();
    } catch(e) {}

    // Extract any useful info from HTML
    let hints = '';
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) hints += 'Título da página: ' + titleMatch[1].slice(0, 200) + '\n';
    
    const ogTitle = html.match(/property="og:title"\s+content="([^"]+)"/i);
    if (ogTitle) hints += 'Produto: ' + ogTitle[1].slice(0, 200) + '\n';

    const ogDesc = html.match(/property="og:description"\s+content="([^"]+)"/i);
    if (ogDesc) hints += 'Descrição: ' + ogDesc[1].slice(0, 300) + '\n';

    // Extract image
    let img_url = '';
    const ogImg = html.match(/property="og:image"\s+content="([^"]+)"/i) ||
                  html.match(/content="([^"]+)"\s+property="og:image"/i);
    if (ogImg) img_url = ogImg[1];

    // Extract prices
    const prices = (html.match(/R\$\s*[\d.,]+/g) || [])
      .map(p => parseFloat(p.replace('R$','').replace(/\./g,'').replace(',','.').trim()))
      .filter(n => n > 0 && n < 100000)
      .sort((a,b) => a-b);
    
    let preco_de = '', preco_por = '', desconto = '';
    if (prices.length >= 2) {
      preco_por = 'R$ ' + prices[0].toFixed(2).replace('.', ',');
      preco_de = 'R$ ' + prices[prices.length-1].toFixed(2).replace('.', ',');
      const pct = Math.round((1 - prices[0]/prices[prices.length-1]) * 100);
      if (pct > 0 && pct < 90) desconto = pct + '%';
    } else if (prices.length === 1) {
      preco_por = 'R$ ' + prices[0].toFixed(2).replace('.', ',');
    }

    // Generate post with AI
    const prompt = `Você é especialista em grupos de achadinos da Shopee no WhatsApp.

Informações extraídas da página:
${hints || 'URL: ' + link}
${preco_de ? 'Preço DE: ' + preco_de : ''}
${preco_por ? 'Preço POR: ' + preco_por : ''}
${desconto ? 'Desconto: ' + desconto : ''}
Link: ${link}

Com base nessas informações, crie um post MUITO chamativo para grupo de WhatsApp de achadinos.
Use emojis, destaque o desconto, crie urgência, coloque o link no final.

Responda SOMENTE JSON puro sem markdown:
{"nome":"nome do produto inferido","preco_de":"${preco_de || 'R$ 0,00'}","preco_por":"${preco_por || 'R$ 0,00'}","desconto":"${desconto || ''}","post_text":"texto animado com emojis urgência e link no final"}`;

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
        'HTTP-Referer': 'https://achadinhos-chi.vercel.app',
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
    
    let dados = {};
    try { dados = JSON.parse(clean); } catch { dados = { post_text: text, nome: '', preco_de, preco_por, desconto }; }

    return res.status(200).json({ 
      nome: dados.nome || '',
      preco_de: dados.preco_de || preco_de,
      preco_por: dados.preco_por || preco_por,
      desconto: dados.desconto || desconto,
      img_url,
      post_text: dados.post_text || '',
      link 
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
