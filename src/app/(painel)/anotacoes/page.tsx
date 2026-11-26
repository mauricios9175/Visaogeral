import { connection } from "next/server";
import { listarAnotacoes } from "@/lib/anotacoes";
import { Anotacoes } from "@/components/anotacoes";

export default async function PaginaAnotacoes() {
  await connection();
  const anotacoes = await listarAnotacoes();
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <h1 className="text-[26px] font-extrabold tracking-tight">Anotações</h1>
        <p className="mt-1 text-sm text-texto-3">
          O que não é de nenhum cliente: links úteis, processos, ideias, fornecedores, roteiros… Separe em listas (como no Trello) e
          fixe com ★ o que usa sempre. O que é de um cliente fica na ficha dele.
        </p>
      </header>
      <Anotacoes inicial={anotacoes} />
    </div>
  );
}
