// Configurações e funções auxiliares compartilhadas pelas funções do Melhor Envio.
// Os nomes "_comum" e "_" evitam que o Netlify trate este arquivo como função pública.
const AMBIENTE = process.env.MELHORENVIO_AMBIENTE === "production" ? "production" : "sandbox";
const HOSTS = {
  sandbox: "https://sandbox.melhorenvio.com.br",
  production: "https://melhorenvio.com.br",
};
function sbHeaders() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json" };
}

module.exports = {
  HOST: HOSTS[AMBIENTE],
  UA: "EME Moda & Fit (contato.marcelly@outlook.com)",
  CEP_ORIGEM: "27263200",
  sbHeaders,
  async lerTokens() {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/integracoes?id=eq.1&select=dados`, { headers: sbHeaders() });
    const j = await r.json();
    return j[0] ? j[0].dados : null;
  },
  async salvarTokens(dados) {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/integracoes?on_conflict=id`, {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ id: 1, dados, atualizado_em: new Date().toISOString() }),
    });
  },
  json(status, corpo) {
    return { statusCode: status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) };
  },
};
