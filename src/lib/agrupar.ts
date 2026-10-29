// Junta no relatório os conjuntos/anúncios que são o mesmo público ou o mesmo criativo,
// duplicados em campanhas ou conjuntos diferentes para teste. A chave sai do nome.

/** Tira "- Cópia", "copy", "(2)" e espaços extras, que o Gerenciador acrescenta ao duplicar. */
function semCopia(nome: string) {
  return nome
    .replace(/\s*[-–]?\s*(c[oó]pia|copy)(\s*\d+)?\s*$/i, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Código de numeração no começo do nome: "CJ 03", "AN T28", "AD02", "C1"… */
const CODIGO = /^(cj|conj|conjunto|an|ad|anuncio|anúncio|c)\s*[a-z]?\d+$/i;

/**
 * Público de um conjunto pelo nome.
 * - "[IG][geo][24a 64 anos][Envolvimento 365D] video magali 1" → "[IG][geo][24a 64 anos][Envolvimento 365D]"
 * - "CJ 03 | FORM | AUTO | SANTO ANDRE | Momento da vida" → "FORM | AUTO | SANTO ANDRE | Momento da vida"
 */
export function nomeDoPublico(nome: string) {
  let n = semCopia(nome);
  const fim = n.lastIndexOf("]");
  if (n.startsWith("[") && fim > 0) n = n.slice(0, fim + 1);
  const partes = n.split("|").map((p) => p.trim()).filter(Boolean);
  if (partes.length > 1 && CODIGO.test(partes[0])) n = partes.slice(1).join(" | ");
  return n;
}

/** Criativo de um anúncio pelo nome: mesmo nome = mesmo anúncio. */
export function nomeDoAnuncio(nome: string) {
  return semCopia(nome);
}

/** Chave de comparação (sem diferença de maiúsculas, acentos e espaços: "24 a 64" = "24a 64"). */
export function chaveDe(nome: string) {
  return nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, "");
}

/**
 * Agrupa itens pela chave do nome e soma os números. `somar` junta dois itens do mesmo grupo.
 * Devolve o nome do grupo (como apareceu primeiro) e quantos itens foram juntados.
 */
export function agruparPorNome<T>(itens: T[], nomeDe: (x: T) => string, normalizar: (n: string) => string, somar: (a: T, b: T) => T) {
  const grupos = new Map<string, { nome: string; item: T; juntos: number }>();
  for (const x of itens) {
    const nome = normalizar(nomeDe(x));
    const k = chaveDe(nome);
    const g = grupos.get(k);
    if (g) grupos.set(k, { nome: g.nome, item: somar(g.item, x), juntos: g.juntos + 1 });
    else grupos.set(k, { nome, item: x, juntos: 1 });
  }
  return [...grupos.values()];
}

/** Nível do Meta/Google que cada UTM costuma repetir no nome (ex.: utm_content={{ad.name}}). */
export const NIVEL_DA_UTM: Record<string, "campanha" | "conjunto" | "anuncio" | null> = {
  utm_campaign: "campanha", utm_medium: "conjunto", utm_term: "conjunto", utm_content: "anuncio", utm_source: null,
};

/** Gasto por nome (chave sem maiúsculas/acentos/espaços), para cruzar o valor da UTM com o investido. */
export function gastoPorNome(itens: { nome: string; gasto: number }[]) {
  const mapa = new Map<string, number>();
  for (const x of itens) {
    const k = chaveDe(x.nome);
    mapa.set(k, (mapa.get(k) ?? 0) + Number(x.gasto));
  }
  return mapa;
}
