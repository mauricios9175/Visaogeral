"use client";

import { useState } from "react";

/** Mensagem editável com botões de copiar e abrir no WhatsApp. */
export function Mensagem({ textoInicial }: { textoInicial: string }) {
  const [texto, setTexto] = useState(textoInicial);
  const [copiado, setCopiado] = useState(false);
  const botao = "rounded-lg border border-borda bg-superficie px-3 py-1.5 text-sm hover:border-destaque";

  async function copiar() {
    await navigator.clipboard.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className="space-y-2">
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={Math.min(Math.max(texto.split("\n").length + 1, 10), 28)}
        className="w-full rounded-lg border border-borda bg-fundo p-3 font-mono text-[13px] leading-relaxed outline-none focus:border-destaque"
      />
      <div className="flex flex-wrap gap-2">
        <button onClick={copiar} className={`${botao} ${copiado ? "border-bom text-bom" : ""}`}>
          {copiado ? "✓ Copiado" : "Copiar mensagem"}
        </button>
        <a href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer" className={botao}>
          Abrir no WhatsApp
        </a>
        {texto !== textoInicial && (
          <button onClick={() => setTexto(textoInicial)} className={`${botao} text-texto-3`}>Desfazer edições</button>
        )}
      </div>
    </div>
  );
}
