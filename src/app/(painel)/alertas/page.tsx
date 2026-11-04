import Link from "next/link";
import { calcularAlertas, type Alerta, type Nivel } from "@/lib/alertas";
import { alertasContas, type AlertaConta } from "@/lib/consultas";
import { Aviso } from "@/components/ui";
import { AcoesRapidas } from "@/components/acoes-rapidas";
import { db, EMPRESA_PADRAO } from "@/lib/db";
import { horasAtras, quandoFoi } from "@/lib/formato";

const NIVEIS: { chave: Nivel; titulo: string; classe: string; icone: string }[] = [
  { chave: "critico", titulo: "Crítico", classe: "bg-critico-bg text-critico", icone: "■" },
  { chave: "atencao", titulo: "Atenção", classe: "bg-atencao-bg text-atencao", icone: "▲" },
  { chave: "oportunidade", titulo: "Oportunidades", classe: "bg-bom-bg text-bom", icone: "●" },
];

export default async function Alertas({ searchParams }: PageProps<"/alertas">) {
  const { empresa, msg } = (await searchParams) as { empresa?: string; msg?: string };
  const [todos, todasContas, { data: clientes }, { data: feitas }] = await Promise.all([
    calcularAlertas(),
    alertasContas().catch(() => [] as AlertaConta[]),
    db().from("clientes").select("id, empresa").eq("ativo", true),
    // ações das últimas 24 h: o alerta só some quando os dados do dia virarem, então mostramos o que já foi feito
    db().from("acoes_log").select("objeto_id, acao, depois, criado_em").eq("ok", true)
      .gte("criado_em", horasAtras(24)).order("criado_em", { ascending: false }),
  ]);
  const feitaPorObjeto = new Map<string, { acao: string; depois: string | null; criado_em: string }>();
  for (const f of feitas ?? []) if (!feitaPorObjeto.has(f.objeto_id)) feitaPorObjeto.set(f.objeto_id, f);
  const voltar = empresa ? `/alertas?empresa=${encodeURIComponent(empresa)}` : "/alertas";
  const empresaDe = new Map(((clientes ?? []) as { id: string; empresa: string | null }[]).map((c) => [c.id, c.empresa || EMPRESA_PADRAO]));
  const contasTodas = todasContas.map((a) => ({ ...a, empresa: empresaDe.get(a.clienteId) ?? EMPRESA_PADRAO }));
  const empresas = [...new Set([...todos.map((a) => a.empresa), ...contasTodas.map((a) => a.empresa)])].sort();
  const alertas = empresa ? todos.filter((a) => a.empresa === empresa) : todos;
  const contas = empresa ? contasTodas.filter((a) => a.empresa === empresa) : contasTodas;
  const total = (e: string | null) => (e ? todos.filter((a) => a.empresa === e).length + contasTodas.filter((a) => a.empresa === e).length : todos.length + contasTodas.length);
  const chip = (ativo: boolean) =>
    `rounded-full border px-3 py-1 ${ativo ? "border-destaque bg-superficie font-medium" : "border-borda text-texto-2 hover:text-texto"}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Alertas</h1>
        <p className="text-sm text-texto-2">
          Saldo e status das contas primeiro; depois o desempenho (últimos 7 dias até ontem vs os 7 anteriores).
          Atualiza junto com a sincronização.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 text-sm">
        {[null, ...empresas].map((e) => (
          <Link key={e ?? "todas"} href={e ? `/alertas?empresa=${encodeURIComponent(e)}` : "/alertas"} className={chip((e ?? undefined) === empresa)}>
            {e ?? "Todas as empresas"} <span className="text-texto-3">({total(e)})</span>
          </Link>
        ))}
      </div>

      {msg && <Aviso>{msg}</Aviso>}

      <SaldoEContas contas={contas} />

      <section id="desempenho" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-borda pt-5">
          <h2 className="text-lg font-bold">Desempenho <span className="text-sm font-normal text-texto-3">({alertas.length})</span></h2>
          <span className="text-xs text-texto-3">Sugestões pelos números: avalie caso a caso.</span>
        </div>
        {alertas.length === 0 && <p className="text-sm text-texto-2">Nenhum alerta de desempenho agora.</p>}
        {NIVEIS.map((n) => {
          const lista = alertas.filter((a) => a.nivel === n.chave);
          if (!lista.length) return null;
          return (
            <div key={n.chave} className="space-y-2">
              <h3 className="text-sm font-medium">
                <span className={`rounded-full px-2 py-0.5 text-xs ${n.classe}`}>{n.icone} {n.titulo}</span>{" "}
                <span className="text-texto-3">({lista.length})</span>
              </h3>
              <ul className="divide-y divide-borda rounded-2xl border border-borda bg-superficie text-sm">
                {lista.map((a, i) => (
                  <ItemAlerta key={i} a={a} voltar={voltar} feita={a.acao ? feitaPorObjeto.get(a.acao.objetoId) : undefined} />
                ))}
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function ItemAlerta({ a, voltar, feita }: {
  a: Alerta; voltar: string; feita?: { acao: string; depois: string | null; criado_em: string };
}) {
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-0.5">
      <div>
        <Link href={`/clientes/${a.clienteId}`} className="font-medium hover:underline">{a.clienteNome}</Link>
        <span className="text-texto-3"> · {a.empresa} · </span>
        <span className="font-medium">{a.titulo}</span>
      </div>
      <div className="text-texto-2">{a.detalhe}</div>
      <div className="text-xs text-texto-3">→ {a.sugestao}</div>
      </div>
      {a.acao && (feita ? (
        <span className="rounded-md bg-bom-bg px-2 py-1 text-xs text-bom">
          ✓ {feita.acao === "pausar" ? "Pausado" : feita.acao === "ativar" ? "Ativado" : `Orçamento → ${feita.depois}`} pelo painel {quandoFoi(feita.criado_em)}
        </span>
      ) : (
        <AcoesRapidas
          plataforma={a.acao.plataforma} contaId={a.acao.contaId} objetoId={a.acao.objetoId} nivel={a.acao.nivel}
          nome={a.acao.nome} ativo={a.acao.tipo === "pausar" ? true : null} orcamento={null}
          mostrarOrcamento={a.acao.tipo === "orcamento"} voltar={voltar}
        />
      ))}
    </li>
  );
}

/** O que é o aviso da conta: saldo, limite de gastos ou status (conta bloqueada, em análise…). */
function tipoDaConta(a: AlertaConta) {
  if (/saldo|recarga/i.test(a.mensagem)) return "Saldo";
  if (/limite|or[cç]amento da conta/i.test(a.mensagem)) return "Limite de gastos";
  return "Status da conta";
}

/** Saldo e contas: em destaque, porque sem saldo os anúncios param. */
function SaldoEContas({ contas }: { contas: (AlertaConta & { empresa: string })[] }) {
  const criticos = contas.filter((a) => a.nivel === "critico").length;
  return (
    <section id="saldo" className={`space-y-3 rounded-2xl border p-4 lg:p-5 ${contas.length ? "border-critico/50 bg-critico-bg/40" : "border-borda bg-superficie"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">💳 Saldo e contas</h2>
        {contas.length > 0 && (
          <span className="rounded-full bg-critico-bg px-2.5 py-0.5 text-[13px] font-semibold text-critico">
            {contas.length}{criticos ? ` · ${criticos} crítico(s)` : ""}
          </span>
        )}
      </div>
      {contas.length === 0 ? (
        <p className="text-sm text-texto-2">● Tudo certo: nenhuma conta com saldo baixo, limite estourando ou bloqueio.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {contas.map((a, i) => {
            const critico = a.nivel === "critico";
            return (
              <div key={i} className={`flex gap-3.5 rounded-2xl border bg-superficie p-4 ${critico ? "border-critico/60" : "border-borda"}`}>
                <span aria-hidden className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-base ${critico ? "bg-critico-bg text-critico" : "bg-atencao-bg text-atencao"}`}>
                  {critico ? "■" : "▲"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/clientes/${a.clienteId}`} className="font-bold hover:underline">{a.clienteNome}</Link>
                    <span className={`text-[11px] font-bold uppercase tracking-wide ${critico ? "text-critico" : "text-atencao"}`}>
                      {critico ? "Crítico" : "Atenção"} · {tipoDaConta(a)}
                    </span>
                  </div>
                  <div className="text-xs text-texto-3">{a.contaNome} · {a.empresa}</div>
                  <p className="mt-1 text-sm leading-relaxed text-texto-2">{a.mensagem}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
