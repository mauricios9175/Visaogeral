import { sair } from "../acoes";
import { MenuCelular, MenuLateral, type ClienteMenu } from "@/components/menu";
import { connection } from "next/server";
import { db, EMPRESA_PADRAO } from "@/lib/db";

export default async function PainelLayout({ children }: LayoutProps<"/">) {
  // clientes ativos para o menu lateral, agrupados por empresa (clientes próprios por último);
  // lidos a cada acesso (nunca no build, que não tem banco)
  await connection();
  const { data } = await db().from("clientes").select("id, nome, empresa").eq("ativo", true).order("nome");
  const clientes: ClienteMenu[] = ((data ?? []) as { id: string; nome: string; empresa: string | null }[])
    .map((c) => ({ id: c.id, nome: c.nome, empresa: c.empresa || EMPRESA_PADRAO }))
    .sort((a, b) => Number(a.empresa === EMPRESA_PADRAO) - Number(b.empresa === EMPRESA_PADRAO) || a.empresa.localeCompare(b.empresa));
  return (
    <div className="flex min-h-screen">
      <MenuLateral sair={sair} clientes={clientes} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MenuCelular />
        {/* pb no celular: espaço para o menu de baixo */}
        <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 pb-24 pt-6 lg:px-9 lg:pb-12 lg:pt-8">{children}</main>
      </div>
    </div>
  );
}
