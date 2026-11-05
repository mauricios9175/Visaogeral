import type { Metadata } from "next";
import { Ordenavel } from "@/components/ordenavel";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { resolverPeriodo } from "@/lib/datas";
import { detalheCliente, detalheCrm, somarGeral, type LinhaTabela } from "@/lib/consultas";
import { detalheGoogle } from "@/lib/consultas-google";
import { clienteDoLink } from "@/lib/portal";
import { decimal, dinheiro, inteiro, pct, quandoFoi } from "@/lib/formato";
import { Kpi, SeletorPeriodo, Variacao } from "@/components/ui";
import { BarrasDiarias } from "@/components/graficos";

// Link só de leitura do cliente (fora do login). Nada aqui altera dados: só números do período.
// Sem dados pessoais de leads (nome, telefone), sem alertas internos, sem botões.

export const metadata: Metadata = { title: "Resultados", robots: { index: false, follow: false } };

const CANAL: Record<string, string> = {
  SEARCH: "Pesquisa", PERFORMANCE_MAX: "Performance Max", DISPLAY: "Display", VIDEO: "YouTube", DEMAND_GEN: "Demand Gen",
};

function TabelaCampanhas({ titulo, linhas }: { titulo: string; linhas: { nome: string; detalhe?: string; gasto: number; resultados: number; custo: number | null; extra?: string }[] }) {
  if (!linhas.length) return null;
  return (
    <section className="overflow-hidden rounded-2xl border border-borda bg-superficie">
      <h2 className="px-4 pt-4 text-[15px] font-bold lg:px-5">{titulo}</h2>
      <div className="overflow-x-auto">
        <Ordenavel><table className="mt-3 w-full min-w-[520px] text-sm">
          <thead className="text-left text-xs text-texto-3">
            <tr className="border-b border-borda">
              <th className="px-4 py-2 font-medium lg:px-5">Campanha</th>
              <th className="px-3 py-2 text-right font-medium">Investido</th>
              <th className="px-3 py-2 text-right font-medium">Resultados</th>
              <th className="px-4 py-2 text-right font-medium lg:px-5">Custo por resultado</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i} className="border-b border-borda last:border-0">
                <td className="px-4 py-2.5 lg:px-5">
                  <div className="font-medium">{l.nome}</div>
                  {l.detalhe && <div className="text-xs text-texto-3">{l.detalhe}</div>}
                </td>
                <td className="num px-3 py-2.5 text-right">{dinheiro(l.gasto)}</td>
                <td className="num px-3 py-2.5 text-right">{inteiro(l.resultados)}</td>
                <td className="num px-4 py-2.5 text-right lg:px-5">{dinheiro(l.custo)}</td>
              </tr>
            ))}
          </tbody>
        </table></Ordenavel>
      </div>
    </section>
  );
}

