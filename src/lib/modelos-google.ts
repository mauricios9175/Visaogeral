// Modelos de campanha do Google Ads (Pesquisa e Performance Max). Arquivo sem "server-only": tipos e padrões também
// vão para os formulários.

export const OBJETIVO_GOOGLE = "pesquisa"; // valor da coluna "objetivo" na tabela modelos (plataforma google)
export const OBJETIVO_PMAX = "pmax";

export type TipoGoogle = "pesquisa" | "pmax";
export const TIPOS_GOOGLE: Record<TipoGoogle, { rotulo: string; descricao: string }> = {
  pesquisa: { rotulo: "Pesquisa", descricao: "Anúncios de texto no Google, por palavra-chave" },
  pmax: { rotulo: "Performance Max", descricao: "Um grupo de recursos (textos + imagens) em todas as redes do Google" },
};

export type Correspondencia = "AMPLA" | "FRASE" | "EXATA";
export const CORRESPONDENCIAS: Record<Correspondencia, { rotulo: string; api: "BROAD" | "PHRASE" | "EXACT"; exemplo: (t: string) => string }> = {
  AMPLA: { rotulo: "Ampla", api: "BROAD", exemplo: (t) => t },
  FRASE: { rotulo: "Frase", api: "PHRASE", exemplo: (t) => `"${t}"` },
  EXATA: { rotulo: "Exata", api: "EXACT", exemplo: (t) => `[${t}]` },
};

export type PalavraChave = { texto: string; correspondencia: Correspondencia };
/** Grupo de anúncios de Pesquisa: palavras-chave e o anúncio responsivo dele (títulos que conversam com as palavras). */
export type GrupoGoogle = {
  nome: string;
  palavras: PalavraChave[];
  titulos: string[];     // 3 a 15, até 30 caracteres
  descricoes: string[];  // 2 a 4, até 90 caracteres
  url: string;           // vazio = o link da campanha
  caminho1: string;      // vazio = o da campanha
  caminho2: string;
};
/** Local do Google (geoTargetConstant). */
export type LocalGoogle = { id: string; nome: string; tipo: string };
export type Sitelink = { texto: string; descricao1: string; descricao2: string; url: string };
/** Grupo de recursos da Performance Max (as imagens são escolhidas na montagem). */
export type RecursosPmax = { nomeEmpresa: string; titulos: string[]; titulosLongos: string[]; descricoes: string[]; temas: string[] };

export type LanceGoogle = "maximizar_conversoes" | "cpa_desejado" | "maximizar_cliques";
export const LANCES: Record<LanceGoogle, string> = {
  maximizar_conversoes: "Maximizar conversões",
  cpa_desejado: "Maximizar conversões com CPA desejado",
  maximizar_cliques: "Maximizar cliques (só Pesquisa)",
};

export type ConfigGoogle = {
  tipo: TipoGoogle;
  nomeCampanha: string;      // aceita {cliente}, {data} e {cidade}
  orcamentoDiario: number;
  lance: LanceGoogle;
  cpaDesejado: number;       // só com "cpa_desejado"
  parceiros: boolean;        // Pesquisa: rede de parceiros de pesquisa
  locais: LocalGoogle[];
  grupos: GrupoGoogle[];     // Pesquisa
  negativas: PalavraChave[]; // Pesquisa: palavras negativas da campanha
  pmax: RecursosPmax;        // Performance Max
  url: string;               // link padrão (dos grupos sem link próprio e da Performance Max)
  caminho1: string;          // até 15 caracteres (site.com.br/caminho1/caminho2)
  caminho2: string;
  sitelinks: Sitelink[];
  frases: string[];          // frases de destaque
  parametrosUrl: string;     // sufixo do link; aceita {campanha} e {grupo}, e os do Google ({keyword}, {matchtype}…)
};

export const LIMITES = {
  titulo: 30, tituloLongo: 90, descricao: 90, descricaoCurta: 60, caminho: 15, nomeEmpresa: 25,
  titulos: 15, descricoes: 4, descricoesPmax: 5, titulosLongos: 5, temas: 25,
  sitelinkTexto: 25, sitelinkDescricao: 35, sitelinks: 8, frase: 25, frases: 10,
};

export const PARAMETROS_URL_GOOGLE =
  "utm_source=google&utm_medium=cpc&utm_campaign={campanha}&utm_content={grupo}&utm_term={keyword}";

export const grupoVazio = (nome = "Principal"): GrupoGoogle => ({ nome, palavras: [], titulos: ["", "", ""], descricoes: ["", ""], url: "", caminho1: "", caminho2: "" });

