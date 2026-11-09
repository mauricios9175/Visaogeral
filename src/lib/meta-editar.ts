import "server-only";
import { getMeta, montarUrl, postMeta } from "./meta";
import { esperarVideo, segmentacao, subirImagem } from "./meta-montar";
import { apagar } from "./armazenamento";
import {
  CONJUNTO_PADRAO, mensagemDoMeta, mensagemParaMeta, normalizarConfig,
  type ConfigFormulario, type ConjuntoMeta, type Interesse, type Local, type MensagemWhatsApp,
} from "./modelos";
import { criarFormulario } from "./meta-montar";

// Edição de campanha, conjunto e anúncio do Meta pelo painel. Tudo é lido na hora no Meta e salvo direto lá.
// O que o painel não sabe editar (públicos personalizados, exclusões, posicionamentos…) é mantido como está.

type Targeting = Record<string, unknown> & {
  age_min?: number; age_max?: number; genders?: number[];
  geo_locations?: Record<string, unknown> & {
    cities?: { key: string; name?: string; region?: string; radius?: number; distance_unit?: string }[];
    regions?: { key: string; name?: string }[];
    countries?: string[];
  };
  flexible_spec?: Record<string, { id: string; name?: string }[]>[];
  targeting_automation?: { advantage_audience?: number };
};

export type EdicaoCampanha = {
  nivel: "campanha"; id: string; nome: string; status: string; orcamento: { tipo: "dia" | "total"; valor: number } | null;
  limiteGastos: number | null; // limite de gastos da campanha (R$); null = sem limite
};
export type EdicaoConjunto = {
  nivel: "conjunto"; id: string; nome: string; status: string; campanha: string;
  orcamento: { tipo: "dia" | "total"; valor: number } | null; // null = orçamento na campanha (CBO)
  publico: ConjuntoMeta; locais: Local[];
  locaisEditaveis: boolean; interessesEditaveis: boolean; mantidos: string[]; // o que fica como está
  agendamento: { inicio: string; fim: string }; // "AAAA-MM-DDTHH:mm" no horário de Brasília; fim vazio = sem data
  posicionamentos: { modo: "auto" | "manual"; plataformas: string[]; detalhado: boolean }; // detalhado = já tem posições escolhidas uma a uma
};

export const PLATAFORMAS = { facebook: "Facebook", instagram: "Instagram", messenger: "Messenger", audience_network: "Audience Network" } as const;
export type TextosCriativo = {
  tipo: "link" | "video" | "feed" | "post";
  textos: string[]; titulos: string[]; descricoes: string[]; link: string; cta: string; urlTags: string;
  // identidade, destino e mídia (como no Gerenciador)
  paginaId: string; instagramId: string;
  destino: "formulario" | "whatsapp" | "site" | "outro";
  formularioId: string;
  midia: { tipo: "imagem" | "video" | "varias" | "nenhuma"; miniatura: string | null; videoId?: string | null };
  whatsapp: MensagemWhatsApp | null;   // anúncio de WhatsApp: modelo de mensagem
  linkExibicao: string;                // site: o link que aparece no anúncio (ex.: www.loja.com.br)
  novoFormulario?: ConfigFormulario | null; // formulário: criar um novo na página e usar no anúncio
  /** mídia nova escolhida na edição: imagem já no Storage (caminho) ou vídeo já enviado ao Meta (videoId) */
  novaMidia?: { tipo: "imagem"; caminho?: string; hash?: string } | { tipo: "video"; videoId: string } | null;
};
export type EdicaoAnuncio = { nivel: "anuncio"; id: string; nome: string; status: string; conjunto: string; criativo: TextosCriativo };
export type Edicao = EdicaoCampanha | EdicaoConjunto | EdicaoAnuncio;

