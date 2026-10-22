import Link from "next/link";
import { calcularAlertas, type Alerta, type Nivel } from "@/lib/alertas";
import { Aviso } from "@/components/ui";
import { AcoesRapidas } from "@/components/acoes-rapidas";
import { db } from "@/lib/db";
import { horasAtras, quandoFoi } from "@/lib/formato";

const NIVEIS: { chave: Nivel; titulo: string; classe: string; icone: string }[] = [
  { chave: "critico", titulo: "Crítico", classe: "bg-critico-bg text-critico", icone: "■" },
  { chave: "atencao", titulo: "Atenção", classe: "bg-atencao-bg text-atencao", icone: "▲" },
  { chave: "oportunidade", titulo: "Oportunidades", classe: "bg-bom-bg text-bom", icone: "●" },
];

export default async function Alertas({ searchParams }: PageProps<"/alertas">) {
  const { empresa, msg } = (await searchParams) as { empresa?: string; msg?: string };
  const [todos, { data: feitas }] = await Promise.all([
    calcularAlertas(),
    // ações das últimas 24 h: o alerta só some quando os dados do dia virarem, então mostramos o que já foi feito
    db().from("acoes_log").select("objeto_id, acao, depois, criado_em").eq("ok", true)
      .gte("criado_em", horasAtras(24)).order("criado_em", { ascending: false }),
  ]);
  const feitaPorObjeto = new Map<string, { acao: string; depois: string | null; criado_em: string }>();
  for (const f of feitas ?? []) if (!feitaPorObjeto.has(f.objeto_id)) feitaPorObjeto.set(f.objeto_id, f);
  const voltar = empresa ? `/alertas?empresa=${encodeURIComponent(empresa)}` : "/alertas";
  const empresas = [...new Set(todos.map((a) => a.empresa))].sort();
  const alertas = empresa ? todos.filter((a) => a.empresa === empresa) : todos;
  const chip = (ativo: boolean) =>
    `rounded-full border px-3 py-1 ${ativo ? "border-destaque bg-superficie font-medium" : "border-borda text-texto-2 hover:text-texto"}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Alertas</h1>
        <p className="text-sm text-texto-2">
          Últimos 7 dias (até ontem) comparados com os 7 dias anteriores, mais saldo e status das contas.
          Atualiza junto com a sincronização.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 text-sm">
        {[null, ...empresas].map((e) => (
          <Link key={e ?? "todas"} href={e ? `/alertas?empresa=${encodeURIComponent(e)}` : "/alertas"} className={chip((e ?? undefined) === empresa)}>
            {e ?? "Todas as empresas"} <span className="text-texto-3">({e ? todos.filter((a) => a.empresa === e).length : todos.length})</span>
          </Link>
        ))}
      </div>

      {msg && <Aviso>{msg}</Aviso>}
      {alertas.length === 0 && <Aviso>Nenhum alerta no momento. 🎉</Aviso>}

      {NIVEIS.map((n) => {
        const lista = alertas.filter((a) => a.nivel === n.chave);
        if (!lista.length) return null;
        return (
          <section key={n.chave} className="space-y-2">
            <h2 className="text-sm font-medium">
              <span className={`rounded-full px-2 py-0.5 text-xs ${n.classe}`}>{n.icone} {n.titulo}</span>{" "}
              <span className="text-texto-3">({lista.length})</span>
            </h2>
            <ul className="divide-y divide-borda rounded-xl border border-borda bg-superficie text-sm">
              {lista.map((a, i) => (
                <ItemAlerta key={i} a={a} voltar={voltar} feita={a.acao ? feitaPorObjeto.get(a.acao.objetoId) : undefined} />
              ))}
            </ul>
          </section>
        );
      })}
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
