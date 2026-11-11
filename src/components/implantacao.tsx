"use client";

import Link from "next/link";
import { useState } from "react";
import type { ItemImplantacao } from "@/lib/implantacao";

type Checklist = { itens: ItemImplantacao[]; feitos: number; total: number };

async function chamar(corpo: object): Promise<Checklist> {
  const r = await fetch("/api/implantacao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({ erro: `erro ${r.status}` }));
  if (!r.ok || j.erro) throw new Error(j.erro ?? `erro ${r.status}`);
  return j.checklist;
}

/** Checklist de implantação: os automáticos o painel confere; os manuais você marca. */
export function ChecklistImplantacao({ clienteId, inicial, modelo }: { clienteId: string; inicial: Checklist; modelo: string[] }) {
  const [ck, setCk] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [textoModelo, setTextoModelo] = useState(modelo.join("\n"));

  async function enviar(corpo: object) {
    setErro(null);
    try { setCk(await chamar(corpo)); } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }
  const pct = ck.total ? Math.round((ck.feitos / ck.total) * 100) : 0;

  return (
    <section className="space-y-3 rounded-2xl border border-borda bg-superficie p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-bold">Checklist de implantação</h2>
        <span className="text-xs text-texto-3">{ck.feitos} de {ck.total}</span>
        <div className="h-1.5 min-w-24 flex-1 rounded-full bg-fundo"><div className={`h-full rounded-full ${pct === 100 ? "bg-bom" : "bg-destaque"}`} style={{ width: `${pct}%` }} /></div>
      </div>
      <ul className="space-y-1">
        {ck.itens.map((it) => (
          <li key={it.id} className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm ${it.ignorado ? "opacity-45" : ""}`}>
            {it.auto ? (
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${it.ok ? "bg-bom text-white" : "border-2 border-borda"}`} title="Conferido pelo painel">{it.ok ? "✓" : ""}</span>
            ) : (
              <button type="button" disabled={it.ignorado} onClick={() => enviar({ op: "marcar", clienteId, id: it.id, feito: !it.ok })} aria-label={it.ok ? "Desmarcar" : "Marcar"}
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${it.ok ? "bg-bom text-white" : "border-2 border-borda hover:border-bom"}`}>{it.ok ? "✓" : ""}</button>
            )}
            <div className="min-w-0 flex-1">
              <span className={it.ignorado ? "line-through" : ""}>{it.texto}</span>
              {it.auto && <span className="ml-1.5 rounded bg-superficie-2 px-1 py-px text-[10px] text-texto-3">automático</span>}
              {(it.detalhe || it.feitoEm) && <div className="text-xs text-texto-3">{it.detalhe ?? `marcado em ${it.feitoEm!.split("-").reverse().join("/")}`}</div>}
            </div>
            {!it.ok && !it.ignorado && it.link && <Link href={it.link} className="shrink-0 text-xs text-destaque underline">resolver</Link>}
            <button type="button" onClick={() => enviar({ op: "marcar", clienteId, id: it.id, ignorado: !it.ignorado })} className="shrink-0 text-xs text-texto-3 hover:text-texto">
              {it.ignorado ? "volta" : "não se aplica"}
            </button>
          </li>
        ))}
      </ul>
      {erro && <p className="text-sm text-critico">{erro}</p>}
      {editando ? (
        <div className="space-y-2">
          <p className="text-xs text-texto-3">Itens que você marca à mão, um por linha. Valem para todos os clientes.</p>
          <textarea value={textoModelo} onChange={(e) => setTextoModelo(e.target.value)} rows={7} className="w-full rounded-lg border border-borda bg-fundo px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <button type="button" onClick={async () => { await enviar({ op: "modelo", clienteId, itens: textoModelo.split("\n") }); setEditando(false); }} className="rounded-lg bg-destaque px-3 py-1.5 text-sm font-semibold text-white">Salvar itens</button>
            <button type="button" onClick={() => setEditando(false)} className="rounded-lg border border-borda px-3 py-1.5 text-sm">Cancelar</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setEditando(true)} className="text-xs text-texto-3 underline hover:text-texto">Editar os itens manuais</button>
      )}
    </section>
  );
}