export const CONFIG_GOOGLE_PADRAO: ConfigGoogle = {
  tipo: "pesquisa",
  nomeCampanha: "[Pesquisa] {cliente} - {data}",
  orcamentoDiario: 30,
  lance: "maximizar_conversoes",
  cpaDesejado: 0,
  parceiros: false,
  locais: [],
  grupos: [grupoVazio()],
  negativas: [
    { texto: "grátis", correspondencia: "AMPLA" }, { texto: "vagas", correspondencia: "AMPLA" },
    { texto: "emprego", correspondencia: "AMPLA" }, { texto: "curso", correspondencia: "AMPLA" },
  ],
  pmax: { nomeEmpresa: "", titulos: ["", "", ""], titulosLongos: [""], descricoes: ["", ""], temas: [] },
  url: "",
  caminho1: "",
  caminho2: "",
  sitelinks: [],
  frases: [],
  parametrosUrl: PARAMETROS_URL_GOOGLE,
};

const CORR = new Set(Object.keys(CORRESPONDENCIAS));
const palavra = (p: Partial<PalavraChave> | string): PalavraChave | null => {
  const texto = String(typeof p === "string" ? p : p?.texto ?? "").replace(/[[\]"]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!texto) return null;
  const c = typeof p === "string" ? "FRASE" : String(p?.correspondencia ?? "FRASE").toUpperCase();
  return { texto: texto.toLowerCase(), correspondencia: (CORR.has(c) ? c : "FRASE") as Correspondencia };
};
const semRepetir = (ps: PalavraChave[]) => {
  const vistos = new Set<string>();
  return ps.filter((p) => { const k = `${p.texto}|${p.correspondencia}`; return !vistos.has(k) && !!vistos.add(k); });
};
const textos = (v: unknown, max: number, min = 0) => {
  const l = (Array.isArray(v) ? v : []).map((t) => String(t ?? "")).slice(0, max);
  while (l.length < min) l.push("");
  return l;
};

/** Modelo antigo (anúncio único para a campanha) ou parcial → formato atual. */
type Legado = { titulos?: string[]; descricoes?: string[] };

export function normalizarGoogle(c: (Partial<ConfigGoogle> & Legado) | null | undefined): ConfigGoogle {
  const b = CONFIG_GOOGLE_PADRAO;
  const grupos = (c?.grupos ?? []).map((g: Partial<GrupoGoogle>) => ({
    nome: String(g?.nome ?? "").trim().slice(0, 100) || "Grupo",
    palavras: semRepetir((g?.palavras ?? []).map(palavra).filter((x): x is PalavraChave => !!x)),
    // modelos antigos: o anúncio da campanha vira o anúncio de cada grupo
    titulos: textos(g?.titulos ?? c?.titulos, LIMITES.titulos, 3),
    descricoes: textos(g?.descricoes ?? c?.descricoes, LIMITES.descricoes, 2),
    url: String(g?.url ?? ""),
    caminho1: String(g?.caminho1 ?? "").slice(0, LIMITES.caminho),
    caminho2: String(g?.caminho2 ?? "").slice(0, LIMITES.caminho),
  }));
  const pm = c?.pmax;
  return {
    tipo: c?.tipo === "pmax" ? "pmax" : "pesquisa",
    nomeCampanha: String(c?.nomeCampanha ?? b.nomeCampanha),
    orcamentoDiario: Number(c?.orcamentoDiario) > 0 ? Number(c?.orcamentoDiario) : b.orcamentoDiario,
    lance: c?.lance && c.lance in LANCES ? c.lance : b.lance,
    cpaDesejado: Math.max(0, Number(c?.cpaDesejado) || 0),
    parceiros: Boolean(c?.parceiros),
    locais: (c?.locais ?? []).filter((l) => l?.id),
    grupos: grupos.length ? grupos : [grupoVazio()],
    negativas: c?.negativas ? semRepetir(c.negativas.map(palavra).filter((x): x is PalavraChave => !!x)) : b.negativas,
    pmax: {
      nomeEmpresa: String(pm?.nomeEmpresa ?? "").slice(0, 40),
      titulos: textos(pm?.titulos, LIMITES.titulos, 3),
      titulosLongos: textos(pm?.titulosLongos, LIMITES.titulosLongos, 1),
      descricoes: textos(pm?.descricoes, LIMITES.descricoesPmax, 2),
      temas: (pm?.temas ?? []).map((t) => String(t ?? "").trim()).filter(Boolean).slice(0, LIMITES.temas),
    },
    url: String(c?.url ?? ""),
    caminho1: String(c?.caminho1 ?? "").slice(0, LIMITES.caminho),
    caminho2: String(c?.caminho2 ?? "").slice(0, LIMITES.caminho),
    sitelinks: (c?.sitelinks ?? []).slice(0, LIMITES.sitelinks).map((x) => ({
      texto: String(x?.texto ?? ""), descricao1: String(x?.descricao1 ?? ""), descricao2: String(x?.descricao2 ?? ""), url: String(x?.url ?? ""),
    })),
    frases: (c?.frases ?? []).map((t) => String(t ?? "")).slice(0, LIMITES.frases),
    parametrosUrl: String(c?.parametrosUrl ?? b.parametrosUrl),
  };
}

/** Uma por linha, como no Google Ads: sem nada = ampla, "entre aspas" = frase, [entre colchetes] = exata. */
export function lerPalavras(texto: string): PalavraChave[] {
  return texto.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean).map((t) => {
    const c: Correspondencia = /^\[.*\]$/.test(t) ? "EXATA" : /^".*"$/.test(t) ? "FRASE" : "AMPLA";
    return palavra({ texto: t, correspondencia: c });
  }).filter((x): x is PalavraChave => !!x);
}

/** O inverso de lerPalavras: as palavras no formato do Google Ads, uma por linha. */
export const escreverPalavras = (ps: PalavraChave[]) => ps.map((p) => CORRESPONDENCIAS[p.correspondencia].exemplo(p.texto)).join("\n");

const URL_OK = (u: string) => /^https?:\/\/\S+\.\S+/.test(u.trim());
const cheios = (l: string[]) => l.map((x) => x.trim()).filter(Boolean);

/** O que falta para o Google aceitar a campanha (null = tudo certo). As imagens da Performance Max são conferidas na montagem. */
export function problemasDoAnuncio(c: ConfigGoogle): string | null {
  const longo = (l: string[], lim: number) => cheios(l).find((x) => x.length > lim);
  if (c.tipo === "pmax") {
    const p = c.pmax;
    if (!p.nomeEmpresa.trim()) return "Informe o nome da empresa.";
    if (p.nomeEmpresa.trim().length > LIMITES.nomeEmpresa) return `Nome da empresa com mais de ${LIMITES.nomeEmpresa} caracteres.`;
    if (cheios(p.titulos).length < 3) return "A Performance Max precisa de pelo menos 3 títulos.";
    if (cheios(p.titulosLongos).length < 1) return "A Performance Max precisa de pelo menos 1 título longo.";
    if (cheios(p.descricoes).length < 2) return "A Performance Max precisa de pelo menos 2 descrições.";
    if (!cheios(p.descricoes).some((x) => x.length <= LIMITES.descricaoCurta)) return `Pelo menos uma descrição precisa ter até ${LIMITES.descricaoCurta} caracteres.`;
    const x = longo(p.titulos, LIMITES.titulo) ?? longo(p.titulosLongos, LIMITES.tituloLongo) ?? longo(p.descricoes, LIMITES.descricao);
    if (x) return `Texto acima do limite: “${x}”.`;
    if (!URL_OK(c.url)) return "Informe o link do site (começando com https://).";
  } else {
    const comPalavras = c.grupos.filter((g) => g.palavras.length);
    if (!comPalavras.length) return "Coloque pelo menos uma palavra-chave.";
    for (const g of comPalavras) {
      if (cheios(g.titulos).length < 3) return `O grupo “${g.nome}” precisa de pelo menos 3 títulos.`;
      if (cheios(g.descricoes).length < 2) return `O grupo “${g.nome}” precisa de pelo menos 2 descrições.`;
      const x = longo(g.titulos, LIMITES.titulo) ?? longo(g.descricoes, LIMITES.descricao);
      if (x) return `Texto acima do limite no grupo “${g.nome}”: “${x}”.`;
      if (!URL_OK(g.url || c.url)) return `Informe o link do site (da campanha ou do grupo “${g.nome}”).`;
    }
  }
  for (const s of c.sitelinks.filter((x) => x.texto.trim())) {
    if (s.texto.trim().length > LIMITES.sitelinkTexto) return `Sitelink “${s.texto}” passa de ${LIMITES.sitelinkTexto} caracteres.`;
    if ([s.descricao1, s.descricao2].some((d) => d.trim().length > LIMITES.sitelinkDescricao)) return `Descrição do sitelink “${s.texto}” passa de ${LIMITES.sitelinkDescricao} caracteres.`;
    if (!!s.descricao1.trim() !== !!s.descricao2.trim()) return `Sitelink “${s.texto}”: preencha as duas descrições ou nenhuma.`;
    if (!URL_OK(s.url || c.url)) return `Sitelink “${s.texto}” sem link.`;
  }
  const frase = cheios(c.frases).find((x) => x.length > LIMITES.frase);
  if (frase) return `Frase de destaque passa de ${LIMITES.frase} caracteres: “${frase}”.`;
  return null;
}
