// Recebe o código do Melhor Envio e troca por tokens. Os tokens ficam guardados no Supabase.
const { HOST, UA, sbHeaders, salvarTokens } = require("./_comum");

exports.handler = async (event) => {
  const code = (event.queryStringParameters || {}).code;
  if (!code) { return { statusCode: 400, body: "Código de autorização ausente." }; }
  const r = await fetch(`${HOST}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: process.env.MELHORENVIO_CLIENT_ID,
      client_secret: process.env.MELHORENVIO_CLIENT_SECRET,
      redirect_uri: "https://ememodaefit.netlify.app/.netlify/functions/melhorenvio-callback",
      code,
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) { return { statusCode: 502, body: "O Melhor Envio não aceitou a autorização." }; }
  await salvarTokens({
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Date.now() + (j.expires_in || 2592000) * 1000,
  });
  return { statusCode: 200, headers: { "Content-Type": "text/html; charset=utf-8" },
    body: "<p style='font-family:sans-serif'>Melhor Envio conectado. Pode fechar esta página.</p>" };
};
