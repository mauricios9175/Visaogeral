import "server-only";
import { db, type ContaAnuncio } from "./db";
import { getMeta, montarUrl, postMeta } from "./meta";
import { fonteDoVideo, tokenDaPagina } from "./meta-montar";
import { normalizarFormulario, type ConfigFormulario, type PerguntaForm } from "./modelos";
import { tokenDaConta } from "./sync";

// Copiar para outra conta do Meta (de outro cliente ou outra conta do mesmo cliente):
// imagem e vídeo pertencem à conta de origem, então são levados para a conta de destino na hora de publicar.

export type CriativoParaCopiar = { nome: string; conta?: string; hash?: string; videoId?: string; deOutraConta?: boolean };

/** Token de qualquer conta de anúncio cadastrada no painel (de qualquer cliente). */
export async function tokenDeQualquerConta(contaId: string) {
  const { data } = await db().from("contas_anuncio").select("*").eq("id", contaId).maybeSingle();
  if (!data) throw new Error(`A conta de origem (${contaId}) não está no painel.`);
  const token = await tokenDaConta(data as ContaAnuncio);
  if (!token) throw new Error("Sem acesso à conta de origem (reconecte o Facebook em Configurações).");
  return token;
}

/**
 * Leva a mídia do criativo da conta de origem para a de destino. Imagem: baixa e envia de novo (hash novo).
 * Vídeo: o Meta baixa do link do vídeo original (id novo; a montagem espera ficar pronto).
 */
export async function copiarMidia<T extends CriativoParaCopiar>(cr: T, contaDestino: string, tokenDestino: string): Promise<T> {
  if (!cr.conta || cr.conta === contaDestino || (!cr.hash && !cr.videoId)) return cr;
  const tokenOrigem = await tokenDeQualquerConta(cr.conta);
  if (cr.videoId) {
    const { fonte } = await fonteDoVideo(cr.videoId, tokenOrigem);
    if (!fonte) throw new Error(`O Meta não liberou o arquivo do vídeo “${cr.nome}” para copiar. Baixe e envie o vídeo de novo.`);
    const r = await postMeta(`${contaDestino}/advideos`, tokenDestino, { file_url: fonte, name: cr.nome });
    return { ...cr, videoId: String(r.id), hash: undefined, conta: contaDestino, deOutraConta: false };
  }
  const img = await getMeta<{ data: { hash: string; url?: string; permalink_url?: string }[] }>(
    montarUrl(`${cr.conta}/adimages`, tokenOrigem, { hashes: JSON.stringify([cr.hash]), fields: "hash,url,permalink_url" }),
  );
  const url = img.data[0]?.url ?? img.data[0]?.permalink_url;
  if (!url) throw new Error(`Não achei a imagem de “${cr.nome}” na conta de origem.`);
  const arq = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!arq.ok) throw new Error(`Não consegui baixar a imagem de “${cr.nome}” (${arq.status}).`);
  const bytes = Buffer.from(await arq.arrayBuffer()).toString("base64");
  const r = await postMeta(`${contaDestino}/adimages`, tokenDestino, { bytes });
  const nova = Object.values((r.images ?? {}) as Record<string, { hash: string }>)[0];
  if (!nova?.hash) throw new Error(`O Meta não aceitou a imagem de “${cr.nome}” na conta de destino.`);
  return { ...cr, hash: nova.hash, videoId: undefined, conta: contaDestino, deOutraConta: false };
}

/** Descobre de qual conta (cadastrada no painel) é o item do Meta. */
export async function contaDoItem(itemId: string, contaSugerida?: string | null) {
  const { data } = await db().from("contas_anuncio").select("*");
  const contas = (data ?? []) as ContaAnuncio[];
  // primeiro a conta indicada; depois as outras
  const ordem = [...contas.filter((c) => c.id === contaSugerida), ...contas.filter((c) => c.id !== contaSugerida)];
  for (const c of ordem) {
    const token = await tokenDaConta(c);
    if (!token) continue;
    try {
      const { account_id } = await getMeta<{ account_id: string }>(montarUrl(itemId, token, { fields: "account_id" }));
      if (`act_${account_id}` === c.id) return { conta: c.id, token };
    } catch { /* tenta a próxima */ }
  }
  throw new Error("Não achei esse item em nenhuma conta do painel.");
}

