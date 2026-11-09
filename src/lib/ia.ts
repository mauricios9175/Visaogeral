import "server-only";

/**
 * IA do painel: Gemini, no plano gratuito do Google AI Studio.
 * A chave fica em GEMINI_API_KEY (variáveis da Vercel). O modelo pode ser trocado em GEMINI_MODELO.
 * Esta é a única parte que conhece o Gemini: para trocar de IA, basta mudar este arquivo.
 */

const URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// se o modelo configurado não existir mais, tenta estes (o Google aposenta versões de tempos em tempos)
// os "lite" entram por último: mais simples, mas costumam estar livres quando os outros estão sobrecarregados
const MODELOS_RESERVA = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"];
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** Parte do pedido: texto, imagem (base64) ou arquivo já enviado à IA (vídeo, pelo enviarArquivoIA). */
export type ParteIA = { texto: string } | { imagem: { mime: string; base64: string } } | { arquivo: { mime: string; uri: string } };

const paraGemini = (p: ParteIA) =>
  "texto" in p ? { text: p.texto }
    : "imagem" in p ? { inlineData: { mimeType: p.imagem.mime, data: p.imagem.base64 } }
    : { fileData: { mimeType: p.arquivo.mime, fileUri: p.arquivo.uri } };

/**
 * Envia um arquivo (vídeo) para a IA poder "assistir" (imagem e áudio). Espera ficar pronto.
 * O Google apaga sozinho em 48 h; apagarArquivoIA libera antes.
 */
export async function enviarArquivoIA(bytes: ArrayBuffer, mime: string, nome: string) {
  const chave = chaveIA();
  if (!chave) throw new Error(semChave());
  const inicio = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: {
      "x-goog-api-key": chave, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength), "X-Goog-Upload-Header-Content-Type": mime, "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: nome.slice(0, 120) } }),
  });
  const url = inicio.headers.get("x-goog-upload-url");
  if (!inicio.ok || !url) throw new Error(`Não consegui enviar o vídeo para a IA (${inicio.status}).`);
  const envio = await fetch(url, {
    method: "POST",
    headers: { "Content-Length": String(bytes.byteLength), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: bytes,
  });
  const j = (await envio.json().catch(() => ({}))) as { file?: { name: string; uri: string; state?: string; mimeType?: string } };
  if (!envio.ok || !j.file) throw new Error(`O envio do vídeo para a IA falhou (${envio.status}).`);
  // o Google processa o vídeo antes de liberar
  let arquivo = j.file;
  for (let i = 0; i < 40 && arquivo.state !== "ACTIVE"; i++) {
    if (arquivo.state === "FAILED") throw new Error("A IA não conseguiu processar este vídeo.");
    await espera(3000);
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${arquivo.name}`, { headers: { "x-goog-api-key": chave } });
    arquivo = { ...arquivo, ...((await r.json().catch(() => ({}))) as typeof arquivo) };
  }
  if (arquivo.state !== "ACTIVE") throw new Error("O vídeo ainda está sendo processado pela IA; tente de novo em um minuto.");
  return { nome: arquivo.name, uri: arquivo.uri, mime: arquivo.mimeType ?? mime };
}

export async function apagarArquivoIA(nome: string) {
  const chave = chaveIA();
  if (chave) await fetch(`https://generativelanguage.googleapis.com/v1beta/${nome}`, { method: "DELETE", headers: { "x-goog-api-key": chave } }).catch(() => null);
}

/** Manda o pedido e devolve o texto da resposta. Erros já vêm com uma mensagem para mostrar na tela. */
export async function perguntarIA(sistema: string, pedido: string | ParteIA[], opcoes: { temperatura?: number; json?: boolean; tempoMs?: number } = {}): Promise<string> {
  const chave = chaveIA();
  if (!chave) throw new Error(semChave());
  const partes = typeof pedido === "string" ? [{ text: pedido }] : pedido.map(paraGemini);
  const modelos = [...new Set([process.env.GEMINI_MODELO?.trim(), ...MODELOS_RESERVA].filter(Boolean) as string[])];

  let ultimoErro = "";
  let sobrecarga = false;
  let limite = false;
  for (const modelo of modelos) {
    // modelo sobrecarregado (503) ou instável (500): tenta mais 2 vezes, depois passa para o próximo modelo
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      if (tentativa) await espera(2000 * tentativa);
      const r = await fetch(`${URL_BASE}/${encodeURIComponent(modelo)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sistema }] },
          contents: [{ role: "user", parts: partes }],
          generationConfig: {
            temperature: opcoes.temperatura ?? 0.4, maxOutputTokens: 8192,
            ...(opcoes.json && { responseMimeType: "application/json" }),
          },
        }),
        signal: AbortSignal.timeout(opcoes.tempoMs ?? 50_000),
      });
      const j = (await r.json().catch(() => ({}))) as RespostaGemini;
      if (r.status === 404) {
        ultimoErro = `modelo ${modelo} não encontrado`;
        break;
      }
      if (r.status === 503 || r.status === 500) {
        sobrecarga = true;
        ultimoErro = `${modelo} sobrecarregado`;
        continue;
      }
      // o limite gratuito é por modelo: passa para o próximo
      if (r.status === 429) { limite = true; ultimoErro = `${modelo} no limite`; break; }
      if (r.status === 400 && /api key/i.test(j.error?.message ?? "")) throw new Error("A chave do Gemini foi recusada. Confira a GEMINI_API_KEY na Vercel.");
      if (r.status === 403) throw new Error(`O Google recusou a chave do Gemini: ${j.error?.message ?? "sem permissão"}`);
      if (!r.ok) throw new Error(`Erro do Gemini (${r.status}): ${j.error?.message ?? "sem detalhes"}`);
      if (j.promptFeedback?.blockReason) throw new Error(`O Gemini recusou o pedido (${j.promptFeedback.blockReason}).`);
      const texto = (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
      if (!texto) throw new Error(`O Gemini não devolveu texto (${j.candidates?.[0]?.finishReason ?? "sem motivo"}). Tente de novo.`);
      return texto;
    }
  }
  if (limite && !sobrecarga) throw new Error("Bateu o limite gratuito do Gemini. Espere um minuto e tente de novo (se for o limite do dia, só amanhã).");
  if (sobrecarga) throw new Error("Os modelos gratuitos do Gemini estão sobrecarregados agora (isso costuma passar em alguns minutos). Tente de novo daqui a pouco.");
  throw new Error(`Nenhum modelo do Gemini respondeu (${ultimoErro}). Confira GEMINI_MODELO na Vercel.`);
}
