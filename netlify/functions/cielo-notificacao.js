// Recebe o aviso da Cielo quando o status de uma venda muda.
// Não confia no aviso: consulta o status real da venda na Cielo.
// Quando o pagamento está confirmado, marca o pedido como pago e dá baixa no estoque.
const { sbHeaders, json } = require("./_comum");

const CONSULTA = {
  sandbox: "https://apiquerysandbox.cieloecommerce.cielo.com.br",
  production: "https://apiquery.cieloecommerce.cielo.com.br",
};
const AMBIENTE = process.env.CIELO_AMBIENTE === "production" ? "production" : "sandbox";
const PAGO = 2; // 2 = PaymentConfirmed (confirmada e finalizada)
const URL_BASE = process.env.SUPABASE_URL;

async function baixarEstoque(itens, pedidoId) {
  const agora = new Date();
  const hoje = new Date(agora.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const dataBR = hoje.split("-").reverse().join("/");

  const rA = await fetch(`${URL_BASE}/rest/v1/loja_admin?id=eq.1&select=dados`, { headers: sbHeaders() });
  const la = await rA.json();
  const dAdmin = la[0] ? la[0].dados : null;
  const rP = await fetch(`${URL_BASE}/rest/v1/loja_publico?id=eq.1&select=dados`, { headers: sbHeaders() });
  const lp = await rP.json();
  const dPub = lp[0] ? lp[0].dados : null;
  if (!dAdmin || !dPub) { console.error("Estoque não lido para o pedido", pedidoId); return; }

  for (const it of itens) {
    const chave = `${it.pid}|${it.cor}|${it.tam}`;
    const qtd = Number(it.qtd) || 0;
    if (dAdmin.variacoes && dAdmin.variacoes[chave]) {
      const v = dAdmin.variacoes[chave];
      v.qtd = Math.max(0, (v.qtd || 0) - qtd);
      v.mov = v.mov || [];
      v.mov.push({ ts: Date.now(), iso: hoje, data: dataBR, tipo: "Saída", qtd: "-" + qtd, saldo: v.qtd,
        motivo: "Venda pelo site", obs: "Pedido " + pedidoId, out: qtd });
    }
    if (dPub.disp && dPub.disp[chave] !== undefined) {
      dPub.disp[chave] = Math.max(0, dPub.disp[chave] - qtd);
    }
  }
  const agoraISO = agora.toISOString();
  await fetch(`${URL_BASE}/rest/v1/loja_admin?id=eq.1`, {
    method: "PATCH", headers: sbHeaders(), body: JSON.stringify({ dados: dAdmin, atualizado_em: agoraISO }),
  });
  await fetch(`${URL_BASE}/rest/v1/loja_publico?id=eq.1`, {
    method: "PATCH", headers: sbHeaders(), body: JSON.stringify({ dados: dPub, atualizado_em: agoraISO }),
  });
}

async function marcarPago(paymentId) {
  const r = await fetch(`${URL_BASE}/rest/v1/pedidos?payment_id=eq.${encodeURIComponent(paymentId)}&select=id,status,dados`, { headers: sbHeaders() });
  const pedidos = await r.json();
  const pedido = Array.isArray(pedidos) ? pedidos[0] : null;
  if (!pedido) { console.error("Pedido não encontrado para o PaymentId", paymentId); return; }
  if (pedido.status !== "aguardando") { return; } // já foi processado: não desconta de novo

  await fetch(`${URL_BASE}/rest/v1/pedidos?id=eq.${encodeURIComponent(pedido.id)}&status=eq.aguardando`, {
    method: "PATCH", headers: sbHeaders(),
    body: JSON.stringify({ status: "pago", pago_em: new Date().toISOString() }),
  });
  await baixarEstoque(pedido.dados.itens || [], pedido.id);
  console.log("Pedido pago e estoque atualizado:", pedido.id);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") { return json(405, { mensagem: "Método não permitido." }); }

  let corpo = {};
  try { corpo = JSON.parse(event.body || "{}"); } catch (e) { return json(200, { ok: true }); }

  const paymentId = corpo.PaymentId;
  if (!paymentId) { return json(200, { ok: true }); }

  try {
    const r = await fetch(`${CONSULTA[AMBIENTE]}/1/sales/${encodeURIComponent(paymentId)}`, {
      headers: { MerchantId: process.env.CIELO_MERCHANT_ID, MerchantKey: process.env.CIELO_MERCHANT_KEY },
    });
    const venda = await r.json().catch(() => null);
    const status = venda && venda.Payment ? venda.Payment.Status : null;
    console.log("Notificação Cielo:", paymentId, "status", status);
    if (status === PAGO) { await marcarPago(paymentId); }
  } catch (e) {
    console.error("Falha ao processar a notificação:", e.message);
  }

  // A Cielo exige 200 para considerar a notificação recebida
  return json(200, { ok: true });
};
