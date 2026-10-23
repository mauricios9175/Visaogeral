import "server-only";
import { getMeta, montarUrl, postMeta, todasPaginas, BASE_META } from "./meta";
import { aplicarNome, ROTULO_CURTO, type ConfigMeta, type ConjuntoMeta, type Interesse, type Local, type ObjetivoMeta } from "./modelos";
import { baixar, linkTemporario } from "./armazenamento";
import { hojeISO } from "./datas";

// Montagem de campanhas no Meta a partir de um modelo. Tudo é criado PAUSADO.

// ---------- buscas de segmentação ----------

export async function buscarLocais(q: string, token: string): Promise<Local[]> {
  type R = { key: string; name: string; type: string; region?: string; country_code?: string };
  const r = await getMeta<{ data: R[] }>(montarUrl("search", token, {
    type: "adgeolocation", q, location_types: JSON.stringify(["city", "region", "country"]), limit: "25", locale: "pt_BR",
  }));
  return r.data
    .filter((x) => ["city", "region", "country"].includes(x.type))
    // Brasil primeiro
    .sort((a, b) => Number(b.country_code === "BR") - Number(a.country_code === "BR"))
    .map((x) => ({
      key: x.key,
      tipo: x.type as Local["tipo"],
      nome: x.type === "city" ? `${x.name}${x.region ? ` (${x.region})` : ""}` : x.type === "region" ? `${x.name} (estado)` : x.name,
    }));
}

type ResultadoSegmentacao = {
  id: string; name: string; type?: string; path?: string[];
  audience_size_lower_bound?: number; audience_size_upper_bound?: number;
};

const paraInteresse = (x: ResultadoSegmentacao, tipoPadrao: string): Interesse => ({
  id: String(x.id), nome: x.name, tipo: x.type ?? tipoPadrao,
  caminho: x.path?.slice(0, -1).join(" › ") || undefined,
  publico: x.audience_size_upper_bound ?? x.audience_size_lower_bound,
});

/**
 * Segmentação detalhada como no Gerenciador: interesses, comportamentos, dados demográficos (cargos, setores,
 * formação, eventos da vida…). Usa a busca da conta de anúncio e completa com interesses e cargos.
 */
export async function buscarInteresses(q: string, token: string, contaId?: string | null): Promise<Interesse[]> {
  const buscas: Promise<Interesse[]>[] = [
    getMeta<{ data: ResultadoSegmentacao[] }>(montarUrl("search", token, { type: "adinterest", q, limit: "50", locale: "pt_BR" }))
      .then((r) => r.data.map((x) => paraInteresse(x, "interests")), () => []),
    getMeta<{ data: ResultadoSegmentacao[] }>(montarUrl("search", token, { type: "adworkposition", q, limit: "25", locale: "pt_BR" }))
      .then((r) => r.data.map((x) => paraInteresse(x, "work_positions")), () => []),
  ];
  if (contaId) {
    // mesma busca do campo "Segmentação detalhada" do Gerenciador (traz todos os tipos)
    buscas.unshift(
      getMeta<{ data: ResultadoSegmentacao[] }>(montarUrl(`${contaId}/targetingsearch`, token, { q, limit: "100", locale: "pt_BR" }))
        .then((r) => r.data.map((x) => paraInteresse(x, "interests")), () => []),
    );
  }
  const vistos = new Set<string>();
  const itens: Interesse[] = [];
  for (const lista of await Promise.all(buscas)) {
    for (const x of lista) {
      const chave = `${x.tipo}:${x.id}`;
      if (!vistos.has(chave)) { vistos.add(chave); itens.push(x); }
    }
  }
  if (!itens.length && !contaId) return [];
  return itens.slice(0, 80);
}

// ---------- ativos da conta ----------