const orcamentoDe = (o: { daily_budget?: string; lifetime_budget?: string }) =>
  Number(o.daily_budget) ? { tipo: "dia" as const, valor: Number(o.daily_budget) / 100 }
    : Number(o.lifetime_budget) ? { tipo: "total" as const, valor: Number(o.lifetime_budget) / 100 } : null;

const NOMES_PAIS: Record<string, string> = { BR: "Brasil", PT: "Portugal", US: "Estados Unidos" };
const CHAVES_GEO_EDITAVEIS = new Set(["cities", "regions", "countries", "location_types"]);

/** Público do Meta (targeting) → campos do painel. */
function lerPublico(t: Targeting) {
  const geo = t.geo_locations ?? {};
  const locais: Local[] = [
    ...(geo.cities ?? []).map((c): Local => ({
      key: c.key, nome: [c.name, c.region].filter(Boolean).join(", ") || c.key, tipo: "city",
      raio: c.radius ? Math.round(c.distance_unit === "mile" ? c.radius * 1.609 : c.radius) : undefined,
    })),
    ...(geo.regions ?? []).map((r): Local => ({ key: r.key, nome: r.name ?? r.key, tipo: "region" })),
    ...(geo.countries ?? []).map((c): Local => ({ key: c, nome: NOMES_PAIS[c] ?? c, tipo: "country" })),
  ];
  const outrosGeo = Object.keys(geo).filter((k) => !CHAVES_GEO_EDITAVEIS.has(k));
  const blocos = t.flexible_spec ?? [];
  const interesses: Interesse[] = blocos.length === 1
    ? Object.entries(blocos[0]).flatMap(([tipo, itens]) => (Array.isArray(itens) ? itens.map((i) => ({ id: i.id, nome: i.name ?? i.id, tipo })) : []))
    : [];
  const mantidos = [
    ...(outrosGeo.length ? [`locais especiais (${outrosGeo.join(", ")})`] : []),
    ...(blocos.length > 1 ? ["segmentação detalhada com mais de um bloco (E/OU)"] : []),
    ...(t.custom_audiences ? ["públicos personalizados"] : []),
    ...(t.excluded_custom_audiences ? ["exclusão de públicos"] : []),
    ...(t.exclusions ? ["exclusões de interesses"] : []),
    ...(t.publisher_platforms || t.facebook_positions || t.instagram_positions ? ["posicionamentos manuais"] : []),
    ...(t.locales ? ["idiomas"] : []),
  ];
  const generos: ConjuntoMeta["generos"] = t.genders?.length === 1 ? (t.genders[0] === 1 ? "homens" : "mulheres") : "todos";
  const publico: ConjuntoMeta = {
    ...CONJUNTO_PADRAO, nome: "", orcamentoDiario: 0,
    idadeMin: t.age_min ?? 18, idadeMax: t.age_max ?? 65, generos,
    advantage: t.targeting_automation?.advantage_audience === 1, interesses,
  };
  return { publico, locais, locaisEditaveis: !outrosGeo.length, interessesEditaveis: blocos.length <= 1, mantidos };
}

