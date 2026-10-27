import "server-only";
import { getMeta, montarUrl, postMeta, todasPaginas, BASE_META } from "./meta";
import { aplicarNome, ROTULO_CURTO, type ConfigFormulario, type ConfigMeta, type ConjuntoMeta, type Interesse, type Local, type ObjetivoMeta } from "./modelos";
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

type Opcao = { id: string; nome: string };
const msgErro = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Páginas, Instagram e pixels de uma conta. Tenta vários caminhos, porque contas acessadas pela BM do cliente
 * nem sempre liberam todos:
 *  1. páginas promovidas pela conta (precisa de pages_show_list / pages_manage_ads);
 *  2. páginas e Instagram usados nos anúncios que a conta já tem (só precisa de ads_read);
 *  3. páginas da BM dona da conta;
 *  4. páginas do seu perfil.
 * Se nada vier, devolve os motivos para aparecerem na tela.
 */
export async function ativosDaConta(contaId: string, token: string) {
  const erros: string[] = [];
  const tentar = async <T,>(rotulo: string, f: () => Promise<T[]>) => {
    try {
      return await f();
    } catch (e) {
      erros.push(`${rotulo}: ${msgErro(e)}`);
      return [] as T[];
    }
  };
  type Pg = { id: string; name?: string; instagram_business_account?: { id: string; username?: string } };
  const listar = (caminho: string) => todasPaginas<Pg>(montarUrl(caminho, token, { fields: "id,name,instagram_business_account{id,username}", limit: "100" }));

  const [promovidas, contasIg, pixels, criativos, conta, doPerfil] = await Promise.all([
    tentar("páginas da conta", () => listar(`${contaId}/promote_pages`)),
    tentar("Instagram da conta", () => todasPaginas<{ id: string; username?: string }>(montarUrl(`${contaId}/instagram_accounts`, token, { fields: "id,username", limit: "100" }))),
    tentar("pixels", () => todasPaginas<{ id: string; name: string }>(montarUrl(`${contaId}/adspixels`, token, { fields: "id,name", limit: "100" }))),
    // anúncios que já existem na conta: de onde vêm a página e o Instagram usados
    tentar("anúncios da conta", async () => (await getMeta<{ data: {
      object_story_spec?: { page_id?: string; instagram_user_id?: string; instagram_actor_id?: string };
      effective_object_story_id?: string; instagram_user_id?: string; instagram_actor_id?: string;
    }[] }>(montarUrl(`${contaId}/adcreatives`, token, {
      fields: "object_story_spec{page_id,instagram_user_id,instagram_actor_id},effective_object_story_id,instagram_user_id,instagram_actor_id",
      limit: "100",
    }))).data),
    getMeta<{ name?: string; business?: { id: string } }>(montarUrl(contaId, token, { fields: "name,business" })).catch(() => null),
    tentar("páginas do perfil", () => listar("me/accounts")),
  ]);
  // páginas da BM dona da conta (servem também para descobrir nomes)
  const daBm = conta?.business?.id
    ? (await Promise.all(["owned_pages", "client_pages"].map((b) => tentar(`páginas da BM (${b})`, () => listar(`${conta.business!.id}/${b}`))))).flat()
    : [];

  // dicionários de nomes: tudo o que veio com nome, de qualquer fonte
  const nomePagina = new Map<string, string>();
  const nomeIg = new Map<string, string>();
  const igDaPagina = new Map<string, string>();
  for (const p of [...promovidas, ...daBm, ...doPerfil]) {
    if (p.name) nomePagina.set(p.id, p.name);
    const ig = p.instagram_business_account;
    if (ig) {
      igDaPagina.set(p.id, ig.id);
      if (ig.username) nomeIg.set(ig.id, `@${ig.username}`);
    }
  }
  for (const i of contasIg) if (i.username) nomeIg.set(i.id, `@${i.username}`);

  // páginas e Instagram que importam para esta conta: os promovidos e os usados nos anúncios
  const paginas = new Set(promovidas.map((p) => p.id));
  const instagram = new Set(contasIg.map((i) => i.id));
  const postDaPagina = new Map<string, string>();
  for (const c of criativos) {
    const pg = c.object_story_spec?.page_id ?? c.effective_object_story_id?.split("_")[0];
    if (pg) {
      paginas.add(pg);
      if (c.effective_object_story_id && !postDaPagina.has(pg)) postDaPagina.set(pg, c.effective_object_story_id);
    }
    const ig = c.object_story_spec?.instagram_user_id ?? c.instagram_user_id ?? c.object_story_spec?.instagram_actor_id ?? c.instagram_actor_id;
    if (ig) instagram.add(ig);
  }
  // sem nada na conta: as páginas da BM e, por último, as do perfil
  if (!paginas.size) for (const p of daBm.length ? daBm : doPerfil) paginas.add(p.id);
  for (const id of paginas) {
    const ig = igDaPagina.get(id);
    if (ig) instagram.add(ig);
  }

  // nomes que faltam: um por um (uma recusa não derruba os outros) e, para páginas, quem publicou o post do anúncio
  await Promise.all([...paginas].filter((id) => !nomePagina.has(id)).slice(0, 20).map(async (id) => {
    const r = await getMeta<Pg>(montarUrl(id, token, { fields: "name,instagram_business_account{id,username}" })).catch(() => null);
    const nome = r?.name ?? (postDaPagina.has(id)
      ? (await getMeta<{ from?: { name?: string } }>(montarUrl(postDaPagina.get(id)!, token, { fields: "from{name}" })).catch(() => null))?.from?.name
      : undefined);
    if (nome) nomePagina.set(id, nome);
    if (r?.instagram_business_account) {
      instagram.add(r.instagram_business_account.id);
      if (r.instagram_business_account.username) nomeIg.set(r.instagram_business_account.id, `@${r.instagram_business_account.username}`);
    }
  }));
  await Promise.all([...instagram].filter((id) => !nomeIg.has(id)).slice(0, 20).map(async (id) => {
    const r = await getMeta<{ username?: string; name?: string }>(montarUrl(id, token, { fields: "username,name" })).catch(() => null);
    if (r?.username) nomeIg.set(id, `@${r.username}`);
  }));

  // sem nome mesmo assim: um rótulo que diz de onde veio, em vez do número solto
  const deOnde = conta?.name ? ` de ${conta.name}` : "";
  const semNomePg = [...paginas].filter((id) => !nomePagina.has(id));
  const semNomeIg = [...instagram].filter((id) => !nomeIg.has(id));
  const rotulo = (base: string, lista: string[], id: string) =>
    `${base}${deOnde}${lista.length > 1 ? ` (${lista.indexOf(id) + 1})` : ""}`;
  const opcoes = (ids: Set<string>, nomes: Map<string, string>, base: string, sem: string[]): Opcao[] =>
    [...ids].map((id) => ({ id, nome: nomes.get(id) ?? rotulo(base, sem, id) })).sort((a, b) => a.nome.localeCompare(b.nome));
  return {
    paginas: opcoes(paginas, nomePagina, "Página usada nos anúncios", semNomePg),
    instagram: opcoes(instagram, nomeIg, "Instagram usado nos anúncios", semNomeIg),
    pixels: pixels.map((p) => ({ id: p.id, nome: p.name })),
    erro: paginas.size ? undefined : `Nenhuma página encontrada para esta conta. ${erros.join(" · ")}`,
  };
}