export async function ativosDaConta(contaId: string, token: string) {
  const [paginas, instagram, pixels] = await Promise.all([
    todasPaginas<{ id: string; name: string }>(montarUrl(`${contaId}/promote_pages`, token, { fields: "id,name", limit: "100" })).catch(() => []),
    todasPaginas<{ id: string; username?: string; name?: string }>(montarUrl(`${contaId}/instagram_accounts`, token, { fields: "id,username", limit: "100" })).catch(() => []),
    todasPaginas<{ id: string; name: string }>(montarUrl(`${contaId}/adspixels`, token, { fields: "id,name", limit: "100" })).catch(() => []),
  ]);
  // alternativas: páginas do próprio perfil e o Instagram conectado a cada página
  const listaPaginas = paginas.length ? paginas
    : await todasPaginas<{ id: string; name: string }>(montarUrl("me/accounts", token, { fields: "id,name", limit: "100" })).catch(() => []);
  let listaIg = instagram;
  if (!listaIg.length) {
    const ligados = await Promise.all(listaPaginas.slice(0, 20).map((p) =>
      getMeta<{ instagram_business_account?: { id: string; username?: string } }>(
        montarUrl(p.id, token, { fields: "instagram_business_account{id,username}" }),
      ).then((r) => r.instagram_business_account ?? null, () => null)));
    listaIg = ligados.filter((x): x is { id: string; username?: string } => !!x);
  }
  return {
    paginas: listaPaginas.map((p) => ({ id: p.id, nome: p.name })),
    instagram: listaIg.map((i) => ({ id: i.id, nome: i.username ? `@${i.username}` : (i as { name?: string }).name ?? i.id })),
    pixels: pixels.map((p) => ({ id: p.id, nome: p.name })),
  };
}

/** Formulários instantâneos ativos da página. O Meta exige o token da própria página para listar. */
export async function formulariosDaPagina(paginaId: string, token: string) {
  const { access_token: tokenPagina } = await getMeta<{ access_token?: string }>(montarUrl(paginaId, token, { fields: "access_token" }));
  if (!tokenPagina) throw new Error("Sem acesso aos formulários desta página.");
  const forms = await todasPaginas<{ id: string; name: string; status: string }>(
    montarUrl(`${paginaId}/leadgen_forms`, tokenPagina, { fields: "id,name,status", limit: "100" }),
  );
  return forms.filter((f) => f.status === "ACTIVE").map((f) => ({ id: f.id, nome: f.name }));
}

// ---------- mídia ----------

async function subirImagem(contaId: string, token: string, caminho: string) {
  const arquivo = await baixar(caminho);
  const bytes = Buffer.from(await arquivo.arrayBuffer()).toString("base64");
  const r = await postMeta(`${contaId}/adimages`, token, { bytes });
  const img = Object.values((r.images ?? {}) as Record<string, { hash: string }>)[0];
  if (!img?.hash) throw new Error("O Meta não devolveu a imagem enviada.");
  return img.hash;
}

/** Envia o vídeo (o Meta baixa do link temporário) e espera ficar pronto. Devolve o id e uma miniatura. */
async function subirVideo(contaId: string, token: string, caminho: string, nome: string) {
  const url = await linkTemporario(caminho);
  const r = await postMeta(`${contaId}/advideos`, token, { file_url: url, name: nome });
  const id = String(r.id);
  for (let i = 0; i < 40; i++) {
    const v = await getMeta<{ status?: { video_status?: string }; picture?: string; thumbnails?: { data?: { uri: string; is_preferred?: boolean }[] } }>(
      montarUrl(id, token, { fields: "status,picture,thumbnails" }),
    );
    const st = v.status?.video_status;
    if (st === "error") throw new Error(`O Meta não conseguiu processar o vídeo ${nome}.`);
    // a miniatura da lista é a real; "picture" pode ser uma imagem provisória
    const miniatura = v.thumbnails?.data?.find((t) => t.is_preferred)?.uri ?? v.thumbnails?.data?.[0]?.uri ?? v.picture;
    if (st === "ready" && miniatura) return { id, miniatura };
    await new Promise((res) => setTimeout(res, 5000));
  }
  throw new Error(`O vídeo ${nome} ainda está sendo processado pelo Meta; tente montar de novo em alguns minutos.`);
}

// ---------- montagem ----------

const GENEROS = { todos: undefined, homens: [1], mulheres: [2] } as const;

function agruparPorTipo(itens: Interesse[]) {
  const grupos: Record<string, { id: string; name: string }[]> = {};
  for (const i of itens) {
    const tipo = !i.tipo || i.tipo === "user_adclusters" ? "interests" : i.tipo;
    (grupos[tipo] ??= []).push({ id: i.id, name: i.nome });
  }
  return grupos;
}