export default async function Portal({ params, searchParams }: PageProps<"/portal/[token]">) {
  await connection();
  const { token } = await params;
  const clienteId = await clienteDoLink(token);
  if (!clienteId) notFound();
  const { atual, anterior } = resolverPeriodo((await searchParams) as { p?: string; de?: string; ate?: string });
  const [meta, google, crm] = await Promise.all([
    detalheCliente(clienteId, atual, anterior),
    detalheGoogle(clienteId, atual, anterior).catch(() => null),
    detalheCrm(clienteId, atual, anterior).catch(() => null),
  ]);
  if (!meta) notFound();
  const c = meta.cliente;
  const a = meta.atual, b = meta.anterior;
  const temMeta = a.gasto > 0 || b.gasto > 0;
  const temGoogle = !!google && (google.atual.gasto > 0 || google.anterior.gasto > 0);
  const geral = somarGeral(a, google?.atual);
  const geralAnt = somarGeral(b, google?.anterior);
  const f = crm?.atual.funil;
  const fAnt = crm?.anterior.funil;
  const etapas = crm && f ? [
    { nome: crm.nomesFunil.leads, valor: f.leads, antes: fAnt?.leads ?? 0 },
    ...crm.nomesFunil.passos.map((nome) => ({ nome, valor: f.passos.find((x) => x.nome === nome)?.valor ?? 0, antes: fAnt?.passos.find((x) => x.nome === nome)?.valor ?? 0 })),
    { nome: crm.nomesFunil.vendas, valor: f.vendas, antes: fAnt?.vendas ?? 0 },
  ] : [];
  const temCrm = !!f && (f.leads > 0 || f.vendas > 0);
  const atualizado = [meta.contas[0]?.ultima_sync, google?.contas[0]?.ultima_sync].filter(Boolean).sort().at(-1) ?? null;
  const linhasMeta = (ls: LinhaTabela[]) => ls.filter((l) => l.gasto > 0).slice(0, 12).map((l) => ({ nome: l.nome, gasto: l.gasto, resultados: l.resultados, custo: l.cpr }));
  const base = `/portal/${token}`;

  return (
    <main className="mx-auto w-full max-w-[1100px] flex-1 space-y-6 px-4 pb-12 pt-[max(1.5rem,env(safe-area-inset-top))] lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span aria-hidden className="flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-destaque-bg text-lg font-extrabold text-destaque">
            {c.nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase()}
          </span>
          <div>
            <h1 className="text-[26px] font-extrabold tracking-tight">{c.nome}</h1>
            <p className="text-xs text-texto-3">Resultados das campanhas · {atual.rotulo}{atualizado ? ` · atualizado ${quandoFoi(atualizado)}` : ""}</p>
          </div>
        </div>
        <SeletorPeriodo atual={atual} base={base} />
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi rotulo="Investido" valor={dinheiro(geral.gasto)}><Variacao atual={geral.gasto} anterior={geralAnt.gasto} neutro /></Kpi>
        <Kpi rotulo={temCrm ? "Leads" : "Resultados"} valor={inteiro(temCrm ? f!.leads : geral.resultados)}>
          <Variacao atual={temCrm ? f!.leads : geral.resultados} anterior={temCrm ? fAnt?.leads ?? 0 : geralAnt.resultados} />
        </Kpi>
        <Kpi rotulo={temCrm ? "Custo por lead" : "Custo por resultado"} valor={dinheiro(temCrm ? (f!.leads ? geral.gasto / f!.leads : null) : geral.cpr)}>
          <Variacao atual={temCrm ? (f!.leads ? geral.gasto / f!.leads : null) : geral.cpr} anterior={temCrm ? (fAnt?.leads ? geralAnt.gasto / fAnt.leads : null) : geralAnt.cpr} menorMelhor />
        </Kpi>
        {temCrm ? (
          <Kpi rotulo="Vendas" valor={inteiro(f!.vendas)}>
            <span className="block text-xs text-texto-3">{dinheiro(f!.faturamento)}{geral.gasto > 0 && f!.faturamento > 0 ? ` · ROAS ${(f!.faturamento / geral.gasto).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}x` : ""}</span>
            <Variacao atual={f!.vendas} anterior={fAnt?.vendas ?? 0} />
          </Kpi>
        ) : (
          <Kpi rotulo="CTR" valor={pct(a.ctr)}><Variacao atual={a.ctr} anterior={b.ctr} /></Kpi>
        )}
      </section>

      {temCrm && (
        <section className="flex flex-col gap-4 rounded-2xl border border-borda bg-superficie p-4 lg:p-5">
          <h2 className="text-[15px] font-bold">Funil do período</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fit,minmax(120px,1fr))]">
            {etapas.map((e, i) => {
              const ant = i > 0 ? etapas[i - 1].valor : null;
              const largura = f!.leads ? Math.max((e.valor / f!.leads) * 100, e.valor ? 3 : 0) : 0;
              return (
                <div key={e.nome} className="flex flex-col gap-2">
                  <div className="h-2.5 overflow-hidden rounded-full bg-superficie-2"><div className="h-full rounded-full bg-destaque" style={{ width: `${largura}%` }} /></div>
                  <div className="text-[13px] text-texto-2">{e.nome}</div>
                  <div className="num text-2xl font-extrabold">{inteiro(e.valor)}</div>
                  <div className="text-xs font-semibold text-destaque">{ant == null ? " " : ant ? `${pct((e.valor / ant) * 100)} de ${etapas[i - 1].nome.toLowerCase()}` : "—"}</div>
                </div>
              );
            })}
          </div>
          {f!.valorPropostas > 0 && <p className="text-[13px] text-texto-2">Valor das propostas <b className="text-texto">{dinheiro(f!.valorPropostas)}</b> · valor das vendas <b className="text-texto">{dinheiro(f!.faturamento)}</b></p>}
        </section>
      )}

      {temMeta && (
        <>
          <h2 className="text-lg font-bold">Meta Ads <span className="text-sm font-normal text-texto-3">(Facebook e Instagram)</span></h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi rotulo="Investido" valor={dinheiro(a.gasto)}><Variacao atual={a.gasto} anterior={b.gasto} neutro /></Kpi>
            <Kpi rotulo="Resultados" valor={inteiro(a.resultados)}><Variacao atual={a.resultados} anterior={b.resultados} /></Kpi>
            <Kpi rotulo="Custo por resultado" valor={dinheiro(a.cpr)}><Variacao atual={a.cpr} anterior={b.cpr} menorMelhor /></Kpi>
            <Kpi rotulo="Pessoas alcançadas (aprox.)" valor={inteiro(a.alcance)}><span className="text-xs text-texto-3">{inteiro(a.impressoes)} impressões</span></Kpi>
          </div>
          {meta.serie.length > 1 && (
            <div className="grid gap-3 lg:grid-cols-2">
              <BarrasDiarias dados={meta.serie} campo="gasto" titulo="Investido por dia" formato="dinheiro" />
              <BarrasDiarias dados={meta.serie} campo="resultados" titulo="Resultados por dia" formato="inteiro" />
            </div>
          )}
          <TabelaCampanhas titulo="Campanhas no Meta" linhas={linhasMeta(meta.campanhas)} />
        </>
      )}

      {temGoogle && google && (
        <>
          <h2 className="text-lg font-bold">Google Ads</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi rotulo="Investido" valor={dinheiro(google.atual.gasto)}><Variacao atual={google.atual.gasto} anterior={google.anterior.gasto} neutro /></Kpi>
            <Kpi rotulo="Conversões" valor={decimal(google.atual.conversoes).replace(/,00$/, "")}><Variacao atual={google.atual.conversoes} anterior={google.anterior.conversoes} /></Kpi>
            <Kpi rotulo="Custo por conversão" valor={dinheiro(google.atual.cpa)}><Variacao atual={google.atual.cpa} anterior={google.anterior.cpa} menorMelhor /></Kpi>
            <Kpi rotulo="Cliques" valor={inteiro(google.atual.cliques)}><span className="text-xs text-texto-3">CTR {pct(google.atual.ctr)}</span></Kpi>
          </div>
          <TabelaCampanhas titulo="Campanhas no Google" linhas={google.campanhas.filter((x) => x.gasto > 0).slice(0, 12).map((x) => ({
            nome: x.nome, detalhe: CANAL[x.canal ?? ""] ?? undefined, gasto: x.gasto, resultados: Math.round(x.conversoes), custo: x.cpa,
          }))} />
        </>
      )}

      {!temMeta && !temGoogle && !temCrm && <p className="rounded-2xl border border-borda bg-superficie p-4 text-sm text-texto-2">Sem dados neste período.</p>}
      <p className="text-center text-[11px] text-texto-3">Página só de leitura, com os números das campanhas. Dúvidas? Fale com o seu gestor de tráfego.</p>
    </main>
  );
}