/** O Meta exige o token da própria página para listar e criar formulários. */
/**
 * Por que o login do Facebook não dá acesso à página: falta a permissão ou a página não foi escolhida no
 * "Login com Facebook para Empresas" (ele pergunta quais páginas liberar). Usa o debug_token do app.
 */
async function diagnosticoPagina(paginaId: string, token: string) {
  const app = `${process.env.META_APP_ID ?? ""}|${process.env.META_APP_SECRET ?? ""}`;
  const d = await getMeta<{ data?: { scopes?: string[]; granular_scopes?: { scope: string; target_ids?: string[] }[] } }>(
    montarUrl("debug_token", app, { input_token: token }),
  ).then((r) => r.data, () => null);
  if (!d) return "Não consegui conferir as permissões do login do Facebook.";
  const faltando = ["pages_show_list", "pages_manage_ads"].filter((p) => !d.scopes?.includes(p));
  if (faltando.length) {
    return `O login do Facebook conectado no painel não tem a permissão ${faltando.join(" e ")}. ` +
      "Confira se elas estão na configuração do Login do app no Meta e clique em “Conectar / reconectar perfil” em Configurações, aceitando tudo.";
  }
  const alvos = d.granular_scopes?.find((g) => g.scope === "pages_manage_ads" || g.scope === "pages_show_list")?.target_ids;
  if (alvos && !alvos.includes(paginaId)) {
    return "Esta página não foi liberada no login do Facebook. Em Configurações, clique em “Conectar / reconectar perfil” e, " +
      "na tela de escolher as páginas, marque esta página (ou “todas as páginas atuais e futuras”).";
  }
  return "O Meta não liberou o acesso à página para o painel.";
}

