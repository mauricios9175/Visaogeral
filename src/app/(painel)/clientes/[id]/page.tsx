import Link from "next/link";
import { notFound } from "next/navigation";
import { resolverPeriodo } from "@/lib/datas";
import { detalheCliente, type LinhaTabela } from "@/lib/consultas";
import { decimal, dinheiro, inteiro, pct, quandoFoi } from "@/lib/formato";
import { Kpi, SeletorPeriodo, TiposResultado, Variacao } from "@/components/ui";
import { BarrasDiarias } from "@/components/graficos";


const NIVEIS = [
  { chave: "campanhas", rotulo: "Campanhas" },
  { chave: "conjuntos", rotulo: "Conjuntos" },
  { chave: "anuncios", rotulo: "Anúncios" },
] as const;

const ATIVOS = ["ACTIVE", "IN_PROCESS", "PENDING_REVIEW", "PREAPPROVED"];

const FILTROS = [
  { chave: "todos", rotulo: "Todos", aceita: () => true },
  { chave: "ativos", rotulo: "Ativos", aceita: (s: string | null) => !!s && ATIVOS.includes(s) },
  { chave: "pausados", rotulo: "Pausados", aceita: (s: string | null) => !s || !ATIVOS.includes(s) },
] as const;

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
function SeloStatus({ status }: { status: string | null }) {
  const s = status ? STATUS[status] ?? { rotulo: status, classe: "bg-fundo text-texto-3", icone: "○" }
    : { rotulo: "Arquivado/excluído", classe: "bg-fundo text-texto-3", icone: "○" };
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${s.classe}`}>
      <span aria-hidden>{s.icone}</span>
      {s.rotulo}
    </span>
  );
}

export default async function PaginaCliente({ params, searchParams }: PageProps<"/clientes/[id]">) {
  const { id } = await params;
  const busca = (await searchParams) as { p?: string; de?: string; ate?: string; nivel?: string; status?: string };
  const { nivel } = busca;
  const filtro = FILTROS.find((f) => f.chave === busca.status) ?? FILTROS[0];
  const { atual, anterior } = resolverPeriodo(busca);
  const d = await detalheCliente(id, atual, anterior);
  if (!d) notFound();
  const { cliente: c, atual: a, anterior: b } = d;
  const nivelAtual = NIVEIS.find((n) => n.chave === nivel) ?? NIVEIS[0];
  const linhas = d[nivelAtual.chave].filter((l) => filtro.aceita(l.status));
  const base = `/clientes/${id}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/?${atual.qs}`} className="text-sm text-texto-3 hover:text-texto">← Visão geral</Link>
          <h1 className="text-xl font-semibold">{c.nome}</h1>
          <p className="text-sm text-texto-2">
            {d.contas.map((x) => x.nome + (x.pre_paga && x.saldo != null ? ` (saldo ${dinheiro(x.saldo)})` : "")).join(", ")
              || "Nenhuma conta vinculada"}
            {d.contas[0] && <> · atualizado {quandoFoi(d.contas[0].ultima_sync)}</>}
            {" · "}
            <Link href={`${base}/diagnostico`} className="text-destaque underline">Diagnóstico de resultados</Link>
          </p>
        </div>
        <SeletorPeriodo atual={atual} base={base} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi rotulo="Investido" valor={dinheiro(a.gasto)}><Variacao atual={a.gasto} anterior={b.gasto} neutro /></Kpi>
        <Kpi rotulo="Resultados" valor={inteiro(a.resultados)}>
          <TiposResultado m={a} />
        </Kpi>
        <Kpi rotulo={`Custo/resultado${c.cpl_meta ? ` (meta ${dinheiro(c.cpl_meta)})` : ""}`} valor={dinheiro(a.cpr)}>
          <Variacao atual={a.cpr} anterior={b.cpr} menorMelhor />
        </Kpi>
        <Kpi rotulo="CTR (link)" valor={pct(a.ctr)}><Variacao atual={a.ctr} anterior={b.ctr} /></Kpi>
        <Kpi rotulo="CPM" valor={dinheiro(a.cpm)}><Variacao atual={a.cpm} anterior={b.cpm} menorMelhor /></Kpi>
        {a.compras > 0 ? (
          <Kpi rotulo="ROAS" valor={decimal(a.roas)}>
            <span className="text-xs text-texto-3">{inteiro(a.compras)} compras · {dinheiro(a.valor_compras)}</span>
          </Kpi>
        ) : (
          <Kpi rotulo="Frequência média" valor={decimal(a.frequencia)}>
            <span className="text-xs text-texto-3">aproximada</span>
          </Kpi>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <BarrasDiarias dados={d.serie} campo="gasto" titulo="Investido por dia" formato="dinheiro" />
        <BarrasDiarias dados={d.serie} campo="resultados" titulo="Resultados por dia" formato="inteiro" />
        <BarrasDiarias dados={d.serie} campo="cpr" titulo="Custo por resultado por dia" formato="dinheiro" />
      </div>

      <div className="rounded-xl border border-borda bg-superficie">
        <div className="flex flex-wrap items-center gap-1 border-b border-borda p-2 text-sm">
          {NIVEIS.map((n) => (
            <Link
              key={n.chave}
              href={`${base}?${atual.qs}&nivel=${n.chave}&status=${filtro.chave}`}
              className={`rounded-md px-3 py-1 ${n.chave === nivelAtual.chave ? "bg-fundo font-medium" : "text-texto-2 hover:text-texto"}`}
            >
              {n.rotulo} <span className="text-texto-3">({d[n.chave].filter((l) => filtro.aceita(l.status)).length})</span>
            </Link>
          ))}
          <span className="ml-auto flex gap-1">
            {FILTROS.map((f) => (
              <Link
                key={f.chave}
                href={`${base}?${atual.qs}&nivel=${nivelAtual.chave}&status=${f.chave}`}
                className={`rounded-md px-3 py-1 ${f.chave === filtro.chave ? "bg-fundo font-medium" : "text-texto-2 hover:text-texto"}`}
              >
                {f.rotulo}
              </Link>
            ))}
          </span>
        </div>
        <Tabela linhas={linhas} meta={c.cpl_meta} />
      </div>
    </div>
  );
}

function Tabela({ linhas, meta }: { linhas: LinhaTabela[]; meta: number | null }) {
  if (!linhas.length) return <p className="p-4 text-sm text-texto-3">Sem dados no período.</p>;
  const media = (() => {
    const g = linhas.reduce((s, l) => s + l.gasto, 0);
    const r = linhas.reduce((s, l) => s + l.resultados, 0);
    return r ? g / r : null;
  })();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-texto-3">
          <tr>
            <th className="px-4 py-2 font-normal">Nome</th>
            {["Investido", "Resultados", "Custo/result.", "CTR", "CPC", "CPM", "Freq."].map((h) => (
              <th key={h} className="px-3 py-2 text-right font-normal">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="num">
          {linhas.map((l) => {
            const ref = meta ?? media;
            const caro = ref !== null && l.cpr !== null && l.cpr > ref * 1.3;
            const semResultado = l.gasto > 0 && l.resultados === 0;
            return (
              <tr key={l.id} className="border-t border-borda">
                <td className="max-w-80 px-4 py-2">
                  <div className="flex items-center gap-2">
                    <SeloStatus status={l.status} />
                    <span className="truncate" title={l.nome}>{l.nome}</span>
                  </div>
                  <div className="truncate text-xs text-texto-3">
                    {[l.tipo, l.pai].filter(Boolean).join(" · ")}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">{dinheiro(l.gasto)}</td>
                <td className="px-3 py-2 text-right">{inteiro(l.resultados)}</td>
                <td className={`px-3 py-2 text-right ${caro || semResultado ? "text-critico" : ""}`}>
                  {semResultado ? "sem resultado" : dinheiro(l.cpr)}
                </td>
                <td className="px-3 py-2 text-right">{pct(l.ctr)}</td>
                <td className="px-3 py-2 text-right">{dinheiro(l.cpc)}</td>
                <td className="px-3 py-2 text-right">{dinheiro(l.cpm)}</td>
                <td className="px-3 py-2 text-right">{decimal(l.frequencia)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-4 py-2 text-xs text-texto-3">
        Em vermelho: custo por resultado 30% acima {meta ? "da meta" : "da média do cliente"}, ou gasto sem resultado.
      </p>
    </div>
  );
}
