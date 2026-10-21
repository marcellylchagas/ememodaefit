// Calcula o frete no Melhor Envio para o CEP da cliente.
// Regras de peso e embalagem confirmadas pela loja.
const { HOST, UA, CEP_ORIGEM, lerTokens, salvarTokens, json } = require("./_comum");

function pesoPorPeca(categoria) {
  const c = (categoria || "").toLowerCase();
  if (c.includes("conjunto")) return 0.55;
  if (/jaqueta|moletom|casaco/.test(c)) return 0.60;
  if (/legging|calça|calca|macaquinho|macacão|macacao/.test(c)) return 0.35;
  if (/top|short|blusa|regata/.test(c)) return 0.20;
  return 0.35;
}

async function tokenValido() {
  let t = await lerTokens();
  if (!t || !t.access_token) return null;
  // renova quando faltarem menos de 2 dias para expirar
  if (t.expires_at - Date.now() < 2 * 86400000) {
    const r = await fetch(`${HOST}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: t.refresh_token,
        client_id: process.env.MELHORENVIO_CLIENT_ID,
        client_secret: process.env.MELHORENVIO_CLIENT_SECRET,
      }),
    });
    const j = await r.json();
    if (!r.ok || !j.access_token) return null;
    t = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 2592000) * 1000 };
    await salvarTokens(t);
  }
  return t.access_token;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") { return json(405, { mensagem: "Método não permitido." }); }
  let corpo = {};
  try { corpo = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { mensagem: "Pedido inválido." }); }
  const destino = String(corpo.cep || "").replace(/\D/g, "");
  const itens = Array.isArray(corpo.itens) ? corpo.itens : [];
  if (destino.length !== 8) { return json(400, { mensagem: "CEP inválido." }); }
  if (!itens.length) { return json(400, { mensagem: "Carrinho vazio." }); }

  const token = await tokenValido();
  if (!token) { return json(200, { opcoes: [], mensagem: "Frete indisponível no momento." }); }

  const pecas = itens.reduce((s, i) => s + (Number(i.qtd) || 0), 0);
  const peso = itens.reduce((s, i) => s + pesoPorPeca(i.categoria) * (Number(i.qtd) || 0), 0);
  const jaqueta = itens.some((i) => /jaqueta|moletom|casaco/i.test(i.categoria || ""));
  const valor = itens.reduce((s, i) => s + (Number(i.preco) || 0) * (Number(i.qtd) || 0), 0);
  // embalagem confirmada: envelope 26x36x2 cm para até 3 peças leves; caixa 30x25x10 cm no resto
  const emb = (jaqueta || pecas > 3) ? { width: 25, height: 10, length: 30 } : { width: 26, height: 2, length: 36 };

  const r = await fetch(`${HOST}/api/v2/me/shipment/calculate`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}`, "User-Agent": UA },
    body: JSON.stringify({
      from: { postal_code: CEP_ORIGEM },
      to: { postal_code: destino },
      products: [{ id: "1", ...emb, weight: Math.max(Number(peso.toFixed(3)), 0.01), insurance_value: Number(valor.toFixed(2)), quantity: 1 }],
      options: { receipt: false, own_hand: false },
    }),
  });
  const lista = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(lista)) { return json(502, { mensagem: "Não foi possível calcular o frete agora." }); }

  const opcoes = lista
    .filter((s) => !s.error && (s.custom_price || s.price))
    .map((s) => ({
      id: s.id,
      nome: `${(s.company && s.company.name) || ""} ${s.name || ""}`.trim(),
      preco: Number(s.custom_price || s.price),
      prazo: `${s.custom_delivery_time || s.delivery_time || "?"} dias úteis`,
    }))
    .sort((a, b) => a.preco - b.preco);
  return json(200, { opcoes });
};
