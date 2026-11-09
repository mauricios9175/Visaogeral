import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";

/**
 * IA do painel, com mais de um provedor: Gemini (Google, tem plano gratuito), Claude (Anthropic) e GPT (OpenAI).
 * As chaves ficam nas variáveis da Vercel (GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY). Em Configurações → IA do
 * painel dá para ligar/desligar cada um, escolher o modelo e a ordem: se o primeiro der limite ou erro, tenta o próximo.
 * Esta é a única parte que conhece os provedores.
 */

const URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// se o modelo configurado não existir mais, tenta estes (o Google aposenta versões de tempos em tempos)
// os "lite" entram por último: mais simples, mas costumam estar livres quando os outros estão sobrecarregados
const MODELOS_RESERVA = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"];
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

// nomes aceitos para a chave (o primeiro preenchido vale)
const NOMES_CHAVE = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GEMINI_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_AI_API_KEY"];
const chaveIA = () => NOMES_CHAVE.map((n) => process.env[n]?.trim().replace(/^["']|["']$/g, "")).find(Boolean);

/** Explica por que a chave não foi achada, listando só os NOMES de variáveis parecidas (nunca os valores). */
function semChave() {
  const parecidas = Object.keys(process.env).filter((n) => /gemini|genai|google_?ai|api_?key/i.test(n) && !NOMES_CHAVE.includes(n));
  const vazias = NOMES_CHAVE.filter((n) => n in process.env);
  return "A IA ainda não está ligada: o painel não achou a chave de nenhuma IA neste deploy (GEMINI_API_KEY, ANTHROPIC_API_KEY ou OPENAI_API_KEY), ou todas estão desligadas em Configurações." +
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

type Opcoes = { temperatura?: number; json?: boolean; tempoMs?: number };

/** Gemini: tenta o modelo escolhido e os de reserva (o limite gratuito é por modelo). */
async function gerarGemini(sistema: string, pedido: ParteIA[], opcoes: Opcoes, modeloEscolhido?: string): Promise<string> {
  const chave = chaveIA();
  if (!chave) throw new Error(semChave());
  const partes = pedido.map(paraGemini);
  const modelos = [...new Set([modeloEscolhido, process.env.GEMINI_MODELO?.trim(), ...MODELOS_RESERVA].filter(Boolean) as string[])];

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

/**
 * Pergunta com pesquisa no Google (a IA busca na internet e responde com as fontes).
 * Sem formato JSON (o Google não deixa juntar as duas coisas).
 */
async function pesquisarGemini(sistema: string, pedido: string, modeloEscolhido?: string): Promise<{ texto: string; fontes: { titulo: string; url: string }[] }> {
  const chave = chaveIA();
  if (!chave) throw new Error(semChave());
  const modelos = [...new Set([modeloEscolhido, process.env.GEMINI_MODELO?.trim(), "gemini-flash-latest", "gemini-2.5-flash"].filter(Boolean) as string[])];
  let ultimo = "";
  for (const modelo of modelos) {
    const r = await fetch(`${URL_BASE}/${encodeURIComponent(modelo)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistema }] },
        contents: [{ role: "user", parts: [{ text: pedido }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = (await r.json().catch(() => ({}))) as any;
    if (!r.ok) { ultimo = `${r.status} ${j?.error?.message ?? ""}`; continue; }
    const c = j.candidates?.[0];
    const texto = ((c?.content?.parts ?? []) as { text?: string; thought?: boolean }[]).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
    const fontes = ((c?.groundingMetadata?.groundingChunks ?? []) as { web?: { uri?: string; title?: string } }[])
      .map((x) => ({ titulo: x.web?.title ?? "", url: x.web?.uri ?? "" })).filter((x) => x.url).slice(0, 8);
    if (texto) return { texto, fontes };
    ultimo = "sem texto";
  }
  throw new Error(`A pesquisa na internet não respondeu (${ultimo}).`);
}

// =====================================================================================================================
// Provedores: Claude (Anthropic) e GPT (OpenAI), configuração e a ordem de tentativa
// =====================================================================================================================

export type Provedor = "gemini" | "claude" | "openai";
export const PROVEDORES: Record<Provedor, { nome: string; variavel: string; modeloPadrao: string; video: boolean; busca: boolean }> = {
  gemini: { nome: "Gemini (Google)", variavel: "GEMINI_API_KEY", modeloPadrao: "gemini-flash-latest", video: true, busca: true },
  claude: { nome: "Claude (Anthropic)", variavel: "ANTHROPIC_API_KEY", modeloPadrao: "claude-opus-5-5", video: false, busca: true },
  openai: { nome: "GPT (OpenAI)", variavel: "OPENAI_API_KEY", modeloPadrao: "gpt-5-mini", video: false, busca: false },
};

export type ConfigIA = { ordem: Provedor[]; ligados: Record<Provedor, boolean>; modelos: Partial<Record<Provedor, string>> };
export const CONFIG_IA_PADRAO: ConfigIA = { ordem: ["gemini", "claude", "openai"], ligados: { gemini: true, claude: true, openai: true }, modelos: {} };

const chaveDe = (p: Provedor) =>
  p === "gemini" ? chaveIA() : (p === "claude" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY)?.trim().replace(/^["']|["']$/g, "") || undefined;

let cacheConfig: { em: number; valor: ConfigIA } | null = null;
export async function lerConfigIA(): Promise<ConfigIA> {
  if (cacheConfig && Date.now() - cacheConfig.em < 60_000) return cacheConfig.valor;
  const { data } = await db().from("configuracoes").select("valor").eq("chave", "ia_config").maybeSingle().then((r) => r, () => ({ data: null }));
  const v = (data?.valor ?? {}) as Partial<ConfigIA>;
  const todos = Object.keys(PROVEDORES) as Provedor[];
  const ordem = [...(v.ordem ?? []).filter((x) => todos.includes(x)), ...todos.filter((x) => !(v.ordem ?? []).includes(x))];
  const valor: ConfigIA = { ordem, ligados: { ...CONFIG_IA_PADRAO.ligados, ...(v.ligados ?? {}) }, modelos: v.modelos ?? {} };
  cacheConfig = { em: Date.now(), valor };
  return valor;
}
export function esquecerConfigIA() { cacheConfig = null; }

/** Para a tela de Configurações: cada provedor, se tem chave (só o nome da variável, nunca o valor), ligado, modelo. */
export async function statusIA() {
  const c = await lerConfigIA();
  return c.ordem.map((p) => ({ provedor: p, ...PROVEDORES[p], temChave: !!chaveDe(p), ligado: c.ligados[p], modelo: c.modelos[p] ?? "" }));
}

/** Provedores na ordem de tentativa (ligados e com chave). */
async function provedoresAtivos(filtro?: (p: Provedor) => boolean) {
  const c = await lerConfigIA();
  return c.ordem.filter((p) => c.ligados[p] && chaveDe(p) && (!filtro || filtro(p))).map((p) => ({ p, modelo: c.modelos[p]?.trim() || undefined }));
}

export function iaConfigurada() {
  return (Object.keys(PROVEDORES) as Provedor[]).some((p) => !!chaveDe(p));
}

const semPartesDeVideo = (partes: ParteIA[]): ParteIA[] => {
  const tinha = partes.some((x) => "arquivo" in x);
  const resto = partes.filter((x) => !("arquivo" in x));
  return tinha ? [...resto, { texto: "(Obs.: este provedor não recebe o vídeo; analise pela miniatura, pelo texto e pelos números, e diga que não assistiu ao vídeo.)" }] : resto;
};

async function gerarClaude(sistema: string, partes: ParteIA[], opcoes: Opcoes, modelo?: string): Promise<string> {
  const client = new Anthropic({ apiKey: chaveDe("claude") });
  const content = semPartesDeVideo(partes).map((x) =>
    "texto" in x ? { type: "text" as const, text: x.texto }
      : "imagem" in x ? { type: "image" as const, source: { type: "base64" as const, media_type: x.imagem.mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: x.imagem.base64 } }
      : { type: "text" as const, text: "" });
  try {
    // fallbacks "default": se o modelo recusar o pedido, o próprio servidor tenta outro modelo
    const r = await client.beta.messages.create({
      model: modelo ?? PROVEDORES.claude.modeloPadrao, max_tokens: 16000, system: sistema,
      messages: [{ role: "user", content: content.filter((c) => c.type !== "text" || c.text) }],
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    }, { timeout: opcoes.tempoMs ?? 120_000 });
    if (r.stop_reason === "refusal") throw new Error("O Claude recusou o pedido.");
    const texto = r.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    if (!texto) throw new Error("O Claude não devolveu texto.");
    return texto;
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new Error("Claude: bateu o limite de uso.");
    if (e instanceof Anthropic.AuthenticationError) throw new Error("Claude: a chave ANTHROPIC_API_KEY foi recusada.");
    if (e instanceof Anthropic.APIConnectionError) throw new Error("Claude: falha de conexão.");
    if (e instanceof Anthropic.APIError) throw new Error(`Claude (${e.status}): ${e.message}`);
    throw e;
  }
}

async function pesquisarClaude(sistema: string, pedido: string, modelo?: string) {
  const client = new Anthropic({ apiKey: chaveDe("claude") });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: pedido }];
  const fontes: { titulo: string; url: string }[] = [];
  let texto = "";
  // a busca roda no servidor; se ele pausar no meio (pause_turn), é só mandar de novo para continuar
  for (let i = 0; i < 3; i++) {
    const r = await client.beta.messages.create({
      model: modelo ?? PROVEDORES.claude.modeloPadrao, max_tokens: 8000, system: sistema, messages,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    }, { timeout: 150_000 });
    for (const b of r.content) {
      if (b.type === "text") texto += b.text;
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const x of b.content) if (x.type === "web_search_result") fontes.push({ titulo: x.title, url: x.url });
      }
    }
    if (r.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: r.content });
  }
  if (!texto.trim()) throw new Error("O Claude não devolveu a pesquisa.");
  return { texto: texto.trim(), fontes: fontes.slice(0, 8) };
}

async function gerarOpenAI(sistema: string, partes: ParteIA[], opcoes: Opcoes, modelo?: string): Promise<string> {
  const conteudo = semPartesDeVideo(partes).map((x) =>
    "texto" in x ? { type: "text", text: x.texto }
      : "imagem" in x ? { type: "image_url", image_url: { url: `data:${x.imagem.mime};base64,${x.imagem.base64}` } }
      : { type: "text", text: "" });
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${chaveDe("openai")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelo ?? PROVEDORES.openai.modeloPadrao,
      messages: [{ role: "system", content: sistema }, { role: "user", content: conteudo }],
      ...(opcoes.json && { response_format: { type: "json_object" } }),
    }),
    signal: AbortSignal.timeout(opcoes.tempoMs ?? 120_000),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (await r.json().catch(() => ({}))) as any;
  if (r.status === 429) throw new Error("GPT: bateu o limite de uso (ou acabou o crédito).");
  if (r.status === 401) throw new Error("GPT: a chave OPENAI_API_KEY foi recusada.");
  if (!r.ok) throw new Error(`GPT (${r.status}): ${j?.error?.message ?? "sem detalhes"}`);
  const texto = String(j?.choices?.[0]?.message?.content ?? "").trim();
  if (!texto) throw new Error("O GPT não devolveu texto.");
  return texto;
}

/**
 * Manda o pedido à IA e devolve o texto. Tenta os provedores na ordem de Configurações: se um der limite, erro ou
 * estiver sem chave, passa para o próximo. Vídeo só o Gemini assiste; os outros recebem a miniatura e o texto.
 */
export async function perguntarIA(sistema: string, pedido: string | ParteIA[], opcoes: Opcoes = {}): Promise<string> {
  const partes: ParteIA[] = typeof pedido === "string" ? [{ texto: pedido }] : pedido;
  const ativos = await provedoresAtivos();
  if (!ativos.length) throw new Error(semChave());
  const erros: string[] = [];
  for (const { p, modelo } of ativos) {
    try {
      if (p === "gemini") return await gerarGemini(sistema, partes, opcoes, modelo);
      if (p === "claude") return await gerarClaude(sistema, partes, opcoes, modelo);
      return await gerarOpenAI(sistema, partes, opcoes, modelo);
    } catch (e) {
      erros.push(`${PROVEDORES[p].nome}: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new Error(erros.length > 1 ? `Nenhuma IA respondeu. ${erros.join(" · ")}` : erros[0]);
}

/** Pesquisa na internet (Gemini com Google, ou Claude com busca na web), na ordem de Configurações. */
export async function pesquisarNaWeb(sistema: string, pedido: string): Promise<{ texto: string; fontes: { titulo: string; url: string }[] }> {
  const ativos = await provedoresAtivos((p) => PROVEDORES[p].busca);
  const erros: string[] = [];
  for (const { p, modelo } of ativos) {
    try {
      return p === "gemini" ? await pesquisarGemini(sistema, pedido, modelo) : await pesquisarClaude(sistema, pedido, modelo);
    } catch (e) {
      erros.push(`${PROVEDORES[p].nome}: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new Error(erros.length ? erros.join(" · ") : "Nenhuma IA com pesquisa na internet configurada (Gemini ou Claude).");
}

/** O Gemini está disponível para vídeo (é o único que assiste)? */
export async function geminiParaVideo() {
  return (await provedoresAtivos((p) => p === "gemini")).length > 0;
}
