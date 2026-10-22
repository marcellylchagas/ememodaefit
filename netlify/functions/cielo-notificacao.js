// Recebe o aviso da Cielo quando o status de uma venda muda.
// Não confia no aviso: consulta o status real da venda na Cielo e responde 200.
const { json } = require("./_comum");

const CONSULTA = {
  sandbox: "https://apiquerysandbox.cieloecommerce.cielo.com.br",
  production: "https://apiquery.cieloecommerce.cielo.com.br",
};
const AMBIENTE = process.env.CIELO_AMBIENTE === "production" ? "production" : "sandbox";
const PAGO = 2; // 2 = PaymentConfirmed (confirmada e finalizada)

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") { return json(405, { mensagem: "Método não permitido." }); }

  let corpo = {};
  try { corpo = JSON.parse(event.body || "{}"); } catch (e) { return json(200, { ok: true }); }

  const paymentId = corpo.PaymentId;
  if (!paymentId) { return json(200, { ok: true }); }

  try {
    const r = await fetch(`${CONSULTA[AMBIENTE]}/1/sales/${encodeURIComponent(paymentId)}`, {
      headers: {
        MerchantId: process.env.CIELO_MERCHANT_ID,
        MerchantKey: process.env.CIELO_MERCHANT_KEY,
      },
    });
    const venda = await r.json().catch(() => null);
    const status = venda && venda.Payment ? venda.Payment.Status : null;
    console.log("Notificação Cielo:", paymentId, "status", status, status === PAGO ? "(PAGO)" : "");
  } catch (e) {
    console.error("Falha ao consultar a Cielo:", e.message);
  }

  // A Cielo exige 200 para considerar a notificação recebida
  return json(200, { ok: true });
};