/** O Meta exige o token da própria página para listar e criar formulários. */
async function tokenDaPagina(paginaId: string, token: string) {
  const direto = await getMeta<{ access_token?: string }>(montarUrl(paginaId, token, { fields: "access_token" }))
    .then((r) => r.access_token, () => undefined);
  if (direto) return direto;
  // segundo caminho: a lista de páginas do perfil traz o token de cada uma
  const doPerfil = await todasPaginas<{ id: string; access_token?: string }>(montarUrl("me/accounts", token, { fields: "id,access_token", limit: "100" }))
    .then((l) => l.find((p) => p.id === paginaId)?.access_token, () => undefined);
  if (doPerfil) return doPerfil;
  throw new Error(`Sem acesso aos formulários desta página. ${await diagnosticoPagina(paginaId, token)}`);
}

/** Formulários instantâneos ativos da página. */
export async function formulariosDaPagina(paginaId: string, token: string) {
  const tokenPagina = await tokenDaPagina(paginaId, token);
  const forms = await todasPaginas<{ id: string; name: string; status: string }>(
    montarUrl(`${paginaId}/leadgen_forms`, tokenPagina, { fields: "id,name,status", limit: "100" }),
  );
  return forms.filter((f) => f.status === "ACTIVE").map((f) => ({ id: f.id, nome: f.name }));
}

type Politica = { rotulo: string; params: Record<string, string> };

/**
 * A API exige política de privacidade (ou um conteúdo legal já existente). Candidatas, nesta ordem:
 * 1. o link do modelo; 2. o conteúdo legal e o link dos formulários da página (o que o Gerenciador reaproveita);
 * 3. o site cadastrado na página do Facebook. A criação tenta uma por uma até o Meta aceitar.
 */
