"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; rotulo: string; curto?: string; icone: React.ReactNode; celular?: boolean };

const icone = (d: React.ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

export const ITENS: Item[] = [
  {
    href: "/", rotulo: "Visão geral", curto: "Início", celular: true,
    icone: icone(<><rect x="3" y="3" width="7" height="9" rx="2" /><rect x="14" y="3" width="7" height="5" rx="2" /><rect x="14" y="12" width="7" height="9" rx="2" /><rect x="3" y="16" width="7" height="5" rx="2" /></>),
  },
  {
    href: "/alertas", rotulo: "Alertas", celular: true,
    icone: icone(<><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></>),
  },
  {
    href: "/criativos", rotulo: "Criativos", celular: true,
    icone: icone(<><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-8 9" /></>),
  },
  {
    href: "/modelos", rotulo: "Modelos de campanha", curto: "Modelos",
    icone: icone(<><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></>),
  },
  {
    href: "/relatorios", rotulo: "Relatórios", celular: true,
    icone: icone(<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M9 13h6M9 17h4" /></>),
  },
  {
    href: "/configuracoes", rotulo: "Configurações", curto: "Ajustes",
    icone: icone(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" /></>),
  },
];

/** Item ativo: a página dele ou uma página dentro dela (as telas de cliente ficam na Visão geral). */
function ativo(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/clientes");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export type ClienteMenu = { id: string; nome: string; empresa: string };

/** Menu lateral (computador). `clientes`: ativos, para abrir direto por empresa. */
export function MenuLateral({ sair, clientes }: { sair: () => Promise<void>; clientes: ClienteMenu[] }) {
  const pathname = usePathname();
  const atual = pathname.match(/^\/clientes\/([^/]+)/)?.[1];
  const empresas = [...new Set(clientes.map((c) => c.empresa))];
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r border-borda bg-lateral px-4 py-6 lg:flex">
      <Link href="/" className="flex items-center gap-2.5 px-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-destaque">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 18 L9 11 L13 14 L20 5" /></svg>
        </span>
        <span>
          <span className="block text-base font-extrabold tracking-tight text-texto">Visão Geral</span>
          <span className="block text-xs text-texto-3">Gestão de tráfego</span>
        </span>
      </Link>
      <nav aria-label="Menu" className="flex flex-col gap-1">
        {ITENS.map((i) => {
          const sel = ativo(pathname, i.href);
          return (
            <Link
              key={i.href} href={i.href} aria-current={sel ? "page" : undefined}
              className={`flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm ${sel ? "bg-destaque-bg font-semibold text-texto [&_svg]:text-destaque" : "text-texto-2 hover:bg-superficie hover:text-texto"}`}
            >
              {i.icone}
              {i.rotulo}
            </Link>
          );
        })}
      </nav>
      {clientes.length > 0 && (
        <nav aria-label="Clientes" className="flex flex-col gap-1">
          <div className="px-3 text-xs font-semibold uppercase tracking-wider text-texto-3">Clientes</div>
          {empresas.map((e) => {
            const daEmpresa = clientes.filter((c) => c.empresa === e);
            return (
              <details key={e} open={daEmpresa.some((c) => c.id === atual)} className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[10px] px-3 py-2 text-sm text-texto-2 hover:bg-superficie hover:text-texto [&::-webkit-details-marker]:hidden">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" className="transition group-open:rotate-90"><path d="M9 6l6 6-6 6" /></svg>
                  <span className="flex-1 truncate font-medium">{e}</span>
                  <span className="text-xs text-texto-3">{daEmpresa.length}</span>
                </summary>
                <ul className="mb-1 ml-[22px] flex flex-col border-l border-borda pl-2">
                  {daEmpresa.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/clientes/${c.id}`} aria-current={c.id === atual ? "page" : undefined}
                        className={`block truncate rounded-lg px-2.5 py-1.5 text-[13px] ${c.id === atual ? "bg-destaque-bg font-semibold text-texto" : "text-texto-2 hover:bg-superficie hover:text-texto"}`}
                      >
                        {c.nome}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </nav>
      )}
      <form action={sair} className="mt-auto px-2">
        <button className="text-sm text-texto-3 hover:text-texto">Sair</button>
      </form>
    </aside>
  );
}

/** Barra de cima e menu de baixo (celular), como num aplicativo. */
export function MenuCelular() {
  const pathname = usePathname();
  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-2.5 border-b border-borda bg-lateral/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur lg:hidden">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-destaque">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 18 L9 11 L13 14 L20 5" /></svg>
        </span>
        <span className="font-extrabold tracking-tight">Visão Geral</span>
        <Link href="/configuracoes" className="ml-auto text-sm text-texto-2">Ajustes</Link>
      </header>
      <nav aria-label="Menu" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-borda bg-lateral/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {ITENS.filter((i) => i.celular).map((i) => {
          const sel = ativo(pathname, i.href);
          return (
            <Link
              key={i.href} href={i.href} aria-current={sel ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] ${sel ? "font-semibold text-texto [&_svg]:text-destaque" : "text-texto-3"}`}
            >
              {i.icone}
              {i.curto ?? i.rotulo}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
