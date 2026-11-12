import { connection } from "next/server";
import { Voltar } from "@/components/ui";
import { EditorEmpresas } from "@/components/empresas";
import { FONTES, LAYOUTS, listarEmpresas } from "@/lib/empresas";

export default async function PaginaEmpresas() {
  await connection();
  const empresas = await listarEmpresas();
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="space-y-2">
        <Voltar href="/configuracoes">Configurações</Voltar>
        <h1 className="text-[26px] font-extrabold tracking-tight">Empresas e relatórios</h1>
        <p className="text-sm text-texto-3">
          Para quem você atende cada cliente (agências parceiras e os seus clientes próprios). Cada empresa tem o seu relatório:
          o layout, as cores, a fonte e se recebe relatório todo mês. As empresas aparecem aqui sozinhas a partir do cadastro dos clientes.
        </p>
      </header>
      <EditorEmpresas inicial={empresas} layouts={Object.entries(LAYOUTS).map(([k, v]) => ({ chave: k, nome: v.nome, descricao: v.descricao }))} fontes={FONTES} />
    </div>
  );
}