/** Lê o item no Meta para a tela de edição. */
export async function lerParaEditar(nivel: "campanha" | "conjunto" | "anuncio", id: string, token: string): Promise<Edicao> {
  if (nivel === "campanha") {
    const c = await getMeta<{ id: string; name: string; effective_status: string; daily_budget?: string; lifetime_budget?: string; spend_cap?: string }>(
      montarUrl(id, token, { fields: "id,name,effective_status,daily_budget,lifetime_budget,spend_cap" }));
    return { nivel, id: c.id, nome: c.name, status: c.effective_status, orcamento: orcamentoDe(c), limiteGastos: Number(c.spend_cap) ? Number(c.spend_cap) / 100 : null };
  }
  if (nivel === "conjunto") {
    const a = await getMeta<{ id: string; name: string; effective_status: string; daily_budget?: string; lifetime_budget?: string; targeting: Targeting; campaign?: { name?: string }; start_time?: string; end_time?: string }>(
      montarUrl(id, token, { fields: "id,name,effective_status,daily_budget,lifetime_budget,targeting,campaign{name},start_time,end_time" }));
    const t = a.targeting ?? {};
    const plataformas = (t.publisher_platforms as string[] | undefined) ?? [];
    const detalhado = ["facebook_positions", "instagram_positions", "messenger_positions", "audience_network_positions"].some((k) => k in t);
    const publico = lerPublico(t);
    return {
      nivel, id: a.id, nome: a.name, status: a.effective_status, campanha: a.campaign?.name ?? "", orcamento: orcamentoDe(a), ...publico,
      mantidos: publico.mantidos.filter((x) => x !== "posicionamentos manuais"),
      agendamento: { inicio: horaSP(a.start_time), fim: horaSP(a.end_time) },
      posicionamentos: { modo: plataformas.length ? "manual" : "auto", plataformas, detalhado },
    };
  }
  type CTA = { type?: string; value?: { link?: string; lead_gen_form_id?: string; app_destination?: string } };
  type Spec = { page_id?: string; instagram_user_id?: string; instagram_actor_id?: string;
    link_data?: Record<string, unknown> & { message?: string; name?: string; description?: string; link?: string; call_to_action?: CTA };
    video_data?: Record<string, unknown> & { message?: string; title?: string; link_description?: string; call_to_action?: CTA } };
  type Feed = { bodies?: { text: string }[]; titles?: { text: string }[]; descriptions?: { text: string }[]; link_urls?: { website_url?: string }[];
    call_to_action_types?: string[]; images?: unknown[]; videos?: unknown[] };
  const ad = await getMeta<{ id: string; name: string; effective_status: string; adset?: { name?: string };
    creative?: { id: string; object_story_spec?: Spec; asset_feed_spec?: Feed; url_tags?: string; object_story_id?: string; thumbnail_url?: string; image_url?: string; instagram_user_id?: string } }>(
    montarUrl(id, token, { fields: "id,name,effective_status,adset{name},creative{id,object_story_spec,asset_feed_spec,url_tags,object_story_id,thumbnail_url,image_url,instagram_user_id}" }));
  const c = ad.creative;
  const oss = c?.object_story_spec;
  const ld = oss?.link_data, vd = oss?.video_data, af = c?.asset_feed_spec;
  const cta = ld?.call_to_action ?? vd?.call_to_action;
  const ctaTipo = cta?.type ?? af?.call_to_action_types?.[0] ?? "";
  const formularioId = cta?.value?.lead_gen_form_id ?? "";
  const link = cta?.value?.link && cta.value.link !== "http://fb.me/" ? cta.value.link : ld?.link ?? af?.link_urls?.[0]?.website_url ?? "";
  const destino: TextosCriativo["destino"] = formularioId ? "formulario" : /WHATSAPP/.test(ctaTipo) || cta?.value?.app_destination === "WHATSAPP" ? "whatsapp"
    : link && !/fb\.me|api\.whatsapp/.test(link) ? "site" : "outro";
  const extras = {
    whatsapp: mensagemDoMeta(ld?.page_welcome_message ?? vd?.page_welcome_message) ?? (destino === "whatsapp" ? null : null),
    linkExibicao: String(ld?.caption ?? ""),
    paginaId: oss?.page_id ?? "", instagramId: oss?.instagram_user_id ?? c?.instagram_user_id ?? "", destino, formularioId,
    midia: {
      tipo: (af ? ((af.images?.length ?? 0) + (af.videos?.length ?? 0) > 1 ? "varias" : af.videos?.length ? "video" : af.images?.length ? "imagem" : "nenhuma")
        : vd ? "video" : ld ? "imagem" : "nenhuma") as TextosCriativo["midia"]["tipo"],
      miniatura: c?.thumbnail_url ?? c?.image_url ?? null,
      videoId: (vd?.video_id as string | undefined) ?? ((af?.videos as { video_id?: string }[] | undefined)?.[0]?.video_id) ?? null,
    },
  };
  const criativo: TextosCriativo = af?.bodies?.length || af?.titles?.length
    ? { tipo: "feed", textos: (af.bodies ?? []).map((x) => x.text), titulos: (af.titles ?? []).map((x) => x.text), descricoes: (af.descriptions ?? []).map((x) => x.text),
        link, cta: ctaTipo, urlTags: c?.url_tags ?? "", ...extras }
    : ld ? { tipo: "link", textos: [ld.message ?? ""], titulos: [ld.name ?? ""], descricoes: [ld.description ?? ""], link, cta: ctaTipo, urlTags: c?.url_tags ?? "", ...extras }
    : vd ? { tipo: "video", textos: [vd.message ?? ""], titulos: [vd.title ?? ""], descricoes: [vd.link_description ?? ""], link, cta: ctaTipo, urlTags: c?.url_tags ?? "", ...extras }
    : { tipo: "post", textos: [], titulos: [], descricoes: [], link: "", cta: "", urlTags: c?.url_tags ?? "", ...extras };
  return { nivel: "anuncio", id: ad.id, nome: ad.name, status: ad.effective_status, conjunto: ad.adset?.name ?? "", criativo };
}