async function politicasCandidatas(paginaId: string, tokenPagina: string, f: ConfigFormulario): Promise<Politica[]> {
  const texto = f.politicaTexto || "Política de privacidade";
  const porLink = (rotulo: string, url: string, linkText = texto): Politica =>
    ({ rotulo, params: { privacy_policy: JSON.stringify({ url, link_text: linkText }) } });
  const lista: Politica[] = [];
  if (f.politicaUrl) lista.push(porLink("link do modelo", f.politicaUrl));

  type Form = { id: string; name?: string; privacy_policy_url?: string; legal_content?: { id?: string; privacy_policy?: { url?: string; link_text?: string } } };
  // dois jeitos de ler: o campo legal_content pode não estar disponível em todas as versões/páginas
  const ler = (campos: string) => getMeta<{ data: Form[] }>(montarUrl(`${paginaId}/leadgen_forms`, tokenPagina, { fields: campos, limit: "25" }))
    .then((r) => r.data, () => [] as Form[]);
  const [completos, simples] = await Promise.all([ler("id,name,legal_content{id,privacy_policy}"), ler("id,name,privacy_policy_url")]);
  for (const x of completos) {
    const url = x.legal_content?.privacy_policy?.url;
    if (url) lista.push(porLink(`política do formulário “${x.name ?? x.id}”`, url, x.legal_content?.privacy_policy?.link_text || texto));
    if (x.legal_content?.id) lista.push({ rotulo: `conteúdo legal do formulário “${x.name ?? x.id}”`, params: { legal_content_id: x.legal_content.id } });
  }
  for (const x of simples) if (x.privacy_policy_url) lista.push(porLink(`política do formulário “${x.name ?? x.id}”`, x.privacy_policy_url));

  const site = await getMeta<{ website?: string }>(montarUrl(paginaId, tokenPagina, { fields: "website" })).then((r) => r.website, () => undefined);
  const primeiroSite = site?.split(/\s+/).find((u) => /^https?:\/\//i.test(u)) ?? (site && /^[\w.-]+\.[a-z]{2,}/i.test(site) ? `https://${site.split(/\s+/)[0]}` : undefined);
  if (primeiroSite) lista.push(porLink("site cadastrado na página", primeiroSite));

  // sem repetidos (o mesmo link pode aparecer em vários formulários)
  const vistos = new Set<string>();
  return lista.filter((p) => { const k = JSON.stringify(p.params); return !vistos.has(k) && !!vistos.add(k); }).slice(0, 6);
}

/** Cria um formulário instantâneo na página a partir do modelo. Devolve o id do formulário. */
export async function criarFormulario(paginaId: string, token: string, f: ConfigFormulario, vars: Record<string, string>) {
  const tokenPagina = await tokenDaPagina(paginaId, token);
  const perguntas = f.perguntas.map((p, i) => {
    if (p.tipo !== "CUSTOM") return { type: p.tipo };
    const opcoes = p.opcoes.map((o) => o.trim()).filter(Boolean);
    return {
      type: "CUSTOM", key: `pergunta_${i + 1}`, label: p.rotulo,
      ...(opcoes.length && { options: opcoes.map((o, j) => ({ key: `opcao_${i + 1}_${j + 1}`, value: o })) }),
    };
  });
  const base = {
    name: aplicarNome(f.nome, vars),
    locale: "PT_BR",
    questions: JSON.stringify(perguntas),
    ...(f.tituloPerguntas && { question_page_custom_headline: f.tituloPerguntas }),
    is_optimized_for_quality: f.tipo === "intencao" ? "true" : "false",
    ...(f.introTitulo && {
      context_card: JSON.stringify({ title: f.introTitulo, style: "PARAGRAPH_STYLE", content: [f.introTexto || f.introTitulo] }),
    }),
    thank_you_page: JSON.stringify({
      title: f.agradecimentoTitulo || "Obrigado!",
      body: f.agradecimentoTexto || "Em breve entraremos em contato.",
      ...(f.botaoUrl
        ? { button_type: "VIEW_WEBSITE", button_text: f.botaoTexto || "Saiba mais", website_url: f.botaoUrl }
        : { button_type: "VIEW_ON_FACEBOOK", button_text: f.botaoTexto || "Ver página" }),
    }),
  };
  const politicas = await politicasCandidatas(paginaId, tokenPagina, f);
  if (!politicas.length) {
    throw new Error(
      "o Meta exige uma política de privacidade e não encontrei nenhuma para reaproveitar nesta página " +
      "(nenhum formulário com política e nenhum site cadastrado na página). Informe o link da política no modelo de formulário.",
    );
  }
  // tenta cada política até o Meta aceitar; outros erros (pergunta inválida etc.) param na hora
  const tentativas: string[] = [];
  for (const pol of politicas) {
    try {
      const r = await postMeta(`${paginaId}/leadgen_forms`, tokenPagina, { ...base, ...pol.params });
      return { id: String(r.id), arquivar: () => postMeta(String(r.id), tokenPagina, { status: "ARCHIVED" }).catch(() => null) };
    } catch (e) {
      if (!/privacy|legal_content|privacidade|conte[uú]do legal/i.test(msgErro(e))) throw e;
      tentativas.push(`${pol.rotulo}: ${msgErro(e)}`);
    }
  }
  throw new Error(`o Meta recusou as políticas de privacidade encontradas. Tentativas: ${tentativas.join(" | ")}. Informe o link da política no modelo de formulário.`);
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
  /** objetivo formulário: em vez de um formulário existente, cria um novo na página a partir deste modelo */
  modeloFormulario?: ConfigFormulario | null;
  /** se nenhum anúncio puder ser criado, manter campanha, conjuntos e formulário (pausados) em vez de desfazer */
  manterSemAnuncios?: boolean;
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

  // 0. formulário novo a partir do modelo (se a montagem falhar depois, ele é arquivado)
  let arquivarFormulario: (() => Promise<unknown>) | null = null;
  if (d.objetivo === "formulario" && d.modeloFormulario) {
    try {
      const f = await criarFormulario(d.paginaId, d.token, d.modeloFormulario, vars);
      d = { ...d, formularioId: f.id };
      arquivarFormulario = f.arquivar;
    } catch (e) {
      throw new Error(`Formulário: ${msgErro(e)}`);
    }
  }
  if (d.objetivo === "formulario" && !d.formularioId) throw new Error("Escolha o formulário.");

  // 1. campanha
  const objetivoMeta = d.objetivo === "mensagens" ? "OUTCOME_ENGAGEMENT" : "OUTCOME_LEADS";
  let campanha: { id: string };
  try {
    campanha = await postMeta(`${d.contaId}/campaigns`, d.token, {
      name: campanhaNome,
      objective: objetivoMeta,
      status: "PAUSED",
      special_ad_categories: "[]",
      ...(c.orcamentoEm === "campanha"
        ? { daily_budget: centavos(c.orcamentoDiario), bid_strategy: "LOWEST_COST_WITHOUT_CAP" }
        : { is_adset_budget_sharing_enabled: "false" }),
    });
  } catch (e) {
    await arquivarFormulario?.();
    throw e;
  }
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
    // o mesmo motivo repetido em cada conjunto vira uma linha só
    const motivos = [...new Set(falhas.map((f) => f.replace(/^.*?: /, "")))];
    const resumo = motivos.length === 1 && falhas.length > 1 ? [`${falhas.length} anúncio(s): ${motivos[0]}`] : falhas;
    if (!anuncios && !d.manterSemAnuncios) throw new Error(`Nenhum anúncio foi criado. ${resumo.join(" | ")}`);
    return { campanhaId, campanhaNome, conjuntos: conjuntos.length, anuncios, falhas: resumo, formularioCriado: arquivarFormulario ? d.formularioId : null };
  } catch (e) {
    // desfaz: apaga a campanha (os conjuntos e os anúncios vão junto) e arquiva o formulário criado agora
    await fetch(`${BASE_META}/${campanhaId}?access_token=${encodeURIComponent(d.token)}`, { method: "DELETE" }).catch(() => null);
    await arquivarFormulario?.();
    throw e;
  }
}
