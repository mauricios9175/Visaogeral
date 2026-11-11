import Link from "next/link";
import { notFound } from "next/navigation";
import { Voltar } from "@/components/ui";
import { EditorFicha } from "@/components/ficha";
import { db } from "@/lib/db";
import { lerFicha } from "@/lib/ficha";

export default async function PaginaFicha({ params }: PageProps<"/clientes/[id]/ficha">) {
  const { id } = await params;
  const [{ data: cliente }, ficha] = await Promise.all([
    db().from("clientes").select("id, nome, empresa, nicho").eq("id", id).maybeSingle(),
    lerFicha(id),
  ]);
  if (!cliente) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="space-y-2">
        <Voltar href={`/clientes/${id}`}>{cliente.nome}</Voltar>
        <h1 className="text-[26px] font-extrabold tracking-tight">Ficha · {cliente.nome}</h1>
        <p className="text-sm text-texto-3">
          {[cliente.empresa, cliente.nicho].filter(Boolean).join(" · ")}
          {" · "}<Link href="/configuracoes/importar-trello" className="underline">importar do Trello</Link>
        </p>
      </header>
      <EditorFicha clienteId={id} inicial={ficha} />
    </div>
  );
}
