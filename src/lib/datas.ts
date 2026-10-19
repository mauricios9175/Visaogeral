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

export type Periodo = { chave: string; rotulo: string; desde: string; ate: string; qs: string };

export const PERIODOS = [
  { chave: "hoje", rotulo: "Hoje" },
  { chave: "ontem", rotulo: "Ontem" },
  { chave: "7", rotulo: "7 dias" },
  { chave: "14", rotulo: "14 dias" },
  { chave: "30", rotulo: "30 dias" },
  { chave: "mes", rotulo: "Este mês" },
  { chave: "mes_passado", rotulo: "Mês passado" },
] as const;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function dataBR(iso: string) {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function ultimoDiaDoMes(iso: string) {
  const [a, m] = iso.split("-").map(Number);
  return `${iso.slice(0, 8)}${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/**
 * Resolve o período escolhido e o período anterior equivalente, para comparação.
 * Igual ao Gerenciador de Anúncios: "últimos N dias" NÃO incluem hoje; "Este mês" inclui.
 * Período livre: ?p=livre&de=AAAA-MM-DD&ate=AAAA-MM-DD.
 */
export function resolverPeriodo(params: { p?: string; de?: string; ate?: string }): { atual: Periodo; anterior: Periodo } {
  const hoje = hojeISO();
  const ontem = somarDias(hoje, -1);
  const montar = (chave: string, rotulo: string, desde: string, ate: string, qs = `p=${chave}`): Periodo =>
    ({ chave, rotulo, desde, ate, qs });
  // anterior padrão: o mesmo número de dias imediatamente antes
  const anteriorDe = (p: Periodo, rotulo?: string): Periodo => {
    const n = diasEntre(p.desde, p.ate);
    return montar(p.chave, rotulo ?? `${n} dia(s) anteriores`, somarDias(p.desde, -n), somarDias(p.desde, -1));
  };

  if (params.p === "livre" && params.de && params.ate && ISO.test(params.de) && ISO.test(params.ate)) {
    const [desde, ate] = [params.de, params.ate].sort();
    const atual = montar("livre", `${dataBR(desde)} a ${dataBR(ate)}`, desde, ate, `p=livre&de=${desde}&ate=${ate}`);
    return { atual, anterior: anteriorDe(atual) };
  }

  const chave = PERIODOS.some((x) => x.chave === params.p) ? params.p! : "7";
  const rotulo = PERIODOS.find((x) => x.chave === chave)!.rotulo;
  switch (chave) {
    case "hoje": {
      const atual = montar(chave, rotulo, hoje, hoje);
      return { atual, anterior: anteriorDe(atual, "ontem") };
    }
    case "ontem": {
      const atual = montar(chave, rotulo, ontem, ontem);
      return { atual, anterior: anteriorDe(atual, "anteontem") };
    }
    case "mes": {
      const desde = `${hoje.slice(0, 8)}01`;
      const dias = diasEntre(desde, hoje);
      // mês anterior: mesmos N primeiros dias, para comparação justa
      const fimAnt = somarDias(desde, -1);
      const inicioAnt = fimAnt.slice(0, 8) + "01";
      const ateAnt = [somarDias(inicioAnt, dias - 1), fimAnt].sort()[0];
      return {
        atual: montar(chave, rotulo, desde, hoje),
        anterior: montar(chave, "mesmo período do mês passado", inicioAnt, ateAnt),
      };
    }
    case "mes_passado": {
      const fim = somarDias(`${hoje.slice(0, 8)}01`, -1);
      const inicio = `${fim.slice(0, 8)}01`;
      const inicioAnt = `${somarDias(inicio, -1).slice(0, 8)}01`;
      return {
        atual: montar(chave, rotulo, inicio, fim),
        anterior: montar(chave, "mês anterior", inicioAnt, ultimoDiaDoMes(inicioAnt)),
      };
    }
    default: {
      const n = Number(chave);
      const atual = montar(chave, `Últimos ${n} dias`, somarDias(ontem, -(n - 1)), ontem);
      return { atual, anterior: anteriorDe(atual, `${n} dias anteriores`) };
    }
  }
}

/** Quantos dias o mês atual tem e quantos já passaram (para ritmo de orçamento). */
export function progressoDoMes() {
  const hoje = hojeISO();
  const [a, m, d] = hoje.split("-").map(Number);
  const total = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { diaAtual: d, totalDias: total };
}
