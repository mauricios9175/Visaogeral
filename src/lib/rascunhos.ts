import "server-only";
import { db } from "./db";
import { getMeta, montarUrl } from "./meta";
import { lerParaEditar, type EdicaoAnuncio, type EdicaoCampanha, type EdicaoConjunto } from "./meta-editar";
import { lerDestinoMeta } from "./meta-montar";
import { CONJUNTO_PADRAO, normalizarConfig, WHATSAPP_PADRAO, type ConfigMeta, type ConjuntoMeta, type ObjetivoMeta } from "./modelos";

// Rascunhos de campanha no painel (como no Gerenciador): o "Duplicar" copia do Meta para cá, você edita tudo
// (nomes, públicos, textos, mídia) e só no fim publica. Assim tudo nasce com o nome certo, sem " - cópia".
// Guardados em configuracoes ("rascunhos:<cliente>"), sem precisar de SQL.

export type CriativoRascunho = { caminho: string; nome: string; tipo: string; tamanho: number; videoId?: string; hash?: string; conta?: string; miniatura?: string | null };

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
export async function rascunhoDeMeta(clienteId: string, contaId: string, token: string, nivel: Nivel, id: string, destino?: string | null): Promise<Rascunho> {
  const avisos: string[] = [];
  const pais = await getMeta<{ campaign_id?: string; adset_id?: string; name?: string }>(montarUrl(id, token, { fields: nivel === "campanha" ? "name" : "name,campaign_id" + (nivel === "anuncio" ? ",adset_id" : "") }));
  const campanhaId = nivel === "campanha" ? id : pais.campaign_id!;
  const camp = (await lerParaEditar("campanha", campanhaId, token)) as EdicaoCampanha;

  // conjuntos a copiar e anúncios de referência (os do 1º conjunto)
  const conjuntosIds = nivel === "campanha" ? await idsFilhos(id, "adsets", token, 10) : nivel === "conjunto" ? [id] : [];
  const anunciosIds = nivel === "anuncio" ? [id] : conjuntosIds[0] ? await idsFilhos(conjuntosIds[0], "ads", token, 10) : [];
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
    if (m.videoId) criativos.push({ caminho: "", nome: a.nome, tipo: "video/mp4", tamanho: 0, videoId: m.videoId, conta: contaId, miniatura: m.miniatura });
    else if (m.imagemHash) criativos.push({ caminho: "", nome: a.nome, tipo: "image/jpeg", tamanho: 0, hash: m.imagemHash, conta: contaId, miniatura: m.miniatura });
    else { avisos.push(`Não achei a mídia de “${a.nome}”: escolha de novo.`); continue; }
    usados.push(a);
  }
  const ref = usados[0]?.criativo ?? anuncios[0]?.criativo;
  // textos: um por anúncio, na mesma ordem dos criativos (a montagem usa o texto i no criativo i)
  const textos = usados.map((a) => a.criativo.textos[0] ?? "").slice(0, 5);
  const titulos = usados.map((a) => a.criativo.titulos[0] ?? "").slice(0, 5);
  if (usados.length > 5) avisos.push("Mais de 5 anúncios: a partir do 6º, os textos se repetem a partir do 1º.");

  const conjuntosMeta: ConjuntoMeta[] = conjuntos.map((c) => ({
    ...c.publico, nome: c.nome,
    orcamentoDiario: c.orcamento?.tipo === "dia" ? c.orcamento.valor : CONJUNTO_PADRAO.orcamentoDiario,
  }));
  if (conjuntos.some((c) => c.mantidos.length)) avisos.push(`Fica de fora da cópia (o painel não monta): ${[...new Set(conjuntos.flatMap((c) => c.mantidos))].join(", ")}.`);
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

  // destino: onde publicar
  let destinoR: DestinoRascunho = null;
  if (nivel === "anuncio") {
    const alvo = destino || pais.adset_id!;
    const d = await lerDestinoMeta(token, { conjunto: alvo });
    destinoR = { conta: contaId, campanhaId: d.campanhaId, campanhaNome: d.campanhaNome, orcamentoNaCampanha: d.orcamentoNaCampanha, objetivo: d.objetivo, conjunto: d.conjunto };
  } else if (nivel === "conjunto" && destino !== "nova") {
    const d = await lerDestinoMeta(token, { campanha: destino || campanhaId });
    destinoR = { conta: contaId, campanhaId: d.campanhaId, campanhaNome: d.campanhaNome, orcamentoNaCampanha: d.orcamentoNaCampanha, objetivo: d.objetivo ?? objetivo };
  }

  const nomeOrigem = nivel === "campanha" ? camp.nome : nivel === "conjunto" ? conjuntos[0]?.nome : usados[0]?.nome ?? pais.name;
  const agora = new Date().toISOString();
  return {
    id: crypto.randomUUID(), clienteId,
    titulo: `${nomeOrigem ?? "Rascunho"}`,
    origem: `Cópia ${nivel === "campanha" ? "da campanha" : nivel === "conjunto" ? "do conjunto" : "do anúncio"} “${nomeOrigem ?? id}”`,
    criadoEm: agora, atualizadoEm: agora, objetivo, conta: contaId, destino: destinoR, config,
    pagina: ref?.paginaId ?? "", instagram: ref?.instagramId ?? "", formulario: ref?.formularioId ?? "", pixel: adset.promoted_object?.pixel_id ?? "",
    criativos, avisos,
  };
}
