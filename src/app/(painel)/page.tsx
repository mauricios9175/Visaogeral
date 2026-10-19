import Link from "next/link";
import { resolverPeriodo, progressoDoMes } from "@/lib/datas";
import { alertasContas, resumoClientes, type AlertaConta, type ResumoCliente } from "@/lib/consultas";
import { db } from "@/lib/db";
import { dataCurta, dinheiro, inteiro, quandoFoi } from "@/lib/formato";
import { Aviso, SeletorPeriodo, SeloSaude, Variacao } from "@/components/ui";


const ORDEM = { critico: 0, atencao: 1, ok: 2, sem_dados: 3 };

export default async function VisaoGeral({ searchParams }: PageProps<"/">) {
  const { p } = (await searchParams) as { p?: string };
  const { atual, anterior } = resolverPeriodo(p);
  const banco = db();
  const [resumos, alertas, { data: ultima }, { count: semCliente }, { data: primeiro }] = await Promise.all([
    resumoClientes(atual, anterior),
    alertasContas(),
    banco.from("sync_execucoes").select("finalizado_em, status").not("finalizado_em", "is", null)
      .order("id", { ascending: false }).limit(1).maybeSingle(),
    banco.from("contas_anuncio").select("id", { count: "exact", head: true }).is("cliente_id", null).eq("status", 1),
    banco.from("metricas_diarias").select("data").order("data").limit(1).maybeSingle(),
  ]);
  const historicoDesde: string | null = primeiro?.data ?? null;
  resumos.sort((a, b) => ORDEM[a.saude] - ORDEM[b.saude] || b.atual.gasto - a.atual.gasto);

  const total = resumos.reduce(
    (t, r) => ({ gasto: t.gasto + r.atual.gasto, resultados: t.resultados + r.atual.resultados }),
    { gasto: 0, resultados: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Visão geral</h1>
          <p className="text-sm text-texto-2">
            {resumos.length} clientes · {dinheiro(total.gasto)} investidos · {inteiro(total.resultados)} resultados ·
            atualizado {quandoFoi(ultima?.finalizado_em ?? null)}
          </p>
        </div>
        <SeletorPeriodo atual={atual.chave} base="/" />
      </div>

      {historicoDesde && historicoDesde > atual.desde && (
        <Aviso>
          O histórico carregado começa em {dataCurta(historicoDesde)}, então este período mostra só os dias a partir daí.
          Para comparar períodos maiores, clique em “Recarregar últimos 30 dias” em{" "}
          <Link href="/configuracoes" className="text-destaque underline">Configurações</Link>.
        </Aviso>
      )}

      {alertas.length > 0 && <PainelAlertas alertas={alertas} />}

      {!!semCliente && (
        <Aviso>
          {semCliente} conta(s) ativa(s) de anúncio ainda sem cliente vinculado.{" "}
          <Link href="/configuracoes" className="text-destaque underline">Vincular agora</Link>
        </Aviso>
      )}
      {resumos.length === 0 && (
        <Aviso>
          Nenhum cliente cadastrado. Vá em <Link href="/configuracoes" className="text-destaque underline">Configurações</Link>,
          importe as contas do Meta e cadastre seus clientes.
        </Aviso>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {resumos.map((r) => (
          <CardCliente
            key={r.cliente.id} r={r} periodo={atual.chave}
            alertas={alertas.filter((a) => a.clienteId === r.cliente.id).length}
          />
        ))}
      </div>
      <p className="text-xs text-texto-3">
        Resultados = leads (formulário/site) + conversas iniciadas. Variações comparam com {anterior.rotulo}.
      </p>
    </div>
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

function CardCliente({ r, periodo, alertas }: { r: ResumoCliente; periodo: string; alertas: number }) {
  const { cliente: c, atual: a, anterior: b, mes } = r;
  const { diaAtual, totalDias } = progressoDoMes();
  const usoOrc = c.orcamento_mensal ? Math.min(mes.gasto / c.orcamento_mensal, 1) : null;
  const cprAcima = c.cpl_meta && a.cpr !== null && a.cpr > c.cpl_meta;
  const max = Math.max(...r.serie.map((s) => s.gasto), 1);

  return (
    <Link
      href={`/clientes/${c.id}?p=${periodo}`}
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
