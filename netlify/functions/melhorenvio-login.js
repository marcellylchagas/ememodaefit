// Inicia a autorização do app no Melhor Envio. Use uma vez, na primeira conexão:
// https://ememodaefit.netlify.app/.netlify/functions/melhorenvio-login?k=SUA_CHAVE_DE_CONFIGURACAO
const { HOST } = require("./_comum");

exports.handler = async (event) => {
  const k = (event.queryStringParameters || {}).k;
  if (!process.env.SETUP_KEY || k !== process.env.SETUP_KEY) {
    return { statusCode: 403, body: "Acesso negado." };
  }
  const redirect = "https://ememodaefit.netlify.app/.netlify/functions/melhorenvio-callback";
  const url = `${HOST}/oauth/authorize?` + new URLSearchParams({
    client_id: process.env.MELHORENVIO_CLIENT_ID,
    redirect_uri: redirect,
    response_type: "code",
    scope: "shipping-calculate",
  }).toString();
  return { statusCode: 302, headers: { Location: url }, body: "" };
};
