import Link from "next/link";
import { sair } from "../acoes";

export default function PainelLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="border-b border-borda bg-superficie">
        <nav className="mx-auto flex max-w-7xl items-center gap-x-6 gap-y-2 overflow-x-auto whitespace-nowrap px-4 py-3 text-sm">
          <Link href="/" className="font-semibold">Visão Geral</Link>
          <Link href="/alertas" className="text-texto-2 hover:text-texto">Alertas</Link>
          <Link href="/criativos" className="text-texto-2 hover:text-texto">Criativos</Link>
          <Link href="/modelos" className="text-texto-2 hover:text-texto">Modelos</Link>
          <Link href="/relatorios" className="text-texto-2 hover:text-texto">Relatórios</Link>
          <Link href="/configuracoes" className="text-texto-2 hover:text-texto">Configurações</Link>
          <form action={sair} className="ml-auto">
            <button className="text-texto-3 hover:text-texto">Sair</button>
          </form>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </>
  );
}
