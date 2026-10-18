const FUSO = "America/Sao_Paulo";

/** Data de hoje em Brasília, no formato AAAA-MM-DD. */
export function hojeISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date());
}

export function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function diasAtras(dias: number): string {
  return somarDias(hojeISO(), -dias);
}

export function diasEntre(desde: string, ate: string): number {
  return Math.round((Date.parse(ate) - Date.parse(desde)) / 86_400_000) + 1;
}

export type Periodo = { chave: string; rotulo: string; desde: string; ate: string };

export const PERIODOS = [
  { chave: "mes", rotulo: "Este mês" },
  { chave: "7", rotulo: "7 dias" },
  { chave: "14", rotulo: "14 dias" },
  { chave: "30", rotulo: "30 dias" },
] as const;

/** Resolve o período escolhido e o período anterior equivalente, para comparação. */
export function resolverPeriodo(chave: string | undefined): { atual: Periodo; anterior: Periodo } {
  const hoje = hojeISO();
  const p = PERIODOS.find((x) => x.chave === chave) ?? PERIODOS[0];
  if (p.chave === "mes") {
    const desde = `${hoje.slice(0, 8)}01`;
    const dias = diasEntre(desde, hoje);
    // mês anterior: mesmos N primeiros dias, para comparação justa
    const fimAnt = somarDias(desde, -1);
    const inicioAnt = fimAnt.slice(0, 8) + "01";
    const ateAnt = [somarDias(inicioAnt, dias - 1), fimAnt].sort()[0];
    return {
      atual: { chave: p.chave, rotulo: p.rotulo, desde, ate: hoje },
      anterior: { chave: p.chave, rotulo: "mesmo período do mês passado", desde: inicioAnt, ate: ateAnt },
    };
  }
  const n = Number(p.chave);
  const desde = somarDias(hoje, -(n - 1));
  return {
    atual: { chave: p.chave, rotulo: p.rotulo, desde, ate: hoje },
    anterior: { chave: p.chave, rotulo: `${n} dias anteriores`, desde: somarDias(desde, -n), ate: somarDias(desde, -1) },
  };
}

/** Quantos dias o mês atual tem e quantos já passaram (para ritmo de orçamento). */
export function progressoDoMes() {
  const hoje = hojeISO();
  const [a, m, d] = hoje.split("-").map(Number);
  const total = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { diaAtual: d, totalDias: total };
}
