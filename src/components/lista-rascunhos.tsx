"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type ResumoRascunho = { id: string; titulo: string; origem: string; atualizadoEm: string; onde: string; anuncios: number; conjuntos: number };

/** Rascunhos de campanha do cliente: continuar editando ou excluir. */
export function ListaRascunhos({ clienteId, itens }: { clienteId: string; itens: ResumoRascunho[] }) {
  const router = useRouter();
  const [excluindo, setExcluindo] = useState<string | null>(null);
  if (!itens.length) return null;
  async function excluir(r: ResumoRascunho) {
    if (!confirm(`Excluir o rascunho “${r.titulo}”? Nada no Meta é afetado.`)) return;
    setExcluindo(r.id);
    await fetch("/api/rascunhos", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clienteId, id: r.id }) }).catch(() => null);
    setExcluindo(null);
    router.refresh();
  }
  return (
    <section className="rounded-2xl border border-atencao/40 bg-superficie">
      <h2 className="flex items-center gap-2 px-4 pt-3 text-sm font-bold">
        <span className="rounded-full bg-atencao-bg px-2 py-0.5 text-[11px] uppercase tracking-wide text-atencao">Rascunhos</span>
        {itens.length} não publicado(s)
      </h2>
      <ul className="divide-y divide-borda text-sm">
        {itens.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{r.titulo}</div>
              <div className="truncate text-xs text-texto-3">
                {r.origem} · {r.onde} · {r.conjuntos ? `${r.conjuntos} conjunto(s) · ` : ""}{r.anuncios} anúncio(s) · editado {new Date(r.atualizadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
            <Link href={`/clientes/${clienteId}/montar?rascunho=${r.id}`} className="rounded-lg bg-destaque px-3 py-1.5 text-xs font-semibold text-white">Continuar</Link>
            <button type="button" onClick={() => excluir(r)} disabled={excluindo === r.id} className="text-xs text-texto-3 hover:text-critico disabled:opacity-50">Excluir</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
