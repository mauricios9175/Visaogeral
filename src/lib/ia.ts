import "server-only";

/**
 * IA do painel: Gemini, no plano gratuito do Google AI Studio.
 * A chave fica em GEMINI_API_KEY (variáveis da Vercel). O modelo pode ser trocado em GEMINI_MODELO.
 * Esta é a única parte que conhece o Gemini: para trocar de IA, basta mudar este arquivo.
 */

const URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// se o modelo configurado não existir mais, tenta estes (o Google aposenta versões de tempos em tempos)
const MODELOS_RESERVA = ["gemini-flash-latest", "gemini-2.5-flash"];

// nomes aceitos para a chave (o primeiro preenchido vale)
const NOMES_CHAVE = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GEMINI_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_AI_API_KEY"];
const chaveIA = () => NOMES_CHAVE.map((n) => process.env[n]?.trim().replace(/^["']|["']$/g, "")).find(Boolean);

export function iaConfigurada() {
  return Boolean(chaveIA());
}

/** Explica por que a chave não foi achada, listando só os NOMES de variáveis parecidas (nunca os valores). */
function semChave() {
  const parecidas = Object.keys(process.env).filter((n) => /gemini|genai|google_?ai|api_?key/i.test(n) && !NOMES_CHAVE.includes(n));
  const vazias = NOMES_CHAVE.filter((n) => n in process.env);
  return "A IA ainda não está ligada: o painel não achou a variável GEMINI_API_KEY neste deploy." +
    (vazias.length ? ` A variável ${vazias.join(", ")} existe, mas está vazia.` : "") +
    (parecidas.length ? ` Variáveis com nome parecido que o painel vê: ${parecidas.join(", ")} (o nome precisa ser exatamente GEMINI_API_KEY).` : "") +
    " Na Vercel, confira em Settings → Environment Variables se ela está neste projeto e marcada para Production, e faça um Redeploy.";
}

type RespostaGemini = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
};

/** Manda o pedido e devolve o texto da resposta. Erros já vêm com uma mensagem para mostrar na tela. */
export async function perguntarIA(sistema: string, pedido: string, opcoes: { temperatura?: number; json?: boolean } = {}): Promise<string> {
  const chave = chaveIA();
  if (!chave) throw new Error(semChave());
  const modelos = [...new Set([process.env.GEMINI_MODELO?.trim(), ...MODELOS_RESERVA].filter(Boolean) as string[])];

  let ultimoErro = "";
  for (const modelo of modelos) {
    const r = await fetch(`${URL_BASE}/${encodeURIComponent(modelo)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistema }] },
        contents: [{ role: "user", parts: [{ text: pedido }] }],
        generationConfig: {
          temperature: opcoes.temperatura ?? 0.4, maxOutputTokens: 8192,
          ...(opcoes.json && { responseMimeType: "application/json" }),
        },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const j = (await r.json().catch(() => ({}))) as RespostaGemini;
    if (r.status === 404) {
      ultimoErro = `modelo ${modelo} não encontrado`;
      continue;
    }
    if (r.status === 429) throw new Error("Bateu o limite gratuito do Gemini. Espere um minuto e tente de novo (se for o limite do dia, só amanhã).");
    if (r.status === 400 && /api key/i.test(j.error?.message ?? "")) throw new Error("A chave do Gemini foi recusada. Confira a GEMINI_API_KEY na Vercel.");
    if (r.status === 403) throw new Error(`O Google recusou a chave do Gemini: ${j.error?.message ?? "sem permissão"}`);
    if (!r.ok) throw new Error(`Erro do Gemini (${r.status}): ${j.error?.message ?? "sem detalhes"}`);
    if (j.promptFeedback?.blockReason) throw new Error(`O Gemini recusou o pedido (${j.promptFeedback.blockReason}).`);
    const texto = (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
    if (!texto) throw new Error(`O Gemini não devolveu texto (${j.candidates?.[0]?.finishReason ?? "sem motivo"}). Tente de novo.`);
    return texto;
  }
  throw new Error(`Nenhum modelo do Gemini respondeu (${ultimoErro}). Confira GEMINI_MODELO na Vercel.`);
}
