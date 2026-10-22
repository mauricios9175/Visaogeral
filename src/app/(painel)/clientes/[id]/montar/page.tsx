import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { normalizarConfig, type Modelo } from "@/lib/modelos";
import { Montagem, type Padroes } from "@/components/montagem";

export const maxDuration = 300;

export default async function Montar({ params }: PageProps<"/clientes/[id]/montar">) {
  const { id } = await params;
  const banco = db();
  const [{ data: cliente }, { data: contas }, { data: modelos }] = await Promise.all([
    banco.from("clientes").select("*").eq("id", id).maybeSingle(),
    banco.from("contas_anuncio").select("id, nome").eq("cliente_id", id).order("nome"),
    banco.from("modelos").select("*").eq("plataforma", "meta").order("nome"),
  ]);
  if (!cliente) notFound();

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/clientes/${id}`} className="text-sm text-texto-3 hover:text-texto">← {cliente.nome}</Link>
        <h1 className="text-xl font-semibold">Montar campanha no Meta</h1>
        <p className="text-sm text-texto-2">
          Escolha o modelo, a página e os criativos. O painel cria a campanha, o conjunto e um anúncio por criativo,
          tudo <b>pausado</b>. Depois é só revisar e ativar no Gerenciador.{" "}
          <Link href="/modelos" className="text-destaque underline">Editar modelos</Link>
        </p>
      </div>
      <Montagem
        clienteId={id}
        clienteNome={cliente.nome}
        contas={(contas ?? []).map((c) => ({ id: c.id, nome: c.nome }))}
        modelos={((modelos ?? []) as Modelo[]).map((m) => ({ ...m, config: normalizarConfig(m.config) }))}
        padroes={(cliente.padroes_meta ?? {}) as Padroes}
      />
    </div>
  );
}
