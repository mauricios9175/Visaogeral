// UTMs a partir dos campos personalizados do CRM (cada cliente nomeia de um jeito: "utm_campaign", "Campanha", "Criativo"…).
// Arquivo sem "server-only": também é usado na tela de configuração do CRM.

export const PARAMETROS_UTM = ["source", "medium", "campaign", "content", "term"] as const;
export type ParametroUtm = (typeof PARAMETROS_UTM)[number];
export type MapaUtm = Partial<Record<ParametroUtm, string>>; // parâmetro → nome do campo no CRM

export const ROTULO_UTM: Record<ParametroUtm, string> = {
  source: "Origem (utm_source)",
  medium: "Mídia (utm_medium)",
  campaign: "Campanha (utm_campaign)",
  content: "Criativo / anúncio (utm_content)",
  term: "Público / termo (utm_term)",
};

const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Do mais específico para o mais genérico: "utm_campaign" ganha de "Campanha".
const DETECCAO: Record<ParametroUtm, RegExp[]> = {
  source: [/utm.?source/, /^(origem|source)( utm| da utm| do lead)?$/],
  medium: [/utm.?medium/, /^(midia|medium)( utm| da utm)?$/],
  campaign: [/utm.?campaign/, /^(nome da )?campanha( utm| da utm| do anuncio)?$/, /campanha/],
  content: [/utm.?content/, /^(criativo|anuncio|conteudo|ad|nome do anuncio)( utm| da utm)?$/, /criativo|anuncio/],
  term: [/utm.?term/, /^(publico|conjunto|conjunto de anuncios|termo|palavra.?chave|keyword)( utm| da utm)?$/, /publico|conjunto/],
};

// Campos que contêm a palavra mas não são UTM (ex.: "Valor da campanha", "Data do anúncio")
const IGNORAR = /valor|data|orcamento|custo|investimento|quantidade|\bid\b/;

/** Para cada parâmetro, o nome do campo que parece ser a UTM (entre os campos que existem). */
export function detectarMapa(nomes: string[]): MapaUtm {
  const mapa: MapaUtm = {};
  const usados = new Set<string>();
  for (const p of PARAMETROS_UTM) {
    for (const re of DETECCAO[p]) {
      const achado = nomes.find((n) => !usados.has(n) && !IGNORAR.test(normal(n)) && re.test(normal(n).trim()));
      if (achado) { mapa[p] = achado; usados.add(achado); break; }
    }
  }
  return mapa;
}

export type Utms = Record<ParametroUtm, string | null>;

/**
 * UTMs do negócio juntando a atribuição do CRM e os campos personalizados.
 * `mapa` é a escolha do usuário na configuração do CRM; sem ela, o campo é detectado pelo nome.
 */
export function completarUtms(
  atuais: Partial<Record<`utm_${ParametroUtm}`, string | null | undefined>>,
  campos: Record<string, string> | null | undefined,
  mapa?: MapaUtm | null,
): Utms {
  const auto = detectarMapa(Object.keys(campos ?? {}));
  const valor = (campo?: string) => (campo ? campos?.[campo]?.trim() || null : null);
  const out = {} as Utms;
  for (const p of PARAMETROS_UTM) {
    // ordem: campo escolhido pelo usuário > UTM que veio do CRM > campo detectado pelo nome
    out[p] = valor(mapa?.[p]) || atuais[`utm_${p}`]?.trim() || valor(auto[p]) || null;
  }
  return out;
}
