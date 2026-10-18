import Link from "next/link";
import { PERIODOS } from "@/lib/datas";
import { variacao } from "@/lib/formato";
import type { Saude } from "@/lib/consultas";

export function SeletorPeriodo({ atual, base }: { atual: string; base: string }) {
  return (
    <div className="inline-flex rounded-lg border border-borda bg-superficie p-0.5 text-sm">
      {PERIODOS.map((p) => (
        <Link
          key={p.chave}
          href={`${base}?p=${p.chave}`}
          className={`rounded-md px-3 py-1 ${p.chave === atual ? "bg-fundo font-medium" : "text-texto-2 hover:text-texto"}`}
        >
          {p.rotulo}
        </Link>
      ))}
    </div>
  );
}

/**
 * Mostra a variação vs período anterior. `menorMelhor` inverte a cor (ex.: CPL caindo é bom).
 * `neutro` deixa sem cor (ex.: investimento, que não é bom nem ruim por si só).
 * Cor sempre acompanhada de seta e número, nunca sozinha.
 */
export function Variacao({ atual, anterior, menorMelhor = false, neutro = false }: {
  atual: number | null; anterior: number | null; menorMelhor?: boolean; neutro?: boolean;
}) {
  const v = variacao(atual, anterior);
  if (v === null) return <span className="text-xs text-texto-3">sem comparação</span>;
  const subiu = v > 0;
  const bom = neutro || Math.abs(v) < 1 ? null : subiu !== menorMelhor;
  const cor = bom === null ? "text-texto-3" : bom ? "text-bom" : "text-critico";
  return (
    <span className={`num text-xs ${cor}`}>
      {subiu ? "▲" : "▼"} {Math.abs(v).toFixed(0)}%
    </span>
  );
}

const SAUDE: Record<Saude, { rotulo: string; classe: string; icone: string }> = {
  ok: { rotulo: "Saudável", classe: "bg-bom-bg text-bom", icone: "●" },
  atencao: { rotulo: "Atenção", classe: "bg-atencao-bg text-atencao", icone: "▲" },
  critico: { rotulo: "Crítico", classe: "bg-critico-bg text-critico", icone: "■" },
  sem_dados: { rotulo: "Sem gasto", classe: "bg-fundo text-texto-3", icone: "○" },
};

export function SeloSaude({ saude }: { saude: Saude }) {
  const s = SAUDE[saude];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.classe}`}>
      <span aria-hidden>{s.icone}</span>
      {s.rotulo}
    </span>
  );
}

export function Kpi({ rotulo, valor, children }: { rotulo: string; valor: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-borda bg-superficie p-4">
      <div className="text-xs text-texto-2">{rotulo}</div>
      <div className="num mt-1 text-2xl font-semibold">{valor}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export function Aviso({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-borda bg-superficie px-4 py-3 text-sm text-texto-2">{children}</div>;
}