function segmentacao(c: ConfigMeta, p: ConjuntoMeta) {
  const cidades = c.locais.filter((l) => l.tipo === "city")
    .map((l) => (l.raio ? { key: l.key, radius: l.raio, distance_unit: "kilometer" } : { key: l.key }));
  const regioes = c.locais.filter((l) => l.tipo === "region").map((l) => ({ key: l.key }));
  const paises = c.locais.filter((l) => l.tipo === "country").map((l) => l.key);
  return {
    geo_locations: {
      ...(cidades.length && { cities: cidades }),
      ...(regioes.length && { regions: regioes }),
      ...(paises.length && { countries: paises }),
      location_types: ["home", "recent"],
    },
    // com o público Advantage+ ligado, o Meta exige idade máxima 65 e mínima de até 25 (a idade vira sugestão)
    age_min: p.advantage ? Math.min(p.idadeMin, 25) : p.idadeMin,
    age_max: p.advantage ? 65 : p.idadeMax,
    ...(GENEROS[p.generos] && { genders: GENEROS[p.generos] }),
    // tipos diferentes no mesmo bloco = "OU" (a pessoa precisa bater com pelo menos um item), como no Gerenciador
    ...(p.interesses.length && { flexible_spec: [agruparPorTipo(p.interesses)] }),
    targeting_automation: { advantage_audience: p.advantage ? 1 : 0 },
  };
}

function comUtm(url: string, campanha: string, anuncio: string) {
  const u = new URL(url);
  u.searchParams.set("utm_source", "facebook");
  u.searchParams.set("utm_medium", "paid_social");
  u.searchParams.set("utm_campaign", campanha);
  u.searchParams.set("utm_content", anuncio);
  return u.toString();
}

export type DadosMontagem = {
  contaId: string; token: string; clienteNome: string; objetivo: ObjetivoMeta; config: ConfigMeta;
  paginaId: string; instagramId: string | null; formularioId: string | null; pixelId: string | null;
  criativos: { caminho: string; nome: string; tipo: string }[];
};

/**
 * Campanha → um conjunto por público do modelo → os mesmos anúncios (um por criativo) em cada conjunto. Tudo PAUSADO.
 * Cada criativo é enviado e criado uma vez só e reaproveitado nos conjuntos.
 * Se a campanha ou um conjunto falharem, apaga tudo. Se um criativo falhar, segue com os outros e avisa.
 */
