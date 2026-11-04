import Link from "next/link";
import { resolverPeriodo, progressoDoMes } from "@/lib/datas";
import { alertasContas, resumoClientes, resumoCrm, type AlertaConta, type NumerosCrm, type ResumoCliente } from "@/lib/consultas";
import { db, EMPRESA_PADRAO } from "@/lib/db";
import type { NumerosGoogle } from "@/lib/consultas-google";
import { dataCurta, dinheiro, inteiro, quandoFoi } from "@/lib/formato";
import { AnaliseIA } from "@/components/analise-ia";
import { Aviso, Kpi, SeletorPeriodo, SeloSaude, Tendencia, TiposResultado, Variacao } from "@/components/ui";


const ORDEM = { critico: 0, atencao: 1, ok: 2, sem_dados: 3 };

export default async function VisaoGeral({ searchParams }: PageProps<"/">) {
  const busca = (await searchParams) as { p?: string; de?: string; ate?: string; empresa?: string };
  const { atual, anterior } = resolverPeriodo(busca);
  const banco = db();
  const [todosResumos, todosAlertas, { data: ultima }, { count: semCliente }, { data: primeiro }, crm] = await Promise.all([
    resumoClientes(atual, anterior),
    alertasContas(),
    banco.from("sync_execucoes").select("finalizado_em, status").not("finalizado_em", "is", null)
      .order("id", { ascending: false }).limit(1).maybeSingle(),
    banco.from("contas_anuncio").select("id", { count: "exact", head: true }).is("cliente_id", null).eq("status", 1),
    banco.from("metricas_diarias").select("data").order("data").limit(1).maybeSingle(),
    resumoCrm(atual, anterior),
  ]);
  const historicoDesde: string | null = primeiro?.data ?? null;
  todosResumos.sort((a, b) => ORDEM[a.saude] - ORDEM[b.saude] || b.geral.atual.gasto - a.geral.atual.gasto);

  // ---- empresas ----
  const empresaDe = (r: ResumoCliente) => r.cliente.empresa || EMPRESA_PADRAO;
  const empresas = [...new Set(todosResumos.map(empresaDe))].sort((a, b) =>
    a === EMPRESA_PADRAO ? 1 : b === EMPRESA_PADRAO ? -1 : a.localeCompare(b),
  );
  const empresa = busca.empresa && empresas.includes(busca.empresa) ? busca.empresa : null;
  const resumos = empresa ? todosResumos.filter((r) => empresaDe(r) === empresa) : todosResumos;
  const idsVisiveis = new Set(resumos.map((r) => r.cliente.id));
  const alertas = todosAlertas.filter((a) => idsVisiveis.has(a.clienteId));
  const resumoEmpresas = empresas
    .filter((e) => !empresa || e === empresa)
    .map((e) => resumirEmpresa(e, todosResumos.filter((r) => empresaDe(r) === e), todosAlertas, crm));
  const linkEmpresa = (e: string | null) => `/?${atual.qs}${e ? `&empresa=${encodeURIComponent(e)}` : ""}`;

  const total = resumos.reduce(
    (t, r) => ({
      gasto: t.gasto + r.geral.atual.gasto, resultados: t.resultados + r.geral.atual.resultados,
      meta: t.meta + r.atual.gasto, google: t.google + (r.google?.atual.gasto ?? 0),
    }),
    { gasto: 0, resultados: 0, meta: 0, google: 0 },
  );

  // sem filtro: cards agrupados por empresa; com filtro: só a empresa escolhida
  const grupos = (empresa ? [empresa] : empresas).map((e) => ({ empresa: e, itens: resumos.filter((r) => empresaDe(r) === e) }));

  // números principais: soma dos clientes visíveis (Meta + Google; vendas e faturamento do CRM)
  const anteriorTotal = resumos.reduce((t, r) => ({ gasto: t.gasto + r.geral.anterior.gasto, resultados: t.resultados + r.geral.anterior.resultados }), { gasto: 0, resultados: 0 });
  const crmVisiveis = resumos.map((r) => crm.get(r.cliente.id)).filter((x) => !!x);
  const somaCrm = (f: (x: NumerosCrm) => number, qual: "atual" | "anterior") => crmVisiveis.reduce((t, x) => t + f(x![qual]), 0);
  const porDia = new Map<string, { gasto: number; resultados: number }>();
  for (const r of resumos) for (const d of r.serie) {
    const x = porDia.get(d.data) ?? { gasto: 0, resultados: 0 };
    porDia.set(d.data, { gasto: x.gasto + d.gasto, resultados: x.resultados + d.resultados });
  }
  const dias = [...porDia.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([, v]) => v);
  const cprDia = dias.map((d) => (d.resultados ? d.gasto / d.resultados : 0));
  const cpr = total.resultados ? total.gasto / total.resultados : null;
  const cprAnterior = anteriorTotal.resultados ? anteriorTotal.gasto / anteriorTotal.resultados : null;
  const hoje = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[13px] capitalize text-texto-3">{hoje} · atualizado {quandoFoi(ultima?.finalizado_em ?? null)}</div>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight">{empresa ?? "Visão geral"}</h1>
        </div>
        <SeletorPeriodo atual={atual} base="/" extra={empresa ? { empresa } : {}} />
      </header>

      {/* filtro por empresa */}
      <nav aria-label="Empresas" className="flex flex-wrap gap-2 text-[13px]">
        {[null, ...empresas].map((e) => (
          <Link
            key={e ?? "todas"} href={linkEmpresa(e)} aria-current={e === empresa ? "page" : undefined}
            className={`rounded-full border px-3.5 py-1.5 ${e === empresa ? "border-destaque bg-destaque-bg font-semibold text-texto" : "border-borda text-texto-2 hover:text-texto"}`}
          >
            {e ?? "Todas"}{" "}
            <span className="text-texto-3">{e ? todosResumos.filter((r) => empresaDe(r) === e).length : todosResumos.length}</span>
          </Link>
        ))}
      </nav>

      <section aria-label="Números principais" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi rotulo="Investimento" valor={dinheiro(total.gasto)} serie={dias.map((d) => d.gasto)}>
          <Variacao atual={total.gasto} anterior={anteriorTotal.gasto} neutro />
          {total.google > 0 && <span className="block text-xs text-texto-3">Meta {dinheiro(total.meta)} · Google {dinheiro(total.google)}</span>}
        </Kpi>
        <Kpi rotulo="Resultados" valor={inteiro(total.resultados)} serie={dias.map((d) => d.resultados)}>
          <Variacao atual={total.resultados} anterior={anteriorTotal.resultados} />
        </Kpi>
        <Kpi rotulo="Custo por resultado" valor={dinheiro(cpr)} serie={cprDia} cor="var(--serie-2)">
          <Variacao atual={cpr} anterior={cprAnterior} menorMelhor />
        </Kpi>
        {crmVisiveis.length > 0 && (
          <>
            <Kpi rotulo="Vendas no CRM" valor={inteiro(somaCrm((x) => x.vendas, "atual"))}>
              <Variacao atual={somaCrm((x) => x.vendas, "atual")} anterior={somaCrm((x) => x.vendas, "anterior")} />
              <span className="block text-xs text-texto-3">{crmVisiveis.length} cliente(s) com CRM</span>
            </Kpi>
            <Kpi rotulo="Faturamento" valor={dinheiro(somaCrm((x) => x.faturamento, "atual"))}>
              <Variacao atual={somaCrm((x) => x.faturamento, "atual")} anterior={somaCrm((x) => x.faturamento, "anterior")} />
            </Kpi>
          </>
        )}
      </section>

      {historicoDesde && historicoDesde > atual.desde && (
        <Aviso>
          O histórico carregado começa em {dataCurta(historicoDesde)}, então este período mostra só os dias a partir daí.
          Para comparar períodos maiores, clique em “Recarregar últimos 30 dias” em{" "}
          <Link href="/configuracoes" className="text-destaque underline">Configurações</Link>.
        </Aviso>
      )}

      <AnaliseIA />

      <PainelAlertas alertas={alertas} linkTodos={empresa ? `/alertas?empresa=${encodeURIComponent(empresa)}` : "/alertas"} />

      {!!semCliente && !empresa && (
        <Aviso>
          {semCliente} conta(s) ativa(s) de anúncio ainda sem cliente vinculado.{" "}
          <Link href="/configuracoes" className="text-destaque underline">Vincular agora</Link>
        </Aviso>
      )}
      {todosResumos.length === 0 && (
        <Aviso>
          Nenhum cliente cadastrado. Vá em <Link href="/configuracoes" className="text-destaque underline">Configurações</Link>,
          importe as contas do Meta e cadastre seus clientes.
        </Aviso>
      )}

      {/* resumo de cada empresa (só quando há mais de uma na tela) */}
      {resumoEmpresas.length > 1 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {resumoEmpresas.map((e) => <CardEmpresa key={e.nome} e={e} href={linkEmpresa(e.nome)} ativo={e.nome === empresa} />)}
        </div>
      )}

      {grupos.map((g) => (
        <section key={g.empresa} aria-label={g.empresa} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold">{empresa ? "Clientes" : g.empresa} <span className="text-sm font-medium text-texto-3">· {g.itens.length}</span></h2>
            <div className="flex flex-wrap gap-3 text-xs text-texto-3">
              <span>● No alvo</span><span className="text-atencao">▲ Atenção</span><span className="text-critico">■ Crítico</span>
            </div>
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
            {g.itens.map((r) => (
              <CardCliente
                key={r.cliente.id} r={r} periodo={atual.qs}
                alertas={alertas.filter((a) => a.clienteId === r.cliente.id).length}
                crm={crm.get(r.cliente.id)?.atual}
              />
            ))}
          </div>
        </section>
      ))}
      <p className="text-xs text-texto-3">
        Resultados = o “Resultado” do Gerenciador de Anúncios de cada campanha (conversas, formulários, leads no site, conversões personalizadas, compras e cadastros); cliques e engajamento ficam de fora. Variações comparam com {anterior.rotulo}.
      </p>
    </div>
  );
}

