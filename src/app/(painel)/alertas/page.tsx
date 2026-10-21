import Link from "next/link";
import { calcularAlertas, type Alerta, type Nivel } from "@/lib/alertas";
import { Aviso } from "@/components/ui";

const NIVEIS: { chave: Nivel; titulo: string; classe: string; icone: string }[] = [
  { chave: "critico", titulo: "Crítico", classe: "bg-critico-bg text-critico", icone: "■" },
  { chave: "atencao", titulo: "Atenção", classe: "bg-atencao-bg text-atencao", icone: "▲" },
  { chave: "oportunidade", titulo: "Oportunidades", classe: "bg-bom-bg text-bom", icone: "●" },
];

export default async function Alertas({ searchParams }: PageProps<"/alertas">) {
  const { empresa } = (await searchParams) as { empresa?: string };
  const todos = await calcularAlertas();
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
              {lista.map((a, i) => <ItemAlerta key={i} a={a} />)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ItemAlerta({ a }: { a: Alerta }) {
  return (
    <li className="space-y-0.5 px-4 py-3">
      <div>
        <Link href={`/clientes/${a.clienteId}`} className="font-medium hover:underline">{a.clienteNome}</Link>
        <span className="text-texto-3"> · {a.empresa} · </span>
        <span className="font-medium">{a.titulo}</span>
      </div>
      <div className="text-texto-2">{a.detalhe}</div>
      <div className="text-xs text-texto-3">→ {a.sugestao}</div>
    </li>
  );
}
