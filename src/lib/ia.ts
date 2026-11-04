import "server-only";

/**
 * IA do painel: Gemini, no plano gratuito do Google AI Studio.
 * A chave fica em GEMINI_API_KEY (variáveis da Vercel). O modelo pode ser trocado em GEMINI_MODELO.
 * Esta é a única parte que conhece o Gemini: para trocar de IA, basta mudar este arquivo.
 */

const URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// se o modelo configurado não existir mais, tenta estes (o Google aposenta versões de tempos em tempos)
const MODELOS_RESERVA = ["gemini-flash-latest", "gemini-2.5-flash"];

export function iaConfigurada() {
  return Boolean(process.env.GEMINI_API_KEY);
}

type RespostaGemini = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
};

/** Manda o pedido e devolve o texto da resposta. Erros já vêm com uma mensagem para mostrar na tela. */
export async function perguntarIA(sistema: string, pedido: string, opcoes: { temperatura?: number } = {}): Promise<string> {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave) throw new Error("A IA ainda não está ligada: crie a variável GEMINI_API_KEY na Vercel (Settings → Environment Variables) e faça um novo deploy.");
  const modelos = [...new Set([process.env.GEMINI_MODELO?.trim(), ...MODELOS_RESERVA].filter(Boolean) as string[])];

  let ultimoErro = "";
  for (const modelo of modelos) {
    const r = await fetch(`${URL_BASE}/${encodeURIComponent(modelo)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistema }] },
        contents: [{ role: "user", parts: [{ text: pedido }] }],
        generationConfig: { temperature: opcoes.temperatura ?? 0.4, maxOutputTokens: 8192 },
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
