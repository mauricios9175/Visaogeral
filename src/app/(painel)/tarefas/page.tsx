import { connection } from "next/server";
import { db, EMPRESA_PADRAO } from "@/lib/db";
import { hojeISO } from "@/lib/datas";
import { listarTarefas } from "@/lib/tarefas";
import { Tarefas, type ClienteTarefa } from "@/components/tarefas";

export default async function PaginaTarefas() {
  await connection();
  const [tarefas, { data }] = await Promise.all([
    listarTarefas(),
    db().from("clientes").select("id, nome, empresa").eq("ativo", true).order("nome"),
  ]);
  const clientes: ClienteTarefa[] = ((data ?? []) as { id: string; nome: string; empresa: string | null }[])
    .map((c) => ({ id: c.id, nome: c.nome, empresa: c.empresa || EMPRESA_PADRAO }))
    // empresas em ordem, clientes próprios por último (igual ao menu)
    .sort((a, b) => Number(a.empresa === EMPRESA_PADRAO) - Number(b.empresa === EMPRESA_PADRAO) || a.empresa.localeCompare(b.empresa) || a.nome.localeCompare(b.nome));
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-[26px] font-extrabold tracking-tight">Tarefas</h1>
        <p className="mt-1 text-sm text-texto-3">
          Escreva ou fale do jeito que vier: “trocar criativo do Kiko amanhã”, “reunião com a Vidros Inova sexta”, “cobrar briefing da Lidermaq dia 20”.
          O cliente e a data saem do texto. Sem data, vai para hoje.
        </p>
      </header>
      <Tarefas inicial={tarefas} clientes={clientes} hoje={hojeISO()} />
    </div>
  );
}
