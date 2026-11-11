import { connection } from "next/server";
import { Voltar } from "@/components/ui";
import { ImportarTrello, type ClienteImport } from "@/components/importar-trello";
import { db, EMPRESA_PADRAO } from "@/lib/db";

export default async function PaginaImportarTrello() {
  await connection();
  const { data } = await db().from("clientes").select("id, nome, empresa, ativo").order("nome");
  const clientes: ClienteImport[] = ((data ?? []) as { id: string; nome: string; empresa: string | null; ativo: boolean | null }[])
    .map((c) => ({ id: c.id, nome: c.nome, empresa: c.empresa || EMPRESA_PADRAO, ativo: c.ativo !== false }));
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="space-y-2">
        <Voltar href="/configuracoes">Configurações</Voltar>
        <h1 className="text-[26px] font-extrabold tracking-tight">Importar do Trello</h1>
        <p className="text-sm text-texto-3">
          Cada cartão vai para a <b>ficha</b> do cliente: descrição (sem senhas), links de redes, site e Drive, e pendências do checklist.
          Os cartões que não são de cliente (ex.: “Referências”) ficam de fora se você não escolher um cliente.
        </p>
      </header>
      <ImportarTrello clientes={clientes} />
    </div>
  );
}
