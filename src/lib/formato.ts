const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const dinheiro = (v: number | null | undefined) => (v == null ? "—" : brl.format(v));
export const inteiro = (v: number | null | undefined) => (v == null ? "—" : int.format(v));
export const decimal = (v: number | null | undefined) => (v == null ? "—" : dec.format(v));
export const pct = (v: number | null | undefined) => (v == null ? "—" : `${dec.format(v)}%`);

/** Variação percentual entre dois valores (null se não dá pra comparar). */
export function variacao(atual: number | null, anterior: number | null): number | null {
  if (atual == null || anterior == null || anterior === 0) return null;
  return ((atual - anterior) / anterior) * 100;
}

export function dataCurta(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

export function quandoFoi(iso: string | null) {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

/** Dias que faltam até uma data (negativo se já passou). */
export function diasAte(iso: string) {
  return Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
}
