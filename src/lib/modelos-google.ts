// Modelos de campanha de Pesquisa do Google Ads. Arquivo sem "server-only": tipos e padrões também vão para os formulários.

export const OBJETIVO_GOOGLE = "pesquisa"; // valor da coluna "objetivo" na tabela modelos (plataforma google)

export type Correspondencia = "AMPLA" | "FRASE" | "EXATA";
export const CORRESPONDENCIAS: Record<Correspondencia, { rotulo: string; api: "BROAD" | "PHRASE" | "EXACT"; exemplo: (t: string) => string }> = {
  AMPLA: { rotulo: "Ampla", api: "BROAD", exemplo: (t) => t },
  FRASE: { rotulo: "Frase", api: "PHRASE", exemplo: (t) => `"${t}"` },
  EXATA: { rotulo: "Exata", api: "EXACT", exemplo: (t) => `[${t}]` },
};

export type PalavraChave = { texto: string; correspondencia: Correspondencia };
export type GrupoGoogle = { nome: string; palavras: PalavraChave[] };
/** Local do Google (geoTargetConstant). */
export type LocalGoogle = { id: string; nome: string; tipo: string };

export type LanceGoogle = "maximizar_conversoes" | "cpa_desejado" | "maximizar_cliques";
export const LANCES: Record<LanceGoogle, string> = {
  maximizar_conversoes: "Maximizar conversões",
  cpa_desejado: "Maximizar conversões com CPA desejado",
  maximizar_cliques: "Maximizar cliques",
};

export type ConfigGoogle = {
  nomeCampanha: string;      // aceita {cliente}, {data} e {cidade}
  orcamentoDiario: number;
  lance: LanceGoogle;
  cpaDesejado: number;       // só com "cpa_desejado"
  parceiros: boolean;        // rede de parceiros de pesquisa
  locais: LocalGoogle[];
  grupos: GrupoGoogle[];
  negativas: PalavraChave[]; // palavras negativas da campanha
  titulos: string[];         // anúncio responsivo: 3 a 15, até 30 caracteres
  descricoes: string[];      // 2 a 4, até 90 caracteres
  url: string;
  caminho1: string;          // até 15 caracteres (aparece no link: site.com.br/caminho1/caminho2)
  caminho2: string;
  parametrosUrl: string;     // sufixo do link; aceita {campanha} e {grupo}, e os do Google ({keyword}, {matchtype}…)
};

export const LIMITES = { titulo: 30, descricao: 90, caminho: 15, titulos: 15, descricoes: 4 };

export const PARAMETROS_URL_GOOGLE =
  "utm_source=google&utm_medium=cpc&utm_campaign={campanha}&utm_content={grupo}&utm_term={keyword}";

export const CONFIG_GOOGLE_PADRAO: ConfigGoogle = {
  nomeCampanha: "[Pesquisa] {cliente} - {data}",
  orcamentoDiario: 30,
  lance: "maximizar_conversoes",
  cpaDesejado: 0,
  parceiros: false,
  locais: [],
  grupos: [{ nome: "Principal", palavras: [] }],
  negativas: [
    { texto: "grátis", correspondencia: "AMPLA" }, { texto: "vagas", correspondencia: "AMPLA" },
    { texto: "emprego", correspondencia: "AMPLA" }, { texto: "curso", correspondencia: "AMPLA" },
  ],
  titulos: ["", "", ""],
  descricoes: ["", ""],
  url: "",
  caminho1: "",
  caminho2: "",
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

export function normalizarGoogle(c: Partial<ConfigGoogle> | null | undefined): ConfigGoogle {
  const b = CONFIG_GOOGLE_PADRAO;
  const grupos = (c?.grupos ?? []).map((g) => ({
    nome: String(g?.nome ?? "").trim().slice(0, 100) || "Grupo",
    palavras: semRepetir((g?.palavras ?? []).map(palavra).filter((x): x is PalavraChave => !!x)),
  }));
  return {
    nomeCampanha: String(c?.nomeCampanha ?? b.nomeCampanha),
    orcamentoDiario: Number(c?.orcamentoDiario) > 0 ? Number(c?.orcamentoDiario) : b.orcamentoDiario,
    lance: c?.lance && c.lance in LANCES ? c.lance : b.lance,
    cpaDesejado: Math.max(0, Number(c?.cpaDesejado) || 0),
    parceiros: Boolean(c?.parceiros),
    locais: (c?.locais ?? []).filter((l) => l?.id),
    grupos: grupos.length ? grupos : b.grupos,
    negativas: c?.negativas ? semRepetir(c.negativas.map(palavra).filter((x): x is PalavraChave => !!x)) : b.negativas,
    titulos: (c?.titulos ?? b.titulos).map((t) => String(t ?? "")).slice(0, LIMITES.titulos),
    descricoes: (c?.descricoes ?? b.descricoes).map((t) => String(t ?? "")).slice(0, LIMITES.descricoes),
    url: String(c?.url ?? ""),
    caminho1: String(c?.caminho1 ?? "").slice(0, LIMITES.caminho),
    caminho2: String(c?.caminho2 ?? "").slice(0, LIMITES.caminho),
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

/** O que falta para o anúncio responsivo ser aceito pelo Google. */
export function problemasDoAnuncio(c: ConfigGoogle): string | null {
  const t = c.titulos.map((x) => x.trim()).filter(Boolean);
  const d = c.descricoes.map((x) => x.trim()).filter(Boolean);
  if (t.length < 3) return "O anúncio precisa de pelo menos 3 títulos.";
  if (d.length < 2) return "O anúncio precisa de pelo menos 2 descrições.";
  const longo = t.find((x) => x.length > LIMITES.titulo) ?? d.find((x) => x.length > LIMITES.descricao);
  if (longo) return `Texto acima do limite: “${longo}”.`;
  if (!/^https?:\/\/\S+\.\S+/.test(c.url.trim())) return "Informe o link do site (começando com https://).";
  if (!c.grupos.some((g) => g.palavras.length)) return "Coloque pelo menos uma palavra-chave.";
  return null;
}
