"use client";

import { acaoGoogleDetalhe } from "@/app/acoes-anuncios";

/** Botão com confirmação para as ações do Google abaixo da campanha (grupo, anúncio, palavra-chave, termo). */
export function BotaoGoogle({ campos, rotulo, confirmar, voltar, perigo = false }: {
  campos: Record<string, string>; rotulo: string; confirmar: string; voltar: string; perigo?: boolean;
}) {
  return (
    <form action={acaoGoogleDetalhe} onSubmit={(e) => { if (!confirm(confirmar)) e.preventDefault(); }}>
      {Object.entries({ ...campos, voltar }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button className={`whitespace-nowrap rounded-md border border-borda bg-superficie px-2 py-0.5 text-xs hover:border-destaque ${perigo ? "text-critico" : ""}`}>{rotulo}</button>
    </form>
  );
}
