import "server-only";
import { getMeta, montarUrl, postMeta } from "./meta";
import { segmentacao } from "./meta-montar";
import { CONJUNTO_PADRAO, normalizarConfig, type ConjuntoMeta, type Interesse, type Local } from "./modelos";

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

export type EdicaoCampanha = { nivel: "campanha"; id: string; nome: string; status: string; orcamento: { tipo: "dia" | "total"; valor: number } | null };
export type EdicaoConjunto = {
  nivel: "conjunto"; id: string; nome: string; status: string; campanha: string;
  orcamento: { tipo: "dia" | "total"; valor: number } | null; // null = orçamento na campanha (CBO)
  publico: ConjuntoMeta; locais: Local[];
  locaisEditaveis: boolean; interessesEditaveis: boolean; mantidos: string[]; // o que fica como está
};
export type TextosCriativo = {
  tipo: "link" | "video" | "feed" | "post";
  textos: string[]; titulos: string[]; descricoes: string[]; link: string; cta: string; urlTags: string;
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
    const c = await getMeta<{ id: string; name: string; effective_status: string; daily_budget?: string; lifetime_budget?: string }>(
      montarUrl(id, token, { fields: "id,name,effective_status,daily_budget,lifetime_budget" }));
    return { nivel, id: c.id, nome: c.name, status: c.effective_status, orcamento: orcamentoDe(c) };
  }
  if (nivel === "conjunto") {
    const a = await getMeta<{ id: string; name: string; effective_status: string; daily_budget?: string; lifetime_budget?: string; targeting: Targeting; campaign?: { name?: string } }>(
      montarUrl(id, token, { fields: "id,name,effective_status,daily_budget,lifetime_budget,targeting,campaign{name}" }));
    return { nivel, id: a.id, nome: a.name, status: a.effective_status, campanha: a.campaign?.name ?? "", orcamento: orcamentoDe(a), ...lerPublico(a.targeting ?? {}) };
  }
  type Spec = { link_data?: Record<string, unknown> & { message?: string; name?: string; description?: string; link?: string; call_to_action?: { type?: string } };
    video_data?: Record<string, unknown> & { message?: string; title?: string; link_description?: string; call_to_action?: { type?: string; value?: { link?: string } } } };
  type Feed = { bodies?: { text: string }[]; titles?: { text: string }[]; descriptions?: { text: string }[]; link_urls?: { website_url?: string }[]; call_to_action_types?: string[] };
  const ad = await getMeta<{ id: string; name: string; effective_status: string; adset?: { name?: string };
    creative?: { id: string; object_story_spec?: Spec; asset_feed_spec?: Feed; url_tags?: string; object_story_id?: string } }>(
    montarUrl(id, token, { fields: "id,name,effective_status,adset{name},creative{id,object_story_spec,asset_feed_spec,url_tags,object_story_id}" }));
  const c = ad.creative;
  const ld = c?.object_story_spec?.link_data, vd = c?.object_story_spec?.video_data, af = c?.asset_feed_spec;
  const criativo: TextosCriativo = af?.bodies?.length || af?.titles?.length
    ? { tipo: "feed", textos: (af.bodies ?? []).map((x) => x.text), titulos: (af.titles ?? []).map((x) => x.text), descricoes: (af.descriptions ?? []).map((x) => x.text),
        link: af.link_urls?.[0]?.website_url ?? "", cta: af.call_to_action_types?.[0] ?? "", urlTags: c?.url_tags ?? "" }
    : ld ? { tipo: "link", textos: [ld.message ?? ""], titulos: [ld.name ?? ""], descricoes: [ld.description ?? ""], link: ld.link ?? "", cta: ld.call_to_action?.type ?? "", urlTags: c?.url_tags ?? "" }
    : vd ? { tipo: "video", textos: [vd.message ?? ""], titulos: [vd.title ?? ""], descricoes: [vd.link_description ?? ""], link: vd.call_to_action?.value?.link ?? "", cta: vd.call_to_action?.type ?? "", urlTags: c?.url_tags ?? "" }
    : { tipo: "post", textos: [], titulos: [], descricoes: [], link: "", cta: "", urlTags: c?.url_tags ?? "" };
  return { nivel: "anuncio", id: ad.id, nome: ad.name, status: ad.effective_status, conjunto: ad.adset?.name ?? "", criativo };
}