type ResumoEmpresa = ReturnType<typeof resumirEmpresa>;

function resumirEmpresa(
  nome: string,
  rs: ResumoCliente[],
  alertas: AlertaConta[],
  crm: Map<string, { atual: NumerosCrm }>,
) {
  const soma = (f: (r: ResumoCliente) => number) => rs.reduce((t, r) => t + f(r), 0);
  const ids = new Set(rs.map((r) => r.cliente.id));
  const crms = rs.map((r) => crm.get(r.cliente.id)?.atual).filter((x): x is NumerosCrm => !!x);
  const gasto = soma((r) => r.geral.atual.gasto);
  const gs = rs.map((r) => r.google?.atual).filter((x): x is NumerosGoogle => !!x && x.gasto > 0);
  const resultados = soma((r) => r.geral.atual.resultados);
  return {
    nome,
    clientes: rs.length,
    criticos: rs.filter((r) => r.saude === "critico").length,
    gasto,
    gastoAnterior: soma((r) => r.geral.anterior.gasto),
    resultados,
    resultadosAnterior: soma((r) => r.geral.anterior.resultados),
    cpr: resultados ? gasto / resultados : null,
    cprAnterior: (() => { const g = soma((r) => r.geral.anterior.gasto), n = soma((r) => r.geral.anterior.resultados); return n ? g / n : null; })(),
    meta: { gasto: soma((r) => r.atual.gasto), resultados: soma((r) => r.atual.resultados) },
    alertas: alertas.filter((a) => ids.has(a.clienteId)).length,
    google: gs.length
      ? { clientes: gs.length, gasto: gs.reduce((t, x) => t + x.gasto, 0), conversoes: gs.reduce((t, x) => t + x.conversoes, 0) }
      : null,
    crm: crms.length
      ? {
          clientes: crms.length,
          leads: crms.reduce((t, x) => t + x.leads, 0),
          vendas: crms.reduce((t, x) => t + x.vendas, 0),
          faturamento: crms.reduce((t, x) => t + x.faturamento, 0),
        }
      : null,
  };
}

