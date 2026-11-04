import Link from "next/link";
import { notFound } from "next/navigation";
import { Aviso, Voltar } from "@/components/ui";
import { db } from "@/lib/db";
import { normalizarGoogle, type ConfigGoogle } from "@/lib/modelos-google";
import { MontagemGoogle } from "@/components/montagem-google";

export const maxDuration = 120;

export default async function MontarGoogle({ params, searchParams }: PageProps<"/clientes/[id]/montar-google">) {
  const { id } = await params;
  const { pedido } = (await searchParams) as { pedido?: string };
  const banco = db();
  const [{ data: cliente }, { data: contas }, { data: modelos }] = await Promise.all([
    banco.from("clientes").select("id, nome").eq("id", id).maybeSingle(),
    banco.from("contas_google").select("id, nome").eq("cliente_id", id).order("nome"),
    banco.from("modelos").select("id, nome, config").eq("plataforma", "google").order("nome"),
  ]);
  if (!cliente) notFound();
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
      {!contas?.length ? (
        <Aviso>Este cliente não tem conta do Google Ads vinculada. Vincule em Configurações → Google Ads.</Aviso>
      ) : (
        <MontagemGoogle
          clienteId={id} pedidoInicial={pedido?.slice(0, 1000)}
          contas={(contas ?? []).map((c) => ({ id: c.id as string, nome: c.nome as string }))}
          modelos={((modelos ?? []) as { id: string; nome: string; config: Partial<ConfigGoogle> }[]).map((m) => ({ ...m, config: normalizarGoogle(m.config) }))}
        />
      )}
    </div>
  );
}
