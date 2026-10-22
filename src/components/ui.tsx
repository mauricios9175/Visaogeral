import Link from "next/link";
import { PERIODOS, type Periodo } from "@/lib/datas";
import { inteiro, variacao } from "@/lib/formato";
import { ROTULO_TIPO, TIPOS_CONVERSAO, type Saude } from "@/lib/consultas";
import type { Metricas } from "@/lib/db";

/** `extra`: filtros a manter ao trocar de período (ex.: { empresa: "Viccon" }). */
export function SeletorPeriodo({ atual, base, extra = {} }: { atual: Periodo; base: string; extra?: Record<string, string> }) {
  const qsExtra = Object.entries(extra).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("");
  const campo = "rounded-md border border-borda bg-fundo px-2 py-1 text-sm";
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end rounded-lg border border-borda bg-superficie p-0.5 text-sm">
        {PERIODOS.map((p) => (
          <Link
            key={p.chave}
            href={`${base}?p=${p.chave}${qsExtra}`}
            className={`rounded-md px-3 py-1 ${p.chave === atual.chave ? "bg-fundo font-medium" : "text-texto-2 hover:text-texto"}`}
          >
            {p.rotulo}
          </Link>
        ))}
      </div>
      {/* período livre: formulário GET, funciona sem JavaScript */}
      <form action={base} className="flex flex-wrap items-center justify-end gap-2 text-sm text-texto-2">
        <input type="hidden" name="p" value="livre" />
        {Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <label className="flex items-center gap-1">
          De <input type="date" name="de" required defaultValue={atual.desde} className={campo} />
        </label>
        <label className="flex items-center gap-1">
          até <input type="date" name="ate" required defaultValue={atual.ate} className={campo} />
        </label>
        <button className={`rounded-md border px-3 py-1 ${atual.chave === "livre" ? "border-destaque text-texto" : "border-borda hover:border-destaque"}`}>
          Aplicar
        </button>
      </form>
      <span className="text-xs text-texto-3">
        {atual.rotulo}
        {atual.chave !== "livre" && ` · ${formatarData(atual.desde)} a ${formatarData(atual.ate)}`}
      </span>
    </div>
  );
}

function formatarData(iso: string) {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
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
  // mensagens de texto com link (ex.: "Revise no Gerenciador: https://...") viram link clicável
  const conteudo = typeof children === "string"
    ? children.split(/(https?:\/\/\S+)/).map((parte, i) =>
        /^https?:\/\//.test(parte)
          ? <a key={i} href={parte} target="_blank" rel="noreferrer" className="text-destaque underline">abrir ↗</a>
          : parte)
    : children;
  return <div className="rounded-lg border border-borda bg-superficie px-4 py-3 text-sm text-texto-2">{conteudo}</div>;
}

/** "12 conversas · 3 formulário · 5 conv. personalizada"; cliques/engajamento aparecem à parte. */
export function TiposResultado({ m, compacto = false }: { m: Metricas; compacto?: boolean }) {
  const partes = TIPOS_CONVERSAO.filter((k) => m[k] > 0).map((k) => `${inteiro(m[k])} ${ROTULO_TIPO[k]}`);
  if (!partes.length && !m.res_outros) return null;
  return (
    <span className="block text-xs text-texto-3">
      {partes.join(" · ") || "nenhuma conversão"}
      {!compacto && m.res_outros > 0 && (
        <span className="block">+ {inteiro(m.res_outros)} {ROTULO_TIPO.res_outros}, fora do custo por resultado</span>
      )}
    </span>
  );
}

const STATUS: Record<string, { rotulo: string; classe: string; icone: string }> = {
  ACTIVE: { rotulo: "Ativo", classe: "bg-bom-bg text-bom", icone: "●" },
  PAUSED: { rotulo: "Pausado", classe: "bg-fundo text-texto-3", icone: "❚❚" },
  CAMPAIGN_PAUSED: { rotulo: "Campanha pausada", classe: "bg-fundo text-texto-3", icone: "❚❚" },
  ADSET_PAUSED: { rotulo: "Conjunto pausado", classe: "bg-fundo text-texto-3", icone: "❚❚" },
  IN_PROCESS: { rotulo: "Em análise", classe: "bg-atencao-bg text-atencao", icone: "◐" },
  PENDING_REVIEW: { rotulo: "Em análise", classe: "bg-atencao-bg text-atencao", icone: "◐" },
  PREAPPROVED: { rotulo: "Pré-aprovado", classe: "bg-atencao-bg text-atencao", icone: "◐" },
  DISAPPROVED: { rotulo: "Reprovado", classe: "bg-critico-bg text-critico", icone: "■" },
  WITH_ISSUES: { rotulo: "Com problemas", classe: "bg-critico-bg text-critico", icone: "■" },
  PENDING_BILLING_INFO: { rotulo: "Pagamento pendente", classe: "bg-critico-bg text-critico", icone: "■" },
  ARCHIVED: { rotulo: "Arquivado", classe: "bg-fundo text-texto-3", icone: "○" },
  DELETED: { rotulo: "Excluído", classe: "bg-fundo text-texto-3", icone: "○" },
};

/** Status atual no Meta; ícone + texto, nunca só cor. */
export function SeloStatus({ status }: { status: string | null }) {
  const s = status ? STATUS[status] ?? { rotulo: status, classe: "bg-fundo text-texto-3", icone: "○" }
    : { rotulo: "Arquivado/excluído", classe: "bg-fundo text-texto-3", icone: "○" };
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${s.classe}`}>
      <span aria-hidden>{s.icone}</span>
      {s.rotulo}
    </span>
  );
}
