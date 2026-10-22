// Cria uma venda Pix na Cielo e devolve o QR code para a cliente.
// Os preços e o estoque são conferidos aqui, no servidor, a partir do catálogo do Supabase.
const crypto = require("crypto");
const { sbHeaders, json } = require("./_comum");

const HOSTS = {
  sandbox: "https://apisandbox.cieloecommerce.cielo.com.br",
  production: "https://api.cieloecommerce.cielo.com.br",
};
const AMBIENTE = process.env.CIELO_AMBIENTE === "production" ? "production" : "sandbox";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") { return json(405, { mensagem: "Método não permitido." }); }

  let corpo = {};
  try { corpo = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { mensagem: "Pedido inválido." }); }

  const itens = Array.isArray(corpo.itens) ? corpo.itens : [];
  if (!itens.length) { return json(400, { mensagem: "Carrinho vazio." }); }
  const cep = String(corpo.cep || "").replace(/\D/g, "");
  if (cep.length !== 8) { return json(400, { mensagem: "CEP inválido." }); }

  // catálogo público: preços e estoque reais
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/loja_publico?id=eq.1&select=dados`, { headers: sbHeaders() });
  const linhas = await r.json().catch(() => null);
  const dados = Array.isArray(linhas) && linhas[0] ? linhas[0].dados : null;
  if (!dados || !dados.produtos) { return json(503, { mensagem: "Catálogo indisponível no momento." }); }

  const disp = dados.disp || {};
  let subtotal = 0;
  const itensServidor = [];
  for (const it of itens) {
    const qtd = parseInt(it.qtd, 10);
    const pid = Object.keys(dados.produtos).find((k) => dados.produtos[k].name === it.nome);
    if (!pid || !(qtd > 0)) { return json(400, { mensagem: `Produto inválido: ${it.nome}.` }); }
    const chave = `${pid}|${it.cor}|${it.tam}`;
    if ((disp[chave] || 0) < qtd) {
      return json(409, { mensagem: `Estoque insuficiente: ${it.nome} (${it.cor}, tamanho ${it.tam}).` });
    }
    const preco = Number(dados.produtos[pid].price);
    subtotal += qtd * preco;
    itensServidor.push({ nome: it.nome, categoria: dados.produtos[pid].categoria || "", qtd: qtd, preco: preco });
  }

  // frete recalculado no servidor, pela mesma função usada no carrinho
  const base = process.env.URL || "https://ememodaefit.netlify.app";
  const fr = await fetch(`${base}/.netlify/functions/frete`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cep: cep, itens: itensServidor }),
  });
  const frd = await fr.json().catch(() => null);
  const opcao = frd && Array.isArray(frd.opcoes) ? frd.opcoes.filter((o) => String(o.id) === String(corpo.freteId))[0] : null;
  if (!opcao) { return json(409, { mensagem: "O frete mudou ou não está disponível. Escolha a entrega de novo." }); }
  const frete = Number(opcao.preco);

  const valorCentavos = String(Math.round((subtotal + frete) * 100));
  // o número do pedido só pode ter letras e números
  const pedido = "EME" + Date.now() + Math.floor(Math.random() * 1000000);

  const resp = await fetch(`${HOSTS[AMBIENTE]}/1/sales/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      MerchantId: process.env.CIELO_MERCHANT_ID,
      MerchantKey: process.env.CIELO_MERCHANT_KEY,
      RequestId: crypto.randomUUID(),
    },
    body: JSON.stringify({
      MerchantOrderId: pedido,
      Payment: { Type: "Pix", Amount: valorCentavos },
    }),
  });
  const venda = await resp.json().catch(() => null);
  if (resp.status !== 201 || !venda || !venda.Payment) {
    const motivo = (venda && venda.Message) || (Array.isArray(venda) && venda[0] && venda[0].Message) || "";
    console.error("Cielo recusou o Pix:", resp.status, motivo);
    return json(502, { mensagem: "Não foi possível gerar o Pix agora. Tente de novo." });
  }

  return json(200, {
    pedido: pedido,
    paymentId: venda.Payment.PaymentId,
    qrCode: venda.Payment.QrCodeString,
    qrImagem: venda.Payment.QrcodeBase64Image,
    status: venda.Payment.Status,
    valor: Number(valorCentavos) / 100,
  });
};
