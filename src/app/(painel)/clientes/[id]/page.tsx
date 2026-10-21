import Link from "next/link";
import { notFound } from "next/navigation";
import { resolverPeriodo } from "@/lib/datas";
import { detalheCliente, detalheCrm, type LinhaTabela } from "@/lib/consultas";
import { detalheGoogle } from "@/lib/consultas-google";
import { formatarIdGoogle } from "@/lib/google";
import { decimal, dinheiro, inteiro, pct, quandoFoi } from "@/lib/formato";
import { Aviso, Kpi, SeletorPeriodo, TiposResultado, Variacao } from "@/components/ui";
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
  // O CRM não pode derrubar a tela do cliente: se falhar, mostra o erro só na seção dele.
  const [d, crm, google] = await Promise.all([
    detalheCliente(id, atual, anterior).catch((e: unknown) => ({ erroGeral: e instanceof Error ? e.message : String(e) })),
    detalheCrm(id, atual, anterior).catch((e: unknown) => ({ erro: e instanceof Error ? e.message : String(e) })),
    detalheGoogle(id, atual, anterior).catch((e: unknown) => ({ erro: e instanceof Error ? e.message : String(e) })),
  ]);
  if (!d) notFound();
  // Em produção o Next esconde a mensagem do erro; mostramos aqui para facilitar o diagnóstico.
  if ("erroGeral" in d) {
    return (
      <div className="space-y-3">
        <Link href={`/?${atual.qs}`} className="text-sm text-texto-3 hover:text-texto">← Visão geral</Link>
        <Aviso>Erro ao carregar o cliente: {d.erroGeral}</Aviso>
      </div>
    );
  }
  const { cliente: c, atual: a, anterior: b } = d;
  const nivelAtual = NIVEIS.find((n) => n.chave === nivel) ?? NIVEIS[0];
  const linhas = d[nivelAtual.chave].filter((l) => filtro.aceita(l.status));
  const base = `/clientes/${id}`;
  // O CRM compara com o investimento total em anúncios (Meta + Google)
  const g = google && !("erro" in google) ? google : null;
  const gastoTotal = a.gasto + (g?.atual.gasto ?? 0);
  const gastoTotalAnterior = b.gasto + (g?.anterior.gasto ?? 0);

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
            {" · "}
            <Link href={`${base}/crm`} className="text-destaque underline">{crm && !("erro" in crm) ? "Configurar CRM" : "Conectar CRM"}</Link>
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

      <SecaoCrm crm={crm} gasto={gastoTotal} gastoAnterior={gastoTotalAnterior} base={base} comGoogle={!!g} />

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

      {google && ("erro" in google ? <Aviso>Erro ao carregar o Google Ads: {google.erro}</Aviso> : <SecaoGoogle g={google} />)}
    </div>
  );
}

const CANAL: Record<string, string> = {
  SEARCH: "Pesquisa", PERFORMANCE_MAX: "Performance Max", DISPLAY: "Display", VIDEO: "YouTube",
  DEMAND_GEN: "Demand Gen", DISCOVERY: "Demand Gen", SHOPPING: "Shopping", LOCAL: "Local", SMART: "Inteligente",
  MULTI_CHANNEL: "App",
};

const STATUS_GOOGLE: Record<string, string> = { ENABLED: "ACTIVE", PAUSED: "PAUSED", REMOVED: "DELETED" };

