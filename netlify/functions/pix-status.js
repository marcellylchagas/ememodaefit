// Informa à loja o status de um pagamento Pix. Devolve só o status, sem dados pessoais.
const { json } = require("./_comum");

const CONSULTA = {
  sandbox: "https://apiquerysandbox.cieloecommerce.cielo.com.br",
  production: "https://apiquery.cieloecommerce.cielo.com.br",
};
const AMBIENTE = process.env.CIELO_AMBIENTE === "production" ? "production" : "sandbox";
const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

exports.handler = async (event) => {
  const id = (event.queryStringParameters || {}).id || "";
  if (!GUID.test(id)) { return json(400, { mensagem: "Pagamento inválido." }); }

  const r = await fetch(`${CONSULTA[AMBIENTE]}/1/sales/${id}`, {
    headers: { MerchantId: process.env.CIELO_MERCHANT_ID, MerchantKey: process.env.CIELO_MERCHANT_KEY },
  });
  const venda = await r.json().catch(() => null);
  if (!r.ok || !venda || !venda.Payment) { return json(502, { mensagem: "Não foi possível consultar o pagamento." }); }
  return json(200, { status: venda.Payment.Status });
};