const centavos = (v: number) => String(Math.round(v * 100));

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

  if (e.nivel === "conjunto" && atual.nivel === "conjunto") {
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
    if (JSON.stringify(t) !== JSON.stringify(original)) { campos.targeting = JSON.stringify(t); mudou.push("público"); }
  }

  if (e.nivel === "anuncio" && atual.nivel === "anuncio") {
    const a = e.criativo, o = atual.criativo;
    const mudouTexto = JSON.stringify([a.textos, a.titulos, a.descricoes, a.link, a.cta, a.urlTags]) !== JSON.stringify([o.textos, o.titulos, o.descricoes, o.link, o.cta, o.urlTags]);
    if (mudouTexto) {
      if (o.tipo === "post") throw new Error("Este anúncio usa uma publicação já existente: o texto só muda na própria publicação.");
      // o Meta não deixa editar um criativo: cria um novo igual, com os textos novos, e troca no anúncio
      const ad = await getMeta<{ creative: { id: string } }>(montarUrl(e.id, token, { fields: "creative{id}" }));
      const c = await getMeta<{ name?: string; object_story_spec?: Record<string, Record<string, unknown>>; asset_feed_spec?: Record<string, unknown> }>(
        montarUrl(ad.creative.id, token, { fields: "name,object_story_spec,asset_feed_spec" }));
      const limpo = (l: string[]) => l.map((x) => x.trim()).filter(Boolean);
      const novo: Record<string, string> = { name: `${c.name ?? atual.nome} (editado)` };
      if (o.tipo === "feed" && c.asset_feed_spec) {
        const feed = { ...c.asset_feed_spec,
          bodies: limpo(a.textos).map((text) => ({ text })), titles: limpo(a.titulos).map((text) => ({ text })),
          ...(limpo(a.descricoes).length ? { descriptions: limpo(a.descricoes).map((text) => ({ text })) } : {}),
          ...(a.link ? { link_urls: [{ ...((c.asset_feed_spec.link_urls as Record<string, unknown>[] | undefined)?.[0] ?? {}), website_url: a.link }] } : {}),
          ...(a.cta ? { call_to_action_types: [a.cta] } : {}),
        };
        novo.asset_feed_spec = JSON.stringify(feed);
        if (c.object_story_spec) novo.object_story_spec = JSON.stringify(c.object_story_spec);
      } else if (c.object_story_spec) {
        const spec = JSON.parse(JSON.stringify(c.object_story_spec)) as Record<string, Record<string, unknown>>;
        if (spec.link_data) {
          Object.assign(spec.link_data, { message: a.textos[0] ?? "", name: a.titulos[0] ?? "", ...(a.descricoes[0] ? { description: a.descricoes[0] } : {}) });
          if (a.link && spec.link_data.link !== "http://fb.me/") spec.link_data.link = a.link;
          const cta = spec.link_data.call_to_action as { type?: string; value?: Record<string, unknown> } | undefined;
          if (cta && a.cta) cta.type = a.cta;
          if (cta?.value?.link && a.link && cta.value.link !== "http://fb.me/") cta.value.link = a.link;
        } else if (spec.video_data) {
          Object.assign(spec.video_data, { message: a.textos[0] ?? "", title: a.titulos[0] ?? "", ...(a.descricoes[0] ? { link_description: a.descricoes[0] } : {}) });
          const cta = spec.video_data.call_to_action as { type?: string; value?: Record<string, unknown> } | undefined;
          if (cta && a.cta) cta.type = a.cta;
          if (cta?.value?.link && a.link) cta.value.link = a.link;
        }
        novo.object_story_spec = JSON.stringify(spec);
      }
      if (a.urlTags.trim()) novo.url_tags = a.urlTags.trim().replace(/^[?&]+/, "");
      const criado = await postMeta(`${contaId}/adcreatives`, token, novo);
      campos.creative = JSON.stringify({ creative_id: criado.id });
      mudou.push("textos do anúncio");
    }
  }

  if (!Object.keys(campos).length) return [];
  await postMeta(e.id, token, campos);
  return mudou;
}
