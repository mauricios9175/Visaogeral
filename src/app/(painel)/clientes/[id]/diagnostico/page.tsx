import Link from "next/link";
import { notFound } from "next/navigation";
import { db, type ContaAnuncio } from "@/lib/db";
import { diasAtras } from "@/lib/datas";
import { dinheiro } from "@/lib/formato";
import { classificarAcao, extrairResultados, insightsDiagnostico, objetivosDosConjuntos } from "@/lib/meta";
import { tokenDaConta } from "@/lib/sync";

export const maxDuration = 60;

// Mostra, ao vivo, o que o Meta devolve para cada conjunto do cliente nos últimos 7 dias
// e como o painel classifica o resultado. Serve para conferir com o Gerenciador de Anúncios.
export default async function Diagnostico({ params }: PageProps<"/clientes/[id]/diagnostico">) {
  const { id } = await params;
  const banco = db();
  const { data: cliente } = await banco.from("clientes").select("id, nome").eq("id", id).maybeSingle();
  if (!cliente) notFound();
  const { data: contas } = await banco.from("contas_anuncio").select("*").eq("cliente_id", id);
  const desde = diasAtras(7);
  const ate = diasAtras(1);

  const blocos = await Promise.all(
    ((contas ?? []) as ContaAnuncio[]).map(async (conta) => {
      try {
        const token = await tokenDaConta(conta);
        if (!token) throw new Error("Sem token para esta conta");
        const [linhas, conjuntos] = await Promise.all([
          insightsDiagnostico(conta.id, token, desde, ate),
          objetivosDosConjuntos(conta.id, token).catch((e) => e as Error),
        ]);
        return { conta, linhas, conjuntos, erro: null };
      } catch (e) {
        return { conta, linhas: [], conjuntos: null, erro: e instanceof Error ? e.message : String(e) };
      }
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/clientes/${id}`} className="text-sm text-texto-3 hover:text-texto">← {cliente.nome}</Link>
        <h1 className="text-xl font-semibold">Diagnóstico de resultados</h1>
        <p className="text-sm text-texto-2">
          Dados ao vivo do Meta, por conjunto, de {desde.split("-").reverse().join("/")} a {ate.split("-").reverse().join("/")}.
          Compare a coluna “Painel conta” com “Resultados” do Gerenciador no mesmo período.
        </p>
      </div>

      {blocos.map(({ conta, linhas, conjuntos, erro }) => (
        <section key={conta.id} className="overflow-x-auto rounded-xl border border-borda bg-superficie">
          <h2 className="border-b border-borda px-4 py-2 text-sm font-medium">
            {conta.nome} <span className="font-normal text-texto-3">· {conta.id}</span>
          </h2>
          {erro && <p className="px-4 py-2 text-sm text-critico">Erro: {erro}</p>}
          {conjuntos instanceof Error && (
            <p className="px-4 py-2 text-sm text-critico">Erro ao ler objetivos dos conjuntos: {conjuntos.message}</p>
          )}
          {!erro && !linhas.length && <p className="px-4 py-2 text-sm text-texto-3">Sem veiculação no período.</p>}
          {!!linhas.length && (
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="text-left text-xs text-texto-3">
                <tr>
                  <th className="px-4 py-2 font-normal">Campanha / conjunto</th>
                  <th className="px-3 py-2 font-normal">Objetivo</th>
                  <th className="px-3 py-2 font-normal">Gasto</th>
                  <th className="px-3 py-2 font-normal">“Results” do Meta</th>
                  <th className="px-3 py-2 font-normal">Painel conta</th>
                  <th className="px-3 py-2 font-normal">Todas as ações</th>
                </tr>
              </thead>
              <tbody className="align-top">
                {linhas.map((l) => {
                  const cj = conjuntos instanceof Error ? undefined : conjuntos?.get(l.adset_id);
                  const r = extrairResultados(l, conjuntos instanceof Error ? undefined : conjuntos ?? undefined);
                  const results = l.results?.find((x) => x.indicator);
                  return (
                    <tr key={l.adset_id} className="border-t border-borda">
                      <td className="px-4 py-2">
                        <div>{l.campaign_name}</div>
                        <div className="text-xs text-texto-3">{l.adset_name}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div>{l.objective ?? "—"}</div>
                        <div>{cj?.optimization_goal ?? l.optimization_goal ?? "—"}</div>
                        {cj?.promoted_object && (
                          <div className="text-texto-3">{JSON.stringify(cj.promoted_object)}</div>
                        )}
                      </td>
                      <td className="num px-3 py-2">{dinheiro(Number(l.spend ?? 0))}</td>
                      <td className="px-3 py-2 text-xs">
                        {results ? `${results.indicator} = ${results.values?.[0]?.value ?? 0}` : "não veio"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div className="font-medium">{r.resultados} · {r.tipo}</div>
                        <div className="text-texto-3">{r.acao ?? "nenhuma ação"}</div>
                      </td>
                      <td className="px-3 py-2 text-xs text-texto-2">
                        {(l.actions ?? []).map((a) => (
                          <div key={a.action_type}>
                            {a.action_type} = {a.value}
                            <span className="text-texto-3"> ({classificarAcao(a.action_type, l.actions)})</span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}
