import Link from "next/link";
import { resolverPeriodo, progressoDoMes } from "@/lib/datas";
import { alertasContas, resumoClientes, resumoCrm, type AlertaConta, type NumerosCrm, type ResumoCliente } from "@/lib/consultas";
import { db, EMPRESA_PADRAO } from "@/lib/db";
import { resumoGoogle, type NumerosGoogle } from "@/lib/consultas-google";
import { dataCurta, dinheiro, inteiro, quandoFoi } from "@/lib/formato";
import { Aviso, SeletorPeriodo, SeloSaude, TiposResultado, Variacao } from "@/components/ui";


const ORDEM = { critico: 0, atencao: 1, ok: 2, sem_dados: 3 };

export default async function VisaoGeral({ searchParams }: PageProps<"/">) {
  const busca = (await searchParams) as { p?: string; de?: string; ate?: string; empresa?: string };
  const { atual, anterior } = resolverPeriodo(busca);
  const banco = db();
  const [todosResumos, todosAlertas, { data: ultima }, { count: semCliente }, { data: primeiro }, crm, google] = await Promise.all([
    resumoClientes(atual, anterior),
    alertasContas(),
    banco.from("sync_execucoes").select("finalizado_em, status").not("finalizado_em", "is", null)
      .order("id", { ascending: false }).limit(1).maybeSingle(),
    banco.from("contas_anuncio").select("id", { count: "exact", head: true }).is("cliente_id", null).eq("status", 1),
    banco.from("metricas_diarias").select("data").order("data").limit(1).maybeSingle(),
    resumoCrm(atual, anterior),
    resumoGoogle(atual, anterior).catch(() => new Map<string, { atual: NumerosGoogle; anterior: NumerosGoogle }>()),
  ]);
  const historicoDesde: string | null = primeiro?.data ?? null;
  todosResumos.sort((a, b) => ORDEM[a.saude] - ORDEM[b.saude] || b.atual.gasto - a.atual.gasto);

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
    .map((e) => resumirEmpresa(e, todosResumos.filter((r) => empresaDe(r) === e), todosAlertas, crm, google));
  const linkEmpresa = (e: string | null) => `/?${atual.qs}${e ? `&empresa=${encodeURIComponent(e)}` : ""}`;

  const total = resumos.reduce(
    (t, r) => ({
      gasto: t.gasto + r.atual.gasto, resultados: t.resultados + r.atual.resultados,
      google: t.google + (google.get(r.cliente.id)?.atual.gasto ?? 0),
    }),
    { gasto: 0, resultados: 0, google: 0 },
  );

  // sem filtro: cards agrupados por empresa; com filtro: só a empresa escolhida
  const grupos = (empresa ? [empresa] : empresas).map((e) => ({ empresa: e, itens: resumos.filter((r) => empresaDe(r) === e) }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{empresa ?? "Visão geral"}</h1>
          <p className="text-sm text-texto-2">
            {resumos.length} clientes · {dinheiro(total.gasto)} investidos no Meta · {inteiro(total.resultados)} resultados ·
            {total.google > 0 && <> {dinheiro(total.google)} no Google ·</>}
            atualizado {quandoFoi(ultima?.finalizado_em ?? null)}
          </p>
        </div>
        <SeletorPeriodo atual={atual} base="/" extra={empresa ? { empresa } : {}} />
      </div>

      {/* filtro por empresa */}
      <nav className="flex flex-wrap gap-1 text-sm">
        {[null, ...empresas].map((e) => (
          <Link
            key={e ?? "todas"} href={linkEmpresa(e)}
            className={`rounded-full border px-3 py-1 ${e === empresa ? "border-destaque bg-superficie font-medium" : "border-borda text-texto-2 hover:text-texto"}`}
          >
            {e ?? "Todas as empresas"}{" "}
            <span className="text-texto-3">({e ? todosResumos.filter((r) => empresaDe(r) === e).length : todosResumos.length})</span>
          </Link>
        ))}
      </nav>

      {/* resumo de cada empresa */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {resumoEmpresas.map((e) => <CardEmpresa key={e.nome} e={e} href={linkEmpresa(e.nome)} ativo={e.nome === empresa} />)}
      </div>

      {historicoDesde && historicoDesde > atual.desde && (
        <Aviso>
          O histórico carregado começa em {dataCurta(historicoDesde)}, então este período mostra só os dias a partir daí.
          Para comparar períodos maiores, clique em “Recarregar últimos 30 dias” em{" "}
          <Link href="/configuracoes" className="text-destaque underline">Configurações</Link>.
        </Aviso>
      )}

      {alertas.length > 0 && <PainelAlertas alertas={alertas} />}
      <p className="text-sm">
        <Link href={empresa ? `/alertas?empresa=${encodeURIComponent(empresa)}` : "/alertas"} className="text-destaque underline">
          Ver alertas de desempenho (custo subindo, anúncios sem resultado, criativos saturando, oportunidades)
        </Link>
      </p>

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

      {grupos.map((g) => (
        <section key={g.empresa} className="space-y-3">
          {!empresa && <h2 className="text-sm font-medium text-texto-2">{g.empresa}</h2>}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {g.itens.map((r) => (
              <CardCliente
                key={r.cliente.id} r={r} periodo={atual.qs}
                alertas={alertas.filter((a) => a.clienteId === r.cliente.id).length}
                crm={crm.get(r.cliente.id)?.atual}
                google={google.get(r.cliente.id)}
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
  google: Map<string, { atual: NumerosGoogle }>,
) {
  const soma = (f: (r: ResumoCliente) => number) => rs.reduce((t, r) => t + f(r), 0);
  const ids = new Set(rs.map((r) => r.cliente.id));
  const crms = rs.map((r) => crm.get(r.cliente.id)?.atual).filter((x): x is NumerosCrm => !!x);
  const gasto = soma((r) => r.atual.gasto);
  const gs = rs.map((r) => google.get(r.cliente.id)?.atual).filter((x): x is NumerosGoogle => !!x && x.gasto > 0);
  const resultados = soma((r) => r.atual.resultados);
  return {
    nome,
    clientes: rs.length,
    criticos: rs.filter((r) => r.saude === "critico").length,
    gasto,
    gastoAnterior: soma((r) => r.anterior.gasto),
    resultados,
    resultadosAnterior: soma((r) => r.anterior.resultados),
    cpr: resultados ? gasto / resultados : null,
    cprAnterior: (() => { const g = soma((r) => r.anterior.gasto), n = soma((r) => r.anterior.resultados); return n ? g / n : null; })(),
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
      className={`block rounded-xl border bg-superficie p-4 transition hover:border-destaque ${ativo ? "border-destaque" : "border-borda"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium">{e.nome}</div>
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
        <div className="mt-3 rounded-lg bg-fundo px-2 py-1 text-xs text-texto-2">
          Google ({e.google.clientes} cliente(s)): {dinheiro(e.google.gasto)} · {inteiro(e.google.conversoes)} conversões
          {e.google.conversoes > 0 && <> · {dinheiro(e.google.gasto / e.google.conversoes)} cada</>}
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

function PainelAlertas({ alertas }: { alertas: AlertaConta[] }) {
  return (
    <section className="rounded-xl border border-borda bg-superficie">
      <h2 className="border-b border-borda px-4 py-2 text-sm font-medium">
        Precisa de atenção agora ({alertas.length})
      </h2>
      <ul className="divide-y divide-borda text-sm">
        {alertas.map((a, i) => (
          <li key={i} className="flex gap-3 px-4 py-2">
            <span
              className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                a.nivel === "critico" ? "bg-critico-bg text-critico" : "bg-atencao-bg text-atencao"
              }`}
            >
              {a.nivel === "critico" ? "■ Crítico" : "▲ Atenção"}
            </span>
            <span>
              <Link href={`/clientes/${a.clienteId}`} className="font-medium hover:underline">{a.clienteNome}</Link>
              <span className="text-texto-3"> · {a.contaNome}</span>
              <span className="block text-texto-2">{a.mensagem}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CardCliente({ r, periodo, alertas, crm, google }: {
  r: ResumoCliente; periodo: string; alertas: number; crm?: NumerosCrm;
  google?: { atual: NumerosGoogle; anterior: NumerosGoogle };
}) {
  const { cliente: c, atual: a, anterior: b, mes } = r;
  const { diaAtual, totalDias } = progressoDoMes();
  const usoOrc = c.orcamento_mensal ? Math.min(mes.gasto / c.orcamento_mensal, 1) : null;
  const cprAcima = c.cpl_meta && a.cpr !== null && a.cpr > c.cpl_meta;
  const max = Math.max(...r.serie.map((s) => s.gasto), 1);

  return (
    <Link
      href={`/clientes/${c.id}?${periodo}`}
      className="block rounded-xl border border-borda bg-superficie p-4 transition hover:border-destaque"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{c.nome}</div>
          <div className="text-xs text-texto-3">{c.nicho ?? "—"} · {r.contas} conta(s)</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <SeloSaude saude={r.saude} />
          {alertas > 0 && (
            <span className="rounded-full bg-critico-bg px-2 py-0.5 text-xs font-medium text-critico">
              ■ {alertas} alerta(s) de conta
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Metrica rotulo="Investido" valor={dinheiro(a.gasto)}>
          <Variacao atual={a.gasto} anterior={b.gasto} neutro />
        </Metrica>
        <Metrica rotulo="Resultados" valor={inteiro(a.resultados)}>
          <Variacao atual={a.resultados} anterior={b.resultados} />
        </Metrica>
        <Metrica rotulo="Custo/result." valor={dinheiro(a.cpr)} alerta={!!cprAcima}>
          <Variacao atual={a.cpr} anterior={b.cpr} menorMelhor />
        </Metrica>
      </div>

      <div className="mt-2"><TiposResultado m={a} compacto /></div>
      {google && (google.atual.gasto > 0 || google.anterior.gasto > 0) && (
        <div className="mt-2 rounded-lg bg-fundo px-2 py-1 text-xs text-texto-2">
          Google: {dinheiro(google.atual.gasto)} · {inteiro(google.atual.conversoes)} conversões
          {google.atual.cpa != null && <> · {dinheiro(google.atual.cpa)} cada</>}
          {google.atual.cpa != null && google.anterior.cpa != null && (
            <> <Variacao atual={google.atual.cpa} anterior={google.anterior.cpa} menorMelhor /></>
          )}
        </div>
      )}
      {crm && (
        <div className="mt-2 rounded-lg bg-fundo px-2 py-1 text-xs text-texto-2">
          CRM: {inteiro(crm.leads)} leads ({inteiro(crm.leadsAnuncio)} de anúncio)
          {crm.qualificados != null && <> · {inteiro(crm.qualificados)} qualificados</>}
          {" · "}{inteiro(crm.vendas)} vendas · {dinheiro(crm.faturamento)}
          {a.gasto > 0 && crm.faturamentoAnuncio > 0 && <> · ROAS {(crm.faturamentoAnuncio / a.gasto).toFixed(1).replace(".", ",")}</>}
        </div>
      )}

      {c.cpl_meta && (
        <div className="mt-2 text-xs text-texto-3">
          Meta {dinheiro(c.cpl_meta)} {cprAcima ? <span className="text-critico">· acima da meta</span> : null}
        </div>
      )}

      {/* mini gráfico de gasto diário do período */}
      <div className="mt-3 flex h-10 items-end gap-0.5" aria-hidden>
        {r.serie.map((s) => (
          <div
            key={s.data}
            className="flex-1 rounded-t-sm bg-destaque/70"
            style={{ height: `${Math.max((s.gasto / max) * 100, 2)}%` }}
            title={`${s.data}: ${dinheiro(s.gasto)}`}
          />
        ))}
      </div>

      {usoOrc !== null && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-texto-2">
            <span>Orçamento do mês: {dinheiro(mes.gasto)} de {dinheiro(c.orcamento_mensal)}</span>
            <span className="num">dia {diaAtual}/{totalDias}</span>
          </div>
          <div className="relative mt-1 h-1.5 rounded-full bg-fundo">
            <div className="h-full rounded-full bg-destaque" style={{ width: `${usoOrc * 100}%` }} />
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
      <div className="text-xs text-texto-3">{rotulo}</div>
      <div className={`num font-semibold ${alerta ? "text-critico" : ""}`}>{valor}</div>
      {children}
    </div>
  );
}
