"use client";

import { useState, useSyncExternalStore } from "react";
import { desligarLinkCliente, gerarLinkCliente } from "@/app/acoes-portal";

/** Link só de leitura do cliente: criar, copiar, trocar e desligar. */
export function LinkCliente({ clienteId, token }: { clienteId: string; token: string | null }) {
  // endereço do painel (só existe no navegador; no servidor fica vazio)
  const origem = useSyncExternalStore(() => () => {}, () => window.location.origin, () => "");
  const [copiado, setCopiado] = useState(false);
  const url = token ? `${origem}/portal/${token}` : "";
  const botao = "min-h-9 rounded-lg border border-borda bg-superficie px-3 text-sm hover:border-destaque";
  return (
    <details className="group relative">
      <summary className="inline-flex min-h-[42px] cursor-pointer list-none items-center gap-1.5 rounded-[10px] border border-borda bg-superficie px-4 text-sm font-semibold hover:border-destaque [&::-webkit-details-marker]:hidden">
        🔗 Link do cliente
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-[min(92vw,420px)] space-y-3 rounded-2xl border border-borda bg-superficie p-4 text-sm shadow-xl">
        <p className="text-texto-2">
          Página <b>só de leitura</b> para o cliente acompanhar os números (investimento, resultados, funil do CRM e campanhas).
          Sem dados pessoais dos leads e sem nenhum botão de alteração.
        </p>
        {token ? (
          <>
            <div className="flex gap-2">
              <input readOnly value={url} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded-lg border border-borda bg-fundo px-2 py-1.5 font-mono text-xs" />
              <button type="button" className={botao} onClick={() => { void navigator.clipboard?.writeText(url); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }}>
                {copiado ? "Copiado ✓" : "Copiar"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={url} target="_blank" rel="noreferrer" className={`${botao} inline-flex items-center`}>Abrir</a>
              <form action={gerarLinkCliente} onSubmit={(e) => { if (!confirm("Trocar o link? O atual para de funcionar.")) e.preventDefault(); }}>
                <input type="hidden" name="cliente_id" value={clienteId} />
                <button className={botao}>Trocar link</button>
              </form>
              <form action={desligarLinkCliente} onSubmit={(e) => { if (!confirm("Desligar o link? O cliente perde o acesso.")) e.preventDefault(); }}>
                <input type="hidden" name="cliente_id" value={clienteId} />
                <button className={`${botao} text-critico`}>Desligar</button>
              </form>
            </div>
          </>
        ) : (
          <form action={gerarLinkCliente}>
            <input type="hidden" name="cliente_id" value={clienteId} />
            <button className="min-h-10 rounded-[10px] bg-destaque px-4 text-sm font-semibold text-white">Criar link</button>
          </form>
        )}
      </div>
    </details>
  );
}