const centavos = (v: number) => String(Math.round(v * 100));

/** Data do Meta (ISO com fuso) → "AAAA-MM-DDTHH:mm" no horário de Brasília (para o campo de data e hora). */
function horaSP(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}
const paraMeta = (local: string) => `${local}:00-0300`;

/** Salva a edição no Meta. Devolve o que mudou (para o histórico). */
export async function salvarEdicao(e: Edicao, contaId: string, token: string): Promise<string[]> {
  const atual = await lerParaEditar(e.nivel, e.id, token);
  const mudou: string[] = [];
  const campos: Record<string, string> = {};
  if (e.nome.trim() && e.nome.trim() !== atual.nome) { campos.name = e.nome.trim(); mudou.push(`nome → “${e.nome.trim()}”`); }

  if ((e.nivel === "campanha" || e.nivel === "conjunto") && (atual.nivel === "campanha" || atual.nivel === "conjunto")) {
    if (e.orcamento && atual.orcamento && e.orcamento.valor > 0 && e.orcamento.valor !== atual.orcamento.valor) {
      campos[atual.orcamento.tipo === "dia" ? "daily_budget" : "lifetime_budget"] = centavos(e.orcamento.valor);
      mudou.push(`orçamento → R$ ${e.orcamento.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}${atual.orcamento.tipo === "dia" ? "/dia" : " total"}`);
    }
  }

  if (e.nivel === "campanha" && atual.nivel === "campanha" && (e.limiteGastos ?? null) !== (atual.limiteGastos ?? null)) {
    // sem limite: o Meta pede este número enorme para tirar o limite
    campos.spend_cap = e.limiteGastos && e.limiteGastos > 0 ? centavos(e.limiteGastos) : "922337203685478";
    mudou.push(e.limiteGastos ? `limite de gastos → R$ ${e.limiteGastos.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "sem limite de gastos");
  }

  if (e.nivel === "conjunto" && atual.nivel === "conjunto") {
    if (e.agendamento.inicio && e.agendamento.inicio !== atual.agendamento.inicio) { campos.start_time = paraMeta(e.agendamento.inicio); mudou.push("início"); }
    if (e.agendamento.fim !== atual.agendamento.fim) {
      if (e.agendamento.fim) { campos.end_time = paraMeta(e.agendamento.fim); mudou.push("término"); }
      else if (atual.orcamento?.tipo === "total") throw new Error("Conjunto com orçamento total precisa de data de término.");
      else { campos.end_time = "0"; mudou.push("sem data de término"); }
    }
    // público: começa do original e troca só o que o painel edita
    const bruto = await getMeta<{ targeting: Targeting }>(montarUrl(e.id, token, { fields: "targeting" }));
    const original = bruto.targeting ?? {};
    const novo = segmentacao(normalizarConfig({ locais: e.locais }), e.publico) as Targeting;
    const t: Targeting = { ...original, age_min: novo.age_min, age_max: novo.age_max, targeting_automation: { ...(original.targeting_automation ?? {}), advantage_audience: e.publico.advantage ? 1 : 0 } };
    if (novo.genders) t.genders = novo.genders; else delete t.genders;
    if (atual.locaisEditaveis) {
      if (!e.locais.length) throw new Error("Escolha pelo menos um local.");
      const geoOriginal = { ...(original.geo_locations ?? {}) };
      for (const k of ["cities", "regions", "countries"]) delete geoOriginal[k];
      t.geo_locations = { ...geoOriginal, ...(novo.geo_locations ?? {}) };
    }
    if (atual.interessesEditaveis) {
      if (novo.flexible_spec?.length) t.flexible_spec = novo.flexible_spec; else delete t.flexible_spec;
    }
    // posicionamentos: automático (Advantage+) = sem plataformas na segmentação; manual = as plataformas escolhidas
    const posAntes = JSON.stringify(atual.posicionamentos.modo === "auto" ? [] : [...atual.posicionamentos.plataformas].sort());
    const posDepois = JSON.stringify(e.posicionamentos.modo === "auto" ? [] : [...e.posicionamentos.plataformas].sort());
    if (posAntes !== posDepois) {
      for (const k of ["publisher_platforms", "facebook_positions", "instagram_positions", "messenger_positions", "audience_network_positions", "device_platforms"]) delete t[k];
      if (e.posicionamentos.modo === "manual") {
        if (!e.posicionamentos.plataformas.length) throw new Error("Escolha pelo menos uma plataforma (ou deixe os posicionamentos automáticos).");
        t.publisher_platforms = e.posicionamentos.plataformas;
      }
    }
    if (JSON.stringify(t) !== JSON.stringify(original)) { campos.targeting = JSON.stringify(t); mudou.push(posAntes !== posDepois ? "público e posicionamentos" : "público"); }
  }

  if (e.nivel === "anuncio" && atual.nivel === "anuncio") {
    const a = e.criativo, o = atual.criativo;
    const chave = (x: TextosCriativo) => JSON.stringify([x.textos, x.titulos, x.descricoes, x.link, x.cta, x.urlTags, x.paginaId, x.instagramId, x.formularioId, x.whatsapp, x.linkExibicao]);
    if (chave(a) !== chave(o) || a.novaMidia || a.novoFormulario) {
      if (o.tipo === "post") throw new Error("Este anúncio usa uma publicação já existente: texto e mídia só mudam na própria publicação.");
      const novo = await novoCriativo(e.id, contaId, token, a, o, atual.nome);
      campos.creative = JSON.stringify({ creative_id: novo });
      const oque = [
        chave({ ...a, paginaId: "", instagramId: "", formularioId: "", whatsapp: null }) !== chave({ ...o, paginaId: "", instagramId: "", formularioId: "", whatsapp: null }) && "textos",
        a.novaMidia && (a.novaMidia.tipo === "video" ? "vídeo" : "imagem"),
        (a.formularioId !== o.formularioId || a.novoFormulario) && "formulário",
        JSON.stringify(a.whatsapp) !== JSON.stringify(o.whatsapp) && "mensagem do WhatsApp",
        (a.paginaId !== o.paginaId || a.instagramId !== o.instagramId) && "identidade",
      ].filter(Boolean);
      mudou.push(`anúncio (${oque.join(", ") || "criativo"})`);
    }
  }

  if (!Object.keys(campos).length) return [];
  await postMeta(e.id, token, campos);
  return mudou;
}

/**
 * Cria o criativo novo do anúncio: igual ao atual, com textos, destino, identidade e mídia trocados.
 * O Meta não deixa alterar um criativo que já existe.
 */
async function novoCriativo(adId: string, contaId: string, token: string, a: TextosCriativo, o: TextosCriativo, nomeAnuncio: string) {
  // (a pode ganhar o id do formulário criado agora)
  const ad = await getMeta<{ creative: { id: string } }>(montarUrl(adId, token, { fields: "creative{id}" }));
  const c = await getMeta<{ name?: string; object_story_spec?: Record<string, unknown>; asset_feed_spec?: Record<string, unknown> }>(
    montarUrl(ad.creative.id, token, { fields: "name,object_story_spec,asset_feed_spec" }));
  const limpo = (l: string[]) => l.map((x) => x.trim()).filter(Boolean);

  // mídia nova (sobe a imagem para o Meta; o vídeo já foi pelo navegador e só espera ficar pronto)
  let imagem: string | null = null;
  let video: { id: string; miniatura: string } | null = null;
  if (a.novaMidia?.tipo === "imagem") {
    // da biblioteca da conta (já tem hash) ou enviada agora (está no Storage)
    if (a.novaMidia.hash) imagem = a.novaMidia.hash;
    else if (a.novaMidia.caminho) {
      imagem = await subirImagem(contaId, token, a.novaMidia.caminho);
      await apagar([a.novaMidia.caminho]).catch(() => null);
    }
  } else if (a.novaMidia?.tipo === "video") {
    video = await esperarVideo(a.novaMidia.videoId, token, "vídeo novo");
  }

  // formulário novo, criado agora na página
  if (a.destino === "formulario" && a.novoFormulario) {
    const f = await criarFormulario(a.paginaId, token, a.novoFormulario, { cliente: "", objetivo: "CADASTRO", data: "", cidade: "" });
    a = { ...a, formularioId: f.id };
  }
  const novo: Record<string, string> = { name: `${c.name ?? nomeAnuncio} (editado)` };
  const spec = JSON.parse(JSON.stringify(c.object_story_spec ?? {})) as Record<string, unknown> & {
    page_id?: string; instagram_user_id?: string; instagram_actor_id?: string;
    link_data?: Record<string, unknown>; video_data?: Record<string, unknown>;
  };
  if (a.paginaId) spec.page_id = a.paginaId;
  if (a.instagramId) spec.instagram_user_id = a.instagramId; else delete spec.instagram_user_id;
  delete spec.instagram_actor_id;

  if (o.tipo === "feed" && c.asset_feed_spec) {
    const f = c.asset_feed_spec as Record<string, unknown>;
    const feed: Record<string, unknown> = { ...f,
      bodies: limpo(a.textos).map((text) => ({ text })), titles: limpo(a.titulos).map((text) => ({ text })),
      ...(limpo(a.descricoes).length ? { descriptions: limpo(a.descricoes).map((text) => ({ text })) } : {}),
      ...(a.link && a.destino === "site" ? { link_urls: [{ ...((f.link_urls as Record<string, unknown>[] | undefined)?.[0] ?? {}), website_url: a.link }] } : {}),
      ...(a.cta ? { call_to_action_types: [a.cta] } : {}),
    };
    if (imagem) { feed.images = [{ hash: imagem }]; delete feed.videos; feed.ad_formats = ["SINGLE_IMAGE"]; }
    if (video) { feed.videos = [{ video_id: video.id, thumbnail_url: video.miniatura }]; delete feed.images; feed.ad_formats = ["SINGLE_VIDEO"]; }
    novo.asset_feed_spec = JSON.stringify(feed);
    novo.object_story_spec = JSON.stringify({ page_id: spec.page_id, ...(spec.instagram_user_id ? { instagram_user_id: spec.instagram_user_id } : {}) });
  } else {
    const atual = (spec.link_data ?? spec.video_data ?? {}) as Record<string, unknown> & { call_to_action?: { type?: string; value?: Record<string, unknown> } };
    // destino: o link do formulário é o padrão do Meta; WhatsApp não leva link
    const linkSite = a.destino === "site" ? a.link : a.destino === "formulario" ? "http://fb.me/" : a.destino === "whatsapp" ? "https://api.whatsapp.com/send" : String(atual.link ?? a.link ?? "");
    const ctaValor: Record<string, unknown> = { ...(atual.call_to_action?.value ?? {}) };
    if (a.destino === "formulario") { ctaValor.lead_gen_form_id = a.formularioId; ctaValor.link = "http://fb.me/"; }
    else if (a.destino === "site" && a.link) ctaValor.link = a.link;
    const virarVideo = !!video || (!imagem && !!spec.video_data);
    const ctaTipo = a.cta || atual.call_to_action?.type;
    let cta: Record<string, unknown> | undefined = ctaTipo ? { type: ctaTipo, ...(Object.keys(ctaValor).length ? { value: ctaValor } : {}) } : undefined;
    if (a.destino === "whatsapp") cta = virarVideo ? { type: "WHATSAPP_MESSAGE" } : { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } };
    if (virarVideo) {
      const v = spec.video_data ?? {};
      spec.video_data = {
        ...v, ...(video ? { video_id: video.id, image_url: video.miniatura } : {}),
        message: a.textos[0] ?? "", title: a.titulos[0] ?? "", ...(a.descricoes[0] ? { link_description: a.descricoes[0] } : {}),
        ...(cta ? { call_to_action: cta } : {}),
      };
      delete (spec.video_data as Record<string, unknown>).image_hash;
      if (a.destino === "whatsapp" && a.whatsapp) {
        const atualMsg = (spec.link_data ?? spec.video_data)?.page_welcome_message;
        (spec.video_data as Record<string, unknown>).page_welcome_message = mensagemParaMeta(a.whatsapp, baseMensagem(atualMsg));
      }
      delete spec.link_data;
    } else {
      const l = spec.link_data ?? {};
      spec.link_data = {
        ...l, ...(imagem ? { image_hash: imagem } : {}), link: linkSite,
        message: a.textos[0] ?? "", name: a.titulos[0] ?? "", ...(a.descricoes[0] ? { description: a.descricoes[0] } : {}),
        ...(cta ? { call_to_action: cta } : {}),
      };
      if (imagem) { delete (spec.link_data as Record<string, unknown>).picture; delete (spec.link_data as Record<string, unknown>).image_url; }
      if (a.destino === "whatsapp" && a.whatsapp) {
        const atualMsg = (l as Record<string, unknown>).page_welcome_message ?? spec.video_data?.page_welcome_message;
        (spec.link_data as Record<string, unknown>).page_welcome_message = mensagemParaMeta(a.whatsapp, baseMensagem(atualMsg));
      }
      if (a.destino === "site") {
        if (a.linkExibicao.trim()) (spec.link_data as Record<string, unknown>).caption = a.linkExibicao.trim();
        else delete (spec.link_data as Record<string, unknown>).caption;
      }
      delete spec.video_data;
    }
    novo.object_story_spec = JSON.stringify(spec);
  }
  if (a.urlTags.trim() && a.destino !== "whatsapp") novo.url_tags = a.urlTags.trim().replace(/^[?&]+/, "");
  const criado = await postMeta(`${contaId}/adcreatives`, token, novo);
  return String(criado.id);
}

/** O que já existia na mensagem do WhatsApp (mantido), sem a parte do texto que o painel reescreve. */
function baseMensagem(bruto: unknown): Record<string, unknown> | null {
  try {
    const j = (typeof bruto === "string" ? JSON.parse(bruto) : bruto) as Record<string, unknown> | null;
    if (!j || typeof j !== "object") return null;
    const { text_format: _ignorado, ...resto } = j;
    void _ignorado;
    return resto;
  } catch {
    return null;
  }
}
