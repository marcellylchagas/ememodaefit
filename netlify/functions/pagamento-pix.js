// Cria uma venda Pix na Cielo, grava o pedido no Supabase e devolve o QR code para a cliente.
// Preços, estoque e frete são conferidos aqui, no servidor.
const crypto = require("crypto");
const { sbHeaders, json } = require("./_comum");

const HOSTS = {
  sandbox: "https://apisandbox.cieloecommerce.cielo.com.br",
  production: "https://api.cieloecommerce.cielo.com.br",
};
const AMBIENTE = process.env.CIELO_AMBIENTE === "production" ? "production" : "sandbox";

const txt = (v, max) => String(v == null ? "" : v).trim().slice(0, max || 200);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") { return json(405, { mensagem: "Método não permitido." }); }

  let corpo = {};
  try { corpo = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { mensagem: "Pedido inválido." }); }

  const itens = Array.isArray(corpo.itens) ? corpo.itens : [];
  if (!itens.length) { return json(400, { mensagem: "Carrinho vazio." }); }

  // dados da cliente
  const c = corpo.cliente || {};
  const cliente = {
    nome: txt(c.nome, 120),
    telefone: txt(c.telefone, 20),
    rua: txt(c.rua, 150),
    numero: txt(c.numero, 20),
    complemento: txt(c.complemento, 100),
    bairro: txt(c.bairro, 100),
    cidade: txt(c.cidade, 100),
    uf: txt(c.uf, 2).toUpperCase(),
    cep: String(c.cep || "").replace(/\D/g, ""),
    referencia: txt(c.referencia, 200),
  };
  if (cliente.nome.length < 3) { return json(400, { mensagem: "Informe o nome completo." }); }
  if (cliente.telefone.replace(/\D/g, "").length < 10) { return json(400, { mensagem: "Informe um telefone válido com DDD." }); }
  if (!cliente.rua || !cliente.numero || !cliente.bairro || !cliente.cidade || cliente.uf.length !== 2) {
    return json(400, { mensagem: "Preencha o endereço de entrega." });
  }
  if (cliente.cep.length !== 8) { return json(400, { mensagem: "CEP inválido." }); }
  cliente.endereco = `${cliente.rua}, ${cliente.numero}` + (cliente.complemento ? ` - ${cliente.complemento}` : "") +
    ` - ${cliente.bairro} - ${cliente.cidade}/${cliente.uf}`;

  // catálogo público: preços e estoque reais
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/loja_publico?id=eq.1&select=dados`, { headers: sbHeaders() });
  const linhas = await r.json().catch(() => null);
  const dados = Array.isArray(linhas) && linhas[0] ? linhas[0].dados : null;
  if (!dados || !dados.produtos) { return json(503, { mensagem: "Catálogo indisponível no momento." }); }

  const disp = dados.disp || {};
  let subtotal = 0;
  const itensServidor = [];
  const itensPedido = [];
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
    itensPedido.push({ pid: pid, nome: it.nome, cor: it.cor, tam: it.tam, qtd: qtd, unit: preco });
  }

  // frete recalculado no servidor, pela mesma função usada no carrinho
  const base = process.env.URL || "https://ememodaefit.netlify.app";
  const fr = await fetch(`${base}/.netlify/functions/frete`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cep: cliente.cep, itens: itensServidor }),
  });
  const frd = await fr.json().catch(() => null);
  const opcao = frd && Array.isArray(frd.opcoes) ? frd.opcoes.filter((o) => String(o.id) === String(corpo.freteId))[0] : null;
  if (!opcao) { return json(409, { mensagem: "O frete mudou ou não está disponível. Escolha a entrega de novo." }); }
  const frete = Number(opcao.preco);
  const total = subtotal + frete;

  const valorCentavos = String(Math.round(total * 100));
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

  // grava o pedido como "aguardando" (o status vira "pago" pela notificação da Cielo)
  const data = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const salvo = await fetch(`${process.env.SUPABASE_URL}/rest/v1/pedidos`, {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({
      id: pedido,
      payment_id: venda.Payment.PaymentId,
      status: "aguardando",
      dados: {
        data: data,
        cliente: cliente,
        itens: itensPedido,
        subtotal: subtotal,
        frete: frete,
        frete_tipo: opcao.nome,
        total: total,
        forma_pagamento: "Pix",
      },
    }),
  });
  if (!salvo.ok) { console.error("Falha ao gravar o pedido:", pedido, salvo.status); }

  return json(200, {
    pedido: pedido,
    paymentId: venda.Payment.PaymentId,
    qrCode: venda.Payment.QrCodeString,
    qrImagem: venda.Payment.QrcodeBase64Image,
    status: venda.Payment.Status,
    valor: total,
  });
};