function CardEmpresa({ e, href, ativo }: { e: ResumoEmpresa; href: string; ativo: boolean }) {
  return (
    <Link
      href={href}
      className={`block rounded-2xl border bg-superficie p-4 transition hover:border-destaque lg:p-5 ${ativo ? "border-destaque" : "border-borda"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-bold">{e.nome}</div>
        <div className="text-xs text-texto-3">
          {e.clientes} cliente(s)
          {e.criticos > 0 && <span className="text-critico"> · ■ {e.criticos} crítico(s)</span>}
          {e.alertas > 0 && <span className="text-atencao"> · ▲ {e.alertas} alerta(s)</span>}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metrica rotulo="Investido" valor={dinheiro(e.gasto)}><Variacao atual={e.gasto} anterior={e.gastoAnterior} neutro /></Metrica>
        <Metrica rotulo="Resultados" valor={inteiro(e.resultados)}><Variacao atual={e.resultados} anterior={e.resultadosAnterior} /></Metrica>
        <Metrica rotulo="Custo/result." valor={dinheiro(e.cpr)}><Variacao atual={e.cpr} anterior={e.cprAnterior} menorMelhor /></Metrica>
      </div>
      {e.google && (
        <div className="mt-3 space-y-1 rounded-lg bg-fundo px-2 py-1 text-xs text-texto-2">
          <div>
            Meta: {dinheiro(e.meta.gasto)} · {inteiro(e.meta.resultados)} resultados
            {e.meta.resultados > 0 && <> · {dinheiro(e.meta.gasto / e.meta.resultados)} cada</>}
          </div>
          <div>
            Google ({e.google.clientes} cliente(s)): {dinheiro(e.google.gasto)} · {inteiro(e.google.conversoes)} conversões
            {e.google.conversoes > 0 && <> · {dinheiro(e.google.gasto / e.google.conversoes)} cada</>}
          </div>
        </div>
      )}
      {e.crm && (
        <div className="mt-2 rounded-lg bg-fundo px-2 py-1 text-xs text-texto-2">
          CRM ({e.crm.clientes} cliente(s)): {inteiro(e.crm.leads)} leads · {inteiro(e.crm.vendas)} vendas · {dinheiro(e.crm.faturamento)}
        </div>
      )}
    </Link>
  );
}

function PainelAlertas({ alertas, linkTodos }: { alertas: AlertaConta[]; linkTodos: string }) {
  return (
    <section aria-labelledby="atencao" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="atencao" className="text-lg font-bold">
          Precisa de atenção agora
          {alertas.length > 0 && <span className="ml-2 rounded-full bg-critico-bg px-2.5 py-0.5 text-[13px] text-critico">{alertas.length}</span>}
        </h2>
        <Link href={linkTodos} className="text-sm font-semibold text-destaque">Alertas de desempenho →</Link>
      </div>
      {alertas.length === 0 ? (
        <p className="rounded-2xl border border-borda bg-superficie px-4 py-3 text-sm text-texto-2">● Nenhum problema de saldo ou de conta agora.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {alertas.map((a, i) => (
            <div key={i} className="flex gap-3.5 rounded-2xl border border-borda bg-superficie p-4">
              <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-sm ${a.nivel === "critico" ? "bg-critico-bg text-critico" : "bg-atencao-bg text-atencao"}`}>
                {a.nivel === "critico" ? "■" : "▲"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold">{a.clienteNome}</span>
                  <span className={`text-[11px] font-bold uppercase tracking-wide ${a.nivel === "critico" ? "text-critico" : "text-atencao"}`}>
                    {a.nivel === "critico" ? "Crítico" : "Atenção"}
                  </span>
                </div>
                <div className="text-xs text-texto-3">{a.contaNome}</div>
                <p className="mt-1 text-[13px] leading-relaxed text-texto-2">{a.mensagem}</p>
                <Link href={`/clientes/${a.clienteId}`} className="mt-2.5 inline-flex min-h-9 items-center rounded-[9px] bg-destaque px-3.5 text-[13px] font-semibold text-white">
                  Ver cliente
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CardCliente({ r, periodo, alertas, crm }: {
  r: ResumoCliente; periodo: string; alertas: number; crm?: NumerosCrm;
}) {
  const { cliente: c, atual: meta, google, mes } = r;
  const { atual: a, anterior: b } = r.geral;
  const { diaAtual, totalDias } = progressoDoMes();
  const usoOrc = c.orcamento_mensal ? Math.min(mes.gasto / c.orcamento_mensal, 1) : null;
  const cprAcima = c.cpl_meta && a.cpr !== null && a.cpr > c.cpl_meta;

  const sigla = c.nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  const corRitmo = mes.ritmo !== null && mes.ritmo > 1.1 ? "bg-critico" : mes.ritmo !== null && mes.ritmo < 0.9 ? "bg-atencao" : "bg-bom";

  return (
    <Link
      href={`/clientes/${c.id}?${periodo}`}
      className="flex flex-col gap-3.5 rounded-2xl border border-borda bg-superficie p-4 transition hover:border-destaque lg:p-5"
    >
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-destaque-bg text-[15px] font-extrabold text-destaque">{sigla}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{c.nome}</div>
          <div className="text-xs text-texto-3">{c.nicho ?? "—"} · {r.contas} conta(s)</div>
        </div>
        <SeloSaude saude={r.saude} />
      </div>
      {alertas > 0 && (
        <span className="self-start rounded-full bg-critico-bg px-2.5 py-0.5 text-xs font-semibold text-critico">■ {alertas} alerta(s) de conta</span>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Metrica rotulo="Investido" valor={dinheiro(a.gasto)}>
          <Variacao atual={a.gasto} anterior={b.gasto} neutro />
        </Metrica>
        <Metrica rotulo="Resultados" valor={inteiro(a.resultados)}>
          <Variacao atual={a.resultados} anterior={b.resultados} />
        </Metrica>
        <Metrica rotulo="Custo/result." valor={dinheiro(a.cpr)} alerta={!!cprAcima}>
          <Variacao atual={a.cpr} anterior={b.cpr} menorMelhor />
          {c.cpl_meta && <span className={`block text-[11px] ${cprAcima ? "text-critico" : "text-texto-3"}`}>alvo {dinheiro(c.cpl_meta)}</span>}
        </Metrica>
      </div>

      {r.serie.length > 1 && <Tendencia valores={r.serie.map((s) => s.gasto)} altura={38} />}

      {/* de onde veio: Meta e Google separados */}
      {google ? (
        <div className="space-y-1 rounded-xl bg-superficie-2 px-3 py-2 text-xs text-texto-2">
          <div>
            <span className="font-semibold text-texto">Meta</span> {dinheiro(meta.gasto)} · {inteiro(meta.resultados)} resultados
            {meta.cpr != null && <> · {dinheiro(meta.cpr)} cada</>}
          </div>
          <div>
            <span className="font-semibold text-texto">Google</span> {dinheiro(google.atual.gasto)} · {inteiro(google.atual.conversoes)} conversões
            {google.atual.cpa != null && <> · {dinheiro(google.atual.cpa)} cada</>}
          </div>
        </div>
      ) : (
        <TiposResultado m={meta} compacto />
      )}
      {crm && (
        <div className="rounded-xl bg-superficie-2 px-3 py-2 text-xs text-texto-2">
          <span className="font-semibold text-texto">CRM</span> {inteiro(crm.leads)} leads ({inteiro(crm.leadsAnuncio)} de anúncio)
          {crm.qualificados != null && <> · {inteiro(crm.qualificados)} qualificados</>}
          {" · "}{inteiro(crm.vendas)} vendas · {dinheiro(crm.faturamento)}
          {a.gasto > 0 && crm.faturamentoAnuncio > 0 && <> · ROAS {(crm.faturamentoAnuncio / a.gasto).toFixed(1).replace(".", ",")}</>}
        </div>
      )}

      {usoOrc !== null && (
        <div className="mt-auto">
          <div className="flex justify-between text-xs text-texto-2">
            <span>Gasto do mês {dinheiro(mes.gasto)} de {dinheiro(c.orcamento_mensal)}</span>
            <span className="num text-texto-3">dia {diaAtual}/{totalDias}</span>
          </div>
          <div className="relative mt-1.5 h-1.5 rounded-full bg-superficie-2">
            <div className={`h-full rounded-full ${corRitmo}`} style={{ width: `${usoOrc * 100}%` }} />
            {/* marcador de onde o gasto "deveria" estar hoje */}
            <div className="absolute top-[-3px] h-3 w-0.5 bg-texto-2" style={{ left: `${(diaAtual / totalDias) * 100}%` }} />
          </div>
          {mes.ritmo !== null && (mes.ritmo > 1.1 || mes.ritmo < 0.9) && (
            <div className={`mt-1 text-xs ${mes.ritmo > 1.1 ? "text-critico" : "text-atencao"}`}>
              Projeção: {dinheiro(mes.projecao)} ({mes.ritmo > 1 ? "vai estourar" : "vai sobrar"} o orçamento)
            </div>
          )}
        </div>
      )}
    </Link>
  );
}

function Metrica({ rotulo, valor, alerta, children }: {
  rotulo: string; valor: string; alerta?: boolean; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-texto-3">{rotulo}</div>
      <div className={`num text-[17px] font-bold ${alerta ? "text-critico" : ""}`}>{valor}</div>
      {children}
    </div>
  );
}
