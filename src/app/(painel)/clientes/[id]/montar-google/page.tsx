import Link from "next/link";
import { notFound } from "next/navigation";
import { Aviso, Voltar } from "@/components/ui";
import { db } from "@/lib/db";
import { normalizarGoogle, type ConfigGoogle } from "@/lib/modelos-google";
import { MontagemGoogle } from "@/components/montagem-google";
import { lerCampanhaParaCopiar, type CopiaGoogle } from "@/lib/copiar-google";

export const maxDuration = 120;

export default async function MontarGoogle({ params, searchParams }: PageProps<"/clientes/[id]/montar-google">) {
  const { id } = await params;
  const { pedido, copiar } = (await searchParams) as { pedido?: string; copiar?: string };
  const banco = db();
  const [{ data: cliente }, { data: contas }, { data: modelos }] = await Promise.all([
    banco.from("clientes").select("id, nome").eq("id", id).maybeSingle(),
    banco.from("contas_google").select("id, nome").eq("cliente_id", id).order("nome"),
    banco.from("modelos").select("id, nome, config").eq("plataforma", "google").order("nome"),
  ]);
  if (!cliente) notFound();
  // "Copiar para outra conta": ?copiar=<conta de origem>:<campanha> traz a campanha inteira para revisar e colar aqui
  let copia: CopiaGoogle | null = null;
  let erroCopia: string | null = null;
  if (copiar && /^\d+:\d+$/.test(copiar)) {
    const [contaOrigem, campanha] = copiar.split(":");
    copia = await lerCampanhaParaCopiar(contaOrigem, campanha).catch((e) => { erroCopia = e instanceof Error ? e.message : String(e); return null; });
  }
  return (
    <div className="space-y-5">
      <div>
        <Voltar href={`/clientes/${id}`}>Voltar para {cliente.nome}</Voltar>
        <h1 className="text-xl font-semibold">Montar campanha no Google</h1>
        <p className="text-sm text-texto-2">
          Campanha de <b>Pesquisa</b>: o painel cria orçamento, campanha, grupos, palavras-chave, negativas e um anúncio
          responsivo por grupo, tudo <b>pausado</b>. Depois é só revisar e ativar no Google Ads.{" "}
          <Link href="/modelos?plataforma=google" className="text-destaque underline">Editar modelos</Link> ·{" "}
          <Link href={`/clientes/${id}/montar`} className="text-destaque underline">Montar no Meta</Link>
        </p>
      </div>
      {erroCopia && <Aviso>Não consegui ler a campanha para copiar: {erroCopia}</Aviso>}
      {!contas?.length ? (
        <Aviso>Este cliente não tem conta do Google Ads vinculada. Vincule em Configurações → Google Ads.</Aviso>
      ) : (
        <MontagemGoogle
          clienteId={id} pedidoInicial={pedido?.slice(0, 1000)} copia={copia}
          contas={(contas ?? []).map((c) => ({ id: c.id as string, nome: c.nome as string }))}
          modelos={((modelos ?? []) as { id: string; nome: string; config: Partial<ConfigGoogle> }[]).map((m) => ({ ...m, config: normalizarGoogle(m.config) }))}
        />
      )}
    </div>
  );
}
