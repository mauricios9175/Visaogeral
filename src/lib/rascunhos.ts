import "server-only";
import { db } from "./db";
import { getMeta, montarUrl } from "./meta";
import { lerParaEditar, type EdicaoAnuncio, type EdicaoCampanha, type EdicaoConjunto } from "./meta-editar";
import { lerDestinoMeta } from "./meta-montar";
import { lerFormularioParaCopiar } from "./meta-copiar";
import { CONJUNTO_PADRAO, normalizarConfig, WHATSAPP_PADRAO, type ConfigFormulario, type ConfigMeta, type ConjuntoMeta, type ObjetivoMeta } from "./modelos";

// Rascunhos de campanha no painel (como no Gerenciador): o "Duplicar" copia do Meta para cá, você edita tudo
// (nomes, públicos, textos, mídia) e só no fim publica. Assim tudo nasce com o nome certo, sem " - cópia".
// Guardados em configuracoes ("rascunhos:<cliente>"), sem precisar de SQL.

export type CriativoRascunho = {
  caminho: string; nome: string; tipo: string; tamanho: number; videoId?: string; hash?: string; conta?: string; miniatura?: string | null;
  // copy própria do anúncio (na cópia de um conjunto com vários anúncios, cada um mantém a sua)
  nomeAnuncio?: string; texto?: string; titulo?: string; descricao?: string;
  deOutraConta?: boolean; // veio de outra conta (cópia entre contas): a mídia é levada para a conta do rascunho ao publicar
};

export type DestinoRascunho = {
  conta: string; campanhaId: string; campanhaNome: string; orcamentoNaCampanha: boolean;
  objetivo: ObjetivoMeta | null; conjunto?: { id: string; nome: string };
} | null;

export type Rascunho = {
  id: string;
  clienteId: string;
  titulo: string;
  origem: string;            // de onde veio (ex.: "Cópia do conjunto “X”")
  criadoEm: string;
  atualizadoEm: string;
  objetivo: ObjetivoMeta;
  conta: string;
  destino: DestinoRascunho;  // null = campanha nova
  config: ConfigMeta;
  pagina: string;
  instagram: string;
  formulario: string;
  formularioNovo?: ConfigFormulario | null; // formulario = "novo": o formulário a criar na página
  pixel: string;
  criativos: CriativoRascunho[];
  avisos: string[];
};

const chave = (clienteId: string) => `rascunhos:${clienteId}`;
const MAX = 30;

export async function listarRascunhos(clienteId: string): Promise<Rascunho[]> {
  const { data } = await db().from("configuracoes").select("valor").eq("chave", chave(clienteId)).maybeSingle();
  return Array.isArray(data?.valor) ? (data.valor as Rascunho[]) : [];
}