function SecaoGoogle({ g }: { g: NonNullable<Awaited<ReturnType<typeof detalheGoogle>>> }) {
  const { atual: x, anterior: y } = g;
  const erros = g.contas.filter((c) => c.ultimo_erro);
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">
        Google Ads <span className="font-normal text-texto-3">
          · {g.contas.map((c) => `${c.nome} (${formatarIdGoogle(c.id)})`).join(", ")} · atualizado {quandoFoi(g.contas[0]?.ultima_sync ?? null)}
        </span>
      </h2>
      {erros.map((c) => <Aviso key={c.id}>Erro no Google Ads ({c.nome}): {c.ultimo_erro}</Aviso>)}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi rotulo="Investido" valor={dinheiro(x.gasto)}><Variacao atual={x.gasto} anterior={y.gasto} neutro /></Kpi>
        <Kpi rotulo="Conversões" valor={decimal(x.conversoes).replace(/,00$/, "")}>
          <Variacao atual={x.conversoes} anterior={y.conversoes} />
        </Kpi>
        <Kpi rotulo="Custo/conversão" valor={dinheiro(x.cpa)}><Variacao atual={x.cpa} anterior={y.cpa} menorMelhor /></Kpi>
        <Kpi rotulo="Cliques" valor={inteiro(x.cliques)}><Variacao atual={x.cliques} anterior={y.cliques} /></Kpi>
        <Kpi rotulo="CTR" valor={pct(x.ctr)}><Variacao atual={x.ctr} anterior={y.ctr} /></Kpi>
        {x.roas != null ? (
          <Kpi rotulo="ROAS" valor={decimal(x.roas)}>
            <span className="text-xs text-texto-3">{dinheiro(x.valor)} em valor de conversão</span>
          </Kpi>
        ) : (
          <Kpi rotulo="CPC" valor={dinheiro(x.cpc)}><Variacao atual={x.cpc} anterior={y.cpc} menorMelhor /></Kpi>
        )}
      </div>

      {g.porAcao.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {g.porAcao.map(([nome, qtd]) => (
            <span key={nome} className="rounded-full bg-superficie px-2 py-1 text-texto-2 ring-1 ring-borda">
              {nome}: <span className="num font-medium text-texto">{decimal(qtd).replace(/,00$/, "")}</span>
            </span>
          ))}
        </div>
      )}

      {g.serie.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <BarrasDiarias dados={g.serie} campo="gasto" titulo="Google · investido por dia" formato="dinheiro" />
          <BarrasDiarias dados={g.serie} campo="resultados" titulo="Google · conversões por dia" formato="inteiro" />
          <BarrasDiarias dados={g.serie} campo="cpr" titulo="Google · custo por conversão por dia" formato="dinheiro" />
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-borda bg-superficie">
        {g.campanhas.length === 0 ? (
          <p className="p-4 text-sm text-texto-3">Sem dados do Google no período.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-texto-3">
              <tr>
                <th className="px-4 py-2 font-normal">Campanha</th>
                {["Investido", "Conversões", "Custo/conv.", "Cliques", "CTR", "CPC"].map((h) => (
                  <th key={h} className="px-3 py-2 text-right font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="num">
              {g.campanhas.map((l) => {
                const semConv = l.gasto > 0 && l.conversoes === 0;
                const caro = x.cpa != null && l.cpa != null && l.cpa > x.cpa * 1.3;
                return (
                  <tr key={l.id} className="border-t border-borda">
                    <td className="max-w-80 px-4 py-2">
                      <div className="flex items-center gap-2">
                        <SeloStatus status={l.status ? STATUS_GOOGLE[l.status] ?? l.status : null} />
                        <span className="truncate" title={l.nome}>{l.nome}</span>
                      </div>
                      <div className="truncate text-xs text-texto-3">
                        {[l.canal ? CANAL[l.canal] ?? l.canal : null, g.contas.length > 1 ? l.conta : null].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">{dinheiro(l.gasto)}</td>
                    <td className="px-3 py-2 text-right">{decimal(l.conversoes).replace(/,00$/, "")}</td>
                    <td className={`px-3 py-2 text-right ${semConv || caro ? "text-critico" : ""}`}>
                      {semConv ? "sem conversão" : dinheiro(l.cpa)}
                    </td>
                    <td className="px-3 py-2 text-right">{inteiro(l.cliques)}</td>
                    <td className="px-3 py-2 text-right">{pct(l.ctr)}</td>
                    <td className="px-3 py-2 text-right">{dinheiro(l.cpc)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-texto-3">
        Conversões = coluna “Conversões” do Google Ads (só as ações marcadas como principais). Em vermelho: custo por
        conversão 30% acima da média do cliente no Google, ou gasto sem conversão.
      </p>
    </section>
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

function SecaoCrm({ crm, gasto, gastoAnterior, base, comGoogle }: {
  crm: Awaited<ReturnType<typeof detalheCrm>> | { erro: string };
  gasto: number;
  gastoAnterior: number;
  base: string;
  comGoogle: boolean;
}) {
  if (!crm) return null;
  if ("erro" in crm) return <Aviso>Erro ao carregar o CRM: {crm.erro}</Aviso>;
  const { atual: x, anterior: y, conexao } = crm;
  const div = (a: number, b: number | null) => (b ? a / b : null);
  if (conexao.ultimo_erro) {
    return (
      <Aviso>
        Erro no CRM: {conexao.ultimo_erro} · <Link href={`${base}/crm`} className="text-destaque underline">ver configuração</Link>
      </Aviso>
    );
  }
  const statusNegocio = (g: boolean | null) =>
    g === true ? <span className="text-bom">● Ganho</span>
    : g === false ? <span className="text-critico">■ Perdido</span>
    : <span className="text-texto-2">◐ Em aberto</span>;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">
        CRM <span className="font-normal text-texto-3">
          · atualizado {quandoFoi(conexao.ultima_sync)} · fontes de anúncio {crm.fontesManuais ? "escolhidas por você" : "detectadas automaticamente"}
          {" · "}<Link href={`${base}/crm`} className="text-destaque underline">ajustar</Link>
        </span>
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi rotulo="Leads no CRM" valor={inteiro(x.leads)}>
          <span className="block text-xs text-texto-3">{inteiro(x.leadsAnuncio)} de anúncio · {inteiro(x.leads - x.leadsAnuncio)} outras fontes</span>
          <span className="block text-xs text-texto-3">{dinheiro(div(gasto, x.leadsAnuncio))} por lead de anúncio</span>
          <Variacao atual={x.leadsAnuncio} anterior={y.leadsAnuncio} />
        </Kpi>
        <Kpi rotulo="Qualificados" valor={x.qualificados == null ? "—" : inteiro(x.qualificados)}>
          {x.qualificados == null || x.qualificadosAnuncio == null ? (
            <Link href={`${base}/crm`} className="text-xs text-destaque underline">definir etapa</Link>
          ) : (
            <span className="block text-xs text-texto-3">
              {inteiro(x.qualificadosAnuncio)} de anúncio · {dinheiro(div(gasto, x.qualificadosAnuncio))} cada
              {x.leadsAnuncio > 0 && ` · ${pct((x.qualificadosAnuncio / x.leadsAnuncio) * 100)} dos leads de anúncio`}
            </span>
          )}
        </Kpi>
        <Kpi rotulo="Vendas" valor={inteiro(x.vendas)}>
          <span className="block text-xs text-texto-3">
            {inteiro(x.vendasAnuncio)} de anúncio · {dinheiro(div(gasto, x.vendasAnuncio))} por venda
          </span>
        </Kpi>
        <Kpi rotulo="Faturamento" valor={dinheiro(x.faturamento)}>
          <span className="block text-xs text-texto-3">
            {dinheiro(x.faturamentoAnuncio)} de anúncio · ROAS real {decimal(div(x.faturamentoAnuncio, gasto))}
          </span>
          <Variacao atual={div(x.faturamentoAnuncio, gasto)} anterior={div(y.faturamentoAnuncio, gastoAnterior)} />
        </Kpi>
        <Kpi rotulo="Em negociação" valor={dinheiro(x.emNegociacao)}>
          <span className="block text-xs text-texto-3">valor dos negócios em aberto criados no período</span>
        </Kpi>
      </div>

      {crm.porFonte.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-borda bg-superficie">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-texto-3">
              <tr>
                <th className="px-4 py-2 font-normal">Fonte no CRM</th>
                {["Leads", "Qualificados", "Vendas", "Faturamento", "Em negociação"].map((h) => (
                  <th key={h} className="px-3 py-2 text-right font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="num">
              {crm.porFonte.map((o) => (
                <tr key={o.nome} className="border-t border-borda">
                  <td className="px-4 py-2">
                    {o.nome}{" "}
                    {o.anuncio && <span className="rounded-full bg-fundo px-2 py-0.5 text-[11px] text-destaque">anúncio</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{inteiro(o.leads)}</td>
                  <td className="px-3 py-2 text-right">{o.qualificados == null ? "—" : inteiro(o.qualificados)}</td>
                  <td className="px-3 py-2 text-right">{inteiro(o.vendas)}</td>
                  <td className="px-3 py-2 text-right">{dinheiro(o.faturamento)}</td>
                  <td className="px-3 py-2 text-right">{dinheiro(o.emNegociacao)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {crm.negocios.length > 0 && (
        <details className="rounded-xl border border-borda bg-superficie">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
            Negócios do período ({crm.negocios.length})
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="text-left text-xs text-texto-3">
                <tr>
                  {["Negócio", "Criado", "Fonte", "Funil · etapa", "Status", "Valor", "Orçamento / campos"].map((h) => (
                    <th key={h} className="px-3 py-2 font-normal first:px-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="align-top">
                {crm.negocios.map((n) => (
                  <tr key={n.id} className="border-t border-borda">
                    <td className="px-4 py-2">
                      <div>{n.nome ?? "—"}</div>
                      {n.responsavel && <div className="text-xs text-texto-3">{n.responsavel}</div>}
                    </td>
                    <td className="num px-3 py-2 text-texto-2">{new Date(n.criado_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                    <td className="px-3 py-2">
                      {n.origem ?? <span className="text-texto-3">sem fonte</span>}
                      {n.anuncio && <span className="ml-1 text-[11px] text-destaque">anúncio</span>}
                    </td>
                    <td className="px-3 py-2 text-texto-2">{[n.pipeline_nome, n.etapa_nome].filter(Boolean).join(" · ")}</td>
                    <td className="px-3 py-2">{statusNegocio(n.ganho)}</td>
                    <td className="num px-3 py-2">{n.valor ? dinheiro(n.valor) : "—"}</td>
                    <td className="px-3 py-2 text-xs text-texto-2">
                      {n.destaques.map(([k, v]) => <div key={k}><span className="text-texto-3">{k}:</span> {v}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <p className="text-xs text-texto-3">
        Leads e qualificados: negócios criados no período, em todos os funis. Vendas: negócios ganhos com fechamento no período.
        Custos e ROAS usam só os negócios de fontes de anúncio{comGoogle ? ", divididos pelo investimento somado do Meta e do Google" : ""}.
      </p>
    </section>
  );
}
