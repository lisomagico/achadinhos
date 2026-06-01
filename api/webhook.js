const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENROUTER_KEY = process.env.OPENROUTER_KEY;

async function sendMessage(chat_id, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text, parse_mode: 'HTML' })
  });
}

async function sendPhoto(chat_id, photo, caption) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, photo, caption, parse_mode: 'HTML' })
  });
}

async function gerarPost(link) {
  // Fetch Shopee page
  let html = '', img_url = '', preco_de = '', preco_por = '', desconto = '', nome = '';
  try {
    const r = await fetch(link, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept-Language': 'pt-BR,pt;q=0.9'
      },
      redirect: 'follow'
    });
    html = await r.text();

    const ogImg = html.match(/property="og:image"\s+content="([^"]+)"/i) ||
                  html.match(/content="([^"]+)"\s+property="og:image"/i);
    if (ogImg) img_url = ogImg[1];

    const ogTitle = html.match(/property="og:title"\s+content="([^"]+)"/i);
    if (ogTitle) nome = ogTitle[1].slice(0, 100);

    const prices = (html.match(/R\$\s*[\d.,]+/g) || [])
      .map(p => parseFloat(p.replace('R$','').replace(/\./g,'').replace(',','.').trim()))
      .filter(n => n > 0 && n < 100000).sort((a,b) => a-b);

    if (prices.length >= 2) {
      preco_por = 'R$ ' + prices[0].toFixed(2).replace('.', ',');
      preco_de = 'R$ ' + prices[prices.length-1].toFixed(2).replace('.', ',');
      const pct = Math.round((1 - prices[0]/prices[prices.length-1]) * 100);
      if (pct > 0 && pct < 90) desconto = pct + '%';
    } else if (prices.length === 1) {
      preco_por = 'R$ ' + prices[0].toFixed(2).replace('.', ',');
    }
  } catch(e) {}

  // Generate post with AI
  const prompt = `Você é especialista em grupos de achadinos da Shopee no WhatsApp.
Produto: ${nome || 'Produto Shopee'}
${preco_de ? 'Preço DE: ' + preco_de : ''}
${preco_por ? 'Preço POR: ' + preco_por : ''}
${desconto ? 'Desconto: ' + desconto : ''}
Link de afiliado: ${link}

Crie um post MUITO chamativo com emojis, urgência e o link no final. Só o texto do post, sem explicações e deixando sempre um espaço de uma informação para a outra para o texto ficar organizado.`;

  const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'HTTP-Referer': 'https://achadinhos-chi.vercel.app',
      'X-Title': 'Achadinos Bot'
    },
    body: JSON.stringify({
      model: 'openrouter/free',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600
    })
  });

  const aiData = await aiRes.json();
  const post_text = aiData.choices?.[0]?.message?.content || 'Erro ao gerar post.';

  return { post_text, img_url, nome, preco_de, preco_por, desconto };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  const { message } = req.body;
  if (!message) return res.status(200).json({ ok: true });

  const chat_id = message.chat.id;
  const text = message.text || '';

  // Check if it's a Shopee link
  if (text.includes('shopee.com.br') || text.includes('s.shopee')) {
    await sendMessage(chat_id, '⏳ Gerando post, aguarda...');
    try {
      const { post_text, img_url } = await gerarPost(text.trim());
      if (img_url) {
        await sendPhoto(chat_id, img_url, post_text);
      } else {
        await sendMessage(chat_id, post_text);
      }
    } catch(e) {
      await sendMessage(chat_id, '❌ Erro ao gerar post. Tenta de novo.');
    }
  }

  return res.status(200).json({ ok: true });
}