async function gravar(clienteId: string, lista: Rascunho[]) {
  const { error } = await db().from("configuracoes").upsert({ chave: chave(clienteId), valor: lista.slice(0, MAX), atualizado_em: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export async function lerRascunho(clienteId: string, id: string) {
  return (await listarRascunhos(clienteId)).find((r) => r.id === id) ?? null;
}

/** Salva (cria ou atualiza) um rascunho; o mais recente fica em cima. */
export async function salvarRascunho(r: Rascunho) {
  const lista = await listarRascunhos(r.clienteId);
  const novo = { ...r, atualizadoEm: new Date().toISOString() };
  await gravar(r.clienteId, [novo, ...lista.filter((x) => x.id !== r.id)]);
  return novo;
}

export async function excluirRascunho(clienteId: string, id: string) {
  await gravar(clienteId, (await listarRascunhos(clienteId)).filter((x) => x.id !== id));
}

// ---------- Duplicar: monta o rascunho a partir do que está no Meta ----------

type Nivel = "campanha" | "conjunto" | "anuncio";

async function idsFilhos(id: string, borda: "adsets" | "ads", token: string, max: number) {
  const r = await getMeta<{ data: { id: string }[] }>(montarUrl(`${id}/${borda}`, token, {
    fields: "id", limit: String(max),
    effective_status: JSON.stringify(["ACTIVE", "PAUSED", "IN_PROCESS", "PENDING_REVIEW", "WITH_ISSUES", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "DISAPPROVED", "PREAPPROVED"]),
  }));
  return r.data.map((x) => x.id);
}

/**
 * Lê no Meta a campanha, o conjunto ou o anúncio e monta o rascunho para editar antes de publicar.
 * `destino`: anúncio → conjunto de destino; conjunto → campanha de destino ou "nova"; campanha → sempre nova.
 */
export async function rascunhoDeMeta(
  clienteId: string, contaId: string, token: string, nivel: Nivel, id: string, destino?: string | null,
  /** copiar para outra conta (de outro cliente ou do mesmo): o rascunho fica no cliente/conta de destino, em campanha nova */
  paraOutraConta?: { clienteId: string; conta: string; mesmoCliente: boolean } | null,
): Promise<Rascunho> {
  const avisos: string[] = [];
  const outra = paraOutraConta ?? null;
  const pais = await getMeta<{ campaign_id?: string; adset_id?: string; name?: string }>(montarUrl(id, token, { fields: nivel === "campanha" ? "name" : "name,campaign_id" + (nivel === "anuncio" ? ",adset_id" : "") }));
  const campanhaId = nivel === "campanha" ? id : pais.campaign_id!;
  const camp = (await lerParaEditar("campanha", campanhaId, token)) as EdicaoCampanha;

  // conjuntos a copiar e anúncios de referência (os do 1º conjunto)
  // outra conta: o anúncio vai com o conjunto dele (lá não existe conjunto para recebê-lo)
  const conjuntosIds = nivel === "campanha" ? await idsFilhos(id, "adsets", token, 10) : nivel === "conjunto" ? [id] : outra ? [pais.adset_id!] : [];
  const anunciosIds = nivel === "anuncio" ? [id] : conjuntosIds[0] ? await idsFilhos(conjuntosIds[0], "ads", token, 10) : [];
  // públicos personalizados e semelhantes são da conta de origem: não existem na de destino
  const PUBLICOS = ["custom_audiences", "excluded_custom_audiences"];
  const conjuntos = (await Promise.all(conjuntosIds.map((c) => lerParaEditar("conjunto", c, token)))) as EdicaoConjunto[];
  const anuncios = (await Promise.all(anunciosIds.map((a) => lerParaEditar("anuncio", a, token).catch(() => null)))).filter(Boolean) as EdicaoAnuncio[];

  // objetivo e pixel: pelo conjunto de origem (ou o do anúncio)
  const conjuntoRef = conjuntosIds[0] ?? pais.adset_id!;
  const dest = await lerDestinoMeta(token, { conjunto: conjuntoRef });
  const objetivo: ObjetivoMeta = dest.objetivo ?? "formulario";
  const adset = await getMeta<{ promoted_object?: { pixel_id?: string } }>(montarUrl(conjuntoRef, token, { fields: "promoted_object" }));

  // criativos: a mesma mídia (pela biblioteca da conta), um por anúncio, com o nome do anúncio
  const criativos: CriativoRascunho[] = [];
  const usados: EdicaoAnuncio[] = [];
  for (const a of anuncios) {
    const m = a.criativo.midia;
    if (a.criativo.tipo === "post") { avisos.push(`“${a.nome}” usa uma publicação da página: suba a mídia de novo para ele.`); continue; }
    if (m.tipo === "varias") avisos.push(`“${a.nome}” tem várias mídias: veio só a primeira.`);
    const copy = { nomeAnuncio: a.nome, texto: a.criativo.textos[0] ?? "", titulo: a.criativo.titulos[0] ?? "", descricao: a.criativo.descricoes[0] ?? "" };
    // outra conta: a mídia fica marcada para ser levada para a conta de destino na hora de publicar
    const daOrigem = outra ? { deOutraConta: true } : {};
    if (m.videoId) criativos.push({ caminho: "", nome: a.nome, tipo: "video/mp4", tamanho: 0, videoId: m.videoId, conta: contaId, miniatura: m.miniatura, ...copy, ...daOrigem });
    else if (m.imagemHash) criativos.push({ caminho: "", nome: a.nome, tipo: "image/jpeg", tamanho: 0, hash: m.imagemHash, conta: contaId, miniatura: m.miniatura, ...copy, ...daOrigem });
    else { avisos.push(`Não achei a mídia de “${a.nome}”: escolha de novo.`); continue; }
    usados.push(a);
  }
  const ref = usados[0]?.criativo ?? anuncios[0]?.criativo;
  // textos: um por anúncio, na mesma ordem dos criativos (a montagem usa o texto i no criativo i)
  // cada anúncio leva a sua copy no criativo; o texto "do modelo" fica com o do 1º (vale para criativos novos que você incluir)
  const textos = usados.slice(0, 1).map((a) => a.criativo.textos[0] ?? "");
  const titulos = usados.slice(0, 1).map((a) => a.criativo.titulos[0] ?? "");

  let tirouPublicos = false;
  const conjuntosMeta: ConjuntoMeta[] = conjuntos.map((c) => {
    if (!outra || !c.publico.extras) return c.publico;
    const extras = { ...c.publico.extras };
    for (const k of PUBLICOS) if (extras[k]) { delete extras[k]; tirouPublicos = true; }
    const mantidos = (c.publico.mantidos ?? []).filter((m) => !/públicos personalizados|exclusão de públicos/.test(m));
    return { ...c.publico, extras, mantidos };
  }).map((publico, i) => ({
    ...publico, nome: conjuntos[i].nome,
    orcamentoDiario: conjuntos[i].orcamento?.tipo === "dia" ? conjuntos[i].orcamento!.valor : CONJUNTO_PADRAO.orcamentoDiario,
  }));
  if (tirouPublicos) avisos.push("Públicos personalizados e semelhantes são da conta de origem: ficaram de fora. Escolha os da conta de destino no Gerenciador depois de publicar.");
  const mantidosTodos = [...new Set(conjuntosMeta.flatMap((c) => c.mantidos ?? []))];
  if (mantidosTodos.length) avisos.push(`Vai igual ao original (não dá para editar aqui, mas não se perde): ${mantidosTodos.join(", ")}.`);
  if (conjuntos.length > 1 && conjuntos.some((c) => JSON.stringify(c.locais) !== JSON.stringify(conjuntos[0].locais))) {
    avisos.push("Os conjuntos tinham locais diferentes: no rascunho, todos ficam com os locais do primeiro.");
  }

  const config = normalizarConfig({
    nomeCampanha: camp.nome,
    orcamentoEm: camp.orcamento ? "campanha" : "conjunto",
    orcamentoDiario: camp.orcamento?.tipo === "dia" ? camp.orcamento.valor : 30,
    locais: conjuntos[0]?.locais ?? [],
    conjuntos: conjuntosMeta.length ? conjuntosMeta : [CONJUNTO_PADRAO],
    nomeAnuncio: "{arquivo}",
    textos: textos.length ? textos : ref?.textos.slice(0, 1) ?? [""],
    titulos: titulos.length ? titulos : ref?.titulos.slice(0, 1) ?? [""],
    descricao: ref?.descricoes[0] ?? "",
    ...(ref?.cta ? { cta: ref.cta } : {}),
    url: ref?.destino === "site" ? ref.link : "",
    parametrosUrl: ref?.urlTags ?? "",
    whatsapp: ref?.whatsapp ?? WHATSAPP_PADRAO,
  });

  // destino: onde publicar (outra conta: sempre campanha nova)
  let destinoR: DestinoRascunho = null;
  if (outra) {
    avisos.push("Imagens e vídeos vão ser copiados para a conta de destino na hora de publicar (vídeos podem levar alguns minutos).");
    if (!outra.mesmoCliente) avisos.push("Página, Instagram e pixel são do outro cliente: escolha os deste cliente abaixo.");
  } else if (nivel === "anuncio") {
    const alvo = destino || pais.adset_id!;
    const d = await lerDestinoMeta(token, { conjunto: alvo });
    destinoR = { conta: contaId, campanhaId: d.campanhaId, campanhaNome: d.campanhaNome, orcamentoNaCampanha: d.orcamentoNaCampanha, objetivo: d.objetivo, conjunto: d.conjunto };
  } else if (nivel === "conjunto" && destino !== "nova") {
    const d = await lerDestinoMeta(token, { campanha: destino || campanhaId });
    destinoR = { conta: contaId, campanhaId: d.campanhaId, campanhaNome: d.campanhaNome, orcamentoNaCampanha: d.orcamentoNaCampanha, objetivo: d.objetivo ?? objetivo };
  }

  const nomeOrigem = nivel === "campanha" ? camp.nome : nivel === "conjunto" ? conjuntos[0]?.nome : usados[0]?.nome ?? pais.name;
  const agora = new Date().toISOString();
  const trocaDeCliente = !!outra && !outra.mesmoCliente;
  // formulário: na cópia para outro cliente, vem igual ao de origem para ser criado na página dele ao publicar
  let formularioNovo: ConfigFormulario | null = null;
  if (trocaDeCliente && objetivo === "formulario" && ref?.formularioId && ref.paginaId) {
    try {
      const lido = await lerFormularioParaCopiar(ref.formularioId, ref.paginaId, token);
      formularioNovo = lido.config;
      avisos.push("O formulário veio copiado (perguntas, introdução e agradecimento) e vai ser criado na página deste cliente ao publicar.", ...lido.avisos);
    } catch (e) {
      avisos.push(`Não consegui ler o formulário de origem (${e instanceof Error ? e.message : e}): escolha ou crie um formulário abaixo.`);
    }
  }
  return {
    id: crypto.randomUUID(), clienteId: outra?.clienteId ?? clienteId,
    titulo: `${nomeOrigem ?? "Rascunho"}`,
    origem: `Cópia ${nivel === "campanha" ? "da campanha" : nivel === "conjunto" ? "do conjunto" : "do anúncio"} “${nomeOrigem ?? id}”${outra ? " (de outra conta)" : ""}`,
    criadoEm: agora, atualizadoEm: agora, objetivo, conta: outra?.conta ?? contaId, destino: destinoR, config,
    pagina: trocaDeCliente ? "" : ref?.paginaId ?? "", instagram: trocaDeCliente ? "" : ref?.instagramId ?? "",
    formulario: trocaDeCliente ? (formularioNovo ? "novo" : "") : ref?.formularioId ?? "", pixel: trocaDeCliente ? "" : adset.promoted_object?.pixel_id ?? "",
    ...(formularioNovo ? { formularioNovo } : {}),
    criativos, avisos,
  };
}