// ---------- Formulário instantâneo: lê o do anúncio de origem para criar igual na página de destino ----------

type FormMeta = {
  name?: string; locale?: string; is_optimized_for_quality?: boolean; question_page_custom_headline?: string;
  questions?: { type?: string; label?: string; options?: { value?: string }[] }[];
  context_card?: { title?: string; content?: string[] };
  thank_you_page?: { title?: string; body?: string; button_type?: string; button_text?: string; website_url?: string };
  privacy_policy_url?: string; legal_content?: { privacy_policy?: { url?: string; link_text?: string } };
  tracking_parameters?: Record<string, string> | { key?: string; value?: string }[];
};

const TIPOS_PADRAO = new Set(["FULL_NAME", "PHONE", "EMAIL", "CITY", "STATE", "ZIP", "DOB", "JOB_TITLE", "COMPANY_NAME"]);

/**
 * Lê o formulário no Meta (perguntas, introdução, agradecimento, política, parâmetros) e devolve no formato da
 * montagem, para ser criado de novo na página de destino. Perguntas de tipos que o painel não monta viram
 * perguntas abertas com o mesmo texto (e entram na lista de avisos).
 */
export async function lerFormularioParaCopiar(formId: string, paginaId: string, token: string): Promise<{ config: ConfigFormulario; avisos: string[] }> {
  const tokenPagina = await tokenDaPagina(paginaId, token).catch(() => token);
  const campos = "name,locale,is_optimized_for_quality,question_page_custom_headline,questions,context_card,thank_you_page,privacy_policy_url,legal_content{privacy_policy},tracking_parameters";
  const f = await getMeta<FormMeta>(montarUrl(formId, tokenPagina, { fields: campos }))
    .catch(() => getMeta<FormMeta>(montarUrl(formId, tokenPagina, { fields: campos.replace(",legal_content{privacy_policy}", "") })));
  const avisos: string[] = [];
  const perguntas: PerguntaForm[] = (f.questions ?? []).map((q) => {
    const tipo = String(q.type ?? "").toUpperCase();
    if (TIPOS_PADRAO.has(tipo)) return { tipo: tipo as PerguntaForm["tipo"], rotulo: "", opcoes: [] };
    if (tipo !== "CUSTOM") avisos.push(`Pergunta “${q.label ?? tipo.toLowerCase()}” (${tipo.toLowerCase()}) virou pergunta aberta: confira no formulário.`);
    return { tipo: "CUSTOM", rotulo: q.label ?? tipo.toLowerCase(), opcoes: (q.options ?? []).map((o) => o.value ?? "").filter(Boolean) };
  });
  const params = Array.isArray(f.tracking_parameters)
    ? f.tracking_parameters.map((p) => ({ chave: p.key ?? "", valor: p.value ?? "" }))
    : Object.entries(f.tracking_parameters ?? {}).map(([chave, valor]) => ({ chave, valor: String(valor) }));
  const ty = f.thank_you_page ?? {};
  const config = normalizarFormulario({
    nome: f.name ?? "Formulário {cliente} - {data}",
    tipo: f.is_optimized_for_quality ? "intencao" : "volume",
    introTitulo: f.context_card?.title ?? "", introTexto: (f.context_card?.content ?? []).join("\n"),
    tituloPerguntas: f.question_page_custom_headline ?? "",
    perguntas: perguntas.length ? perguntas : undefined,
    // a política é do outro cliente: fica em branco (o painel usa a da página de destino ou o site dela)
    politicaUrl: "", politicaTexto: f.legal_content?.privacy_policy?.link_text ?? "",
    agradecimentoTitulo: ty.title ?? "", agradecimentoTexto: ty.body ?? "",
    botaoTexto: ty.button_text ?? "", botaoUrl: ty.button_type === "VIEW_WEBSITE" ? ty.website_url ?? "" : "",
    idioma: f.locale ?? "PT_BR",
    parametros: params.filter((p) => p.chave),
  });
  if (f.legal_content?.privacy_policy?.url || f.privacy_policy_url) {
    avisos.push("A política de privacidade não vem (é a do outro cliente): o painel usa a da página deste cliente; se quiser, informe o link no formulário.");
  }
  return { config, avisos };
}