export async function montarNoMeta(d: DadosMontagem) {
  const c = d.config;
  if (!d.criativos.length) throw new Error("Nenhum criativo.");
  if (!c.conjuntos.length) throw new Error("O modelo não tem conjuntos.");
  const cidade = c.locais.find((l) => l.tipo === "city")?.nome.replace(/\s*\(.*\)$/, "") ?? c.locais[0]?.nome ?? "";
  const data = hojeISO().split("-").reverse().slice(0, 2).join("/");
  const vars = { cliente: d.clienteNome, objetivo: ROTULO_CURTO[d.objetivo], data, cidade };
  const campanhaNome = aplicarNome(c.nomeCampanha, vars);
  const centavos = (v: number) => String(Math.round(v * 100));
  if (d.objetivo === "site" && !d.pixelId) throw new Error("Escolha o pixel.");

  // 1. campanha
  const objetivoMeta = d.objetivo === "mensagens" ? "OUTCOME_ENGAGEMENT" : "OUTCOME_LEADS";
  const campanha = await postMeta(`${d.contaId}/campaigns`, d.token, {
    name: campanhaNome,
    objective: objetivoMeta,
    status: "PAUSED",
    special_ad_categories: "[]",
    ...(c.orcamentoEm === "campanha"
      ? { daily_budget: centavos(c.orcamentoDiario), bid_strategy: "LOWEST_COST_WITHOUT_CAP" }
      : { is_adset_budget_sharing_enabled: "false" }),
  });
  const campanhaId = String(campanha.id);

  try {
    // 2. um conjunto por público
    const destino =
      d.objetivo === "formulario" ? { optimization_goal: "LEAD_GENERATION", destination_type: "ON_AD", promoted_object: { page_id: d.paginaId } }
      : d.objetivo === "mensagens" ? { optimization_goal: "CONVERSATIONS", destination_type: "WHATSAPP", promoted_object: { page_id: d.paginaId } }
      : { optimization_goal: "OFFSITE_CONVERSIONS", destination_type: "WEBSITE", promoted_object: { pixel_id: d.pixelId, custom_event_type: "LEAD" } };
    const inicio = new Date(Date.now() + 10 * 60_000).toISOString();
    const conjuntos: { id: string; nome: string }[] = [];
    for (const p of c.conjuntos) {
      const nome = aplicarNome(p.nome, vars);
      try {
        const r = await postMeta(`${d.contaId}/adsets`, d.token, {
          name: nome,
          campaign_id: campanhaId,
          status: "PAUSED",
          billing_event: "IMPRESSIONS",
          optimization_goal: destino.optimization_goal,
          destination_type: destino.destination_type,
          promoted_object: JSON.stringify(destino.promoted_object),
          targeting: JSON.stringify(segmentacao(c, p)),
          ...(c.orcamentoEm === "conjunto" && { daily_budget: centavos(p.orcamentoDiario), bid_strategy: "LOWEST_COST_WITHOUT_CAP" }),
          start_time: inicio,
        });
        conjuntos.push({ id: String(r.id), nome });
      } catch (e) {
        throw new Error(`Conjunto “${nome}”: ${e instanceof Error ? e.message : e}`);
      }
    }

    // 3. criativos (uma vez cada) e um anúncio por criativo em cada conjunto
    const textos = c.textos.map((t) => t.trim()).filter(Boolean);
    const titulos = c.titulos.map((t) => t.trim()).filter(Boolean);
    let anuncios = 0;
    const falhas: string[] = [];
    for (const [i, cr] of d.criativos.entries()) {
      const nomeBase = { ...vars, n: String(i + 1), arquivo: cr.nome.replace(/\.\w+$/, "") };
      try {
        const ehVideo = cr.tipo.startsWith("video");
        const midia = ehVideo ? await subirVideo(d.contaId, d.token, cr.caminho, cr.nome) : { hash: await subirImagem(d.contaId, d.token, cr.caminho) };
        const nomeCriativo = aplicarNome(c.nomeAnuncio, { ...nomeBase, conjunto: "" }).replace(/\s*-\s*$/, "");
        const link =
          d.objetivo === "site" ? (c.utm ? comUtm(c.url, campanhaNome, nomeCriativo) : c.url)
          : d.objetivo === "mensagens" ? "https://api.whatsapp.com/send"
          : "http://fb.me/"; // link padrão do Meta para formulário instantâneo
        // no vídeo não existe "link" fora do botão; no WhatsApp o botão não pode levar link
        const cta =
          d.objetivo === "formulario" ? { type: c.cta, value: { link, lead_gen_form_id: d.formularioId } }
          : d.objetivo === "mensagens" ? (ehVideo ? { type: "WHATSAPP_MESSAGE" } : { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } })
          : { type: c.cta, value: { link } };
        const texto = textos.length ? textos[i % textos.length] : "";
        const titulo = titulos.length ? titulos[i % titulos.length] : "";
        const story = ehVideo
          ? { page_id: d.paginaId, video_data: {
              video_id: (midia as { id: string }).id, image_url: (midia as { miniatura: string }).miniatura,
              message: texto, title: titulo, call_to_action: cta,
            } }
          : { page_id: d.paginaId, link_data: {
              image_hash: (midia as { hash: string }).hash, link, message: texto, name: titulo,
              ...(c.descricao && { description: c.descricao }), call_to_action: cta,
            } };
        if (d.instagramId) Object.assign(story, { instagram_user_id: d.instagramId });
        const criativo = await postMeta(`${d.contaId}/adcreatives`, d.token, {
          name: nomeCriativo,
          object_story_spec: JSON.stringify(story),
        });
        for (const cj of conjuntos) {
          try {
            await postMeta(`${d.contaId}/ads`, d.token, {
              name: aplicarNome(c.nomeAnuncio, { ...nomeBase, conjunto: cj.nome }),
              adset_id: cj.id, status: "PAUSED", creative: JSON.stringify({ creative_id: criativo.id }),
            });
            anuncios++;
          } catch (e) {
            falhas.push(`${cr.nome} em “${cj.nome}”: ${e instanceof Error ? e.message : e}`);
          }
        }
      } catch (e) {
        falhas.push(`${cr.nome}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (!anuncios) throw new Error(`Nenhum anúncio foi criado. ${falhas.join(" | ")}`);
    return { campanhaId, campanhaNome, conjuntos: conjuntos.length, anuncios, falhas };
  } catch (e) {
    // desfaz: apaga a campanha (os conjuntos e os anúncios vão junto)
    await fetch(`${BASE_META}/${campanhaId}?access_token=${encodeURIComponent(d.token)}`, { method: "DELETE" }).catch(() => null);
    throw e;
  }
}
