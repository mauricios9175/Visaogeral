"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { publicarRascunho } from "@/app/acoes-rascunhos";

export type ResumoRascunho = { id: string; titulo: string; origem: string; atualizadoEm: string; onde: string; anuncios: number; conjuntos: number };

type Estado = { tipo: "publicando" } | { tipo: "ok"; mensagem: string; link: string | null } | { tipo: "erro"; mensagem: string; detalhes: string[] };

/** Rascunhos de campanha do cliente: editar, publicar um, publicar todos ou excluir. */
export function ListaRascunhos({ clienteId, itens }: { clienteId: string; itens: ResumoRascunho[] }) {
  const router = useRouter();
  const [estados, setEstados] = useState<Record<string, Estado>>({});
  const [ocupado, setOcupado] = useState(false);
  if (!itens.length && !Object.keys(estados).length) return null;

  async function publicar(r: ResumoRascunho) {
    setEstados((e) => ({ ...e, [r.id]: { tipo: "publicando" } }));
    try {
      const res = await publicarRascunho(clienteId, r.id);
      setEstados((e) => ({ ...e, [r.id]: res.ok ? { tipo: "ok", mensagem: res.mensagem, link: res.link } : { tipo: "erro", mensagem: res.mensagem, detalhes: res.detalhes } }));
      return res.ok;
    } catch (err) {
      setEstados((e) => ({ ...e, [r.id]: { tipo: "erro", mensagem: err instanceof Error ? err.message : String(err), detalhes: [] } }));
      return false;
    }
  }

  async function publicarUm(r: ResumoRascunho) {
    if (!confirm(`Publicar “${r.titulo}” no Meta? Vai ${r.onde === "campanha nova" ? "criar a campanha" : `para ${r.onde}`}, tudo PAUSADO.`)) return;
    setOcupado(true);
    await publicar(r);
    setOcupado(false);
    router.refresh();
  }

  async function publicarTodos() {
    const pendentes = itens.filter((r) => estados[r.id]?.tipo !== "ok");
    if (!confirm(`Publicar os ${pendentes.length} rascunho(s) no Meta, um por um? Tudo nasce PAUSADO.`)) return;
    setOcupado(true);
    // um de cada vez: o Meta limita chamadas seguidas e assim dá para acompanhar
    for (const r of pendentes) await publicar(r);
    setOcupado(false);
    router.refresh();
  }

  async function excluir(r: ResumoRascunho) {
    if (!confirm(`Excluir o rascunho “${r.titulo}”? Nada no Meta é afetado.`)) return;
    await fetch("/api/rascunhos", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clienteId, id: r.id }) }).catch(() => null);
    router.refresh();
  }

  // publicados nesta tela continuam aparecendo (com o resultado) até recarregar
  const publicados = Object.entries(estados).filter(([id, e]) => e.tipo === "ok" && !itens.some((r) => r.id === id));
  return (
    <section className="rounded-2xl border border-atencao/40 bg-superficie">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <span className="rounded-full bg-atencao-bg px-2 py-0.5 text-[11px] uppercase tracking-wide text-atencao">Rascunhos</span>
          {itens.length} não publicado(s)
        </h2>
        {itens.length > 1 && (
          <button type="button" onClick={publicarTodos} disabled={ocupado} className="ml-auto rounded-lg bg-destaque px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
            {ocupado ? "Publicando…" : `Publicar todos (${itens.length})`}
          </button>
        )}
      </div>
      <ul className="divide-y divide-borda text-sm">
        {itens.map((r) => {
          const e = estados[r.id];
          return (
            <li key={r.id} className="space-y-1 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{r.titulo}</div>
                  <div className="truncate text-xs text-texto-3">
                    {r.origem} · {r.onde} · {r.conjuntos ? `${r.conjuntos} conjunto(s) · ` : ""}{r.anuncios} anúncio(s) · editado {new Date(r.atualizadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <Link href={`/clientes/${clienteId}/montar?rascunho=${r.id}`} className="rounded-lg border border-borda px-3 py-1.5 text-xs font-semibold hover:border-destaque">Editar</Link>
                <button type="button" onClick={() => publicarUm(r)} disabled={ocupado} className="rounded-lg bg-destaque px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                  {e?.tipo === "publicando" ? "Publicando…" : "Publicar"}
                </button>
                <button type="button" onClick={() => excluir(r)} disabled={ocupado} className="text-xs text-texto-3 hover:text-critico disabled:opacity-50">Excluir</button>
              </div>
              {e?.tipo === "erro" && (
                <div className="rounded-lg bg-critico-bg px-3 py-2 text-xs text-critico">
                  {e.mensagem}{e.detalhes.map((d, i) => <div key={i}>{d}</div>)}
                </div>
              )}
            </li>
          );
        })}
        {publicados.map(([id, e]) => e.tipo === "ok" && (
          <li key={id} className="px-4 py-2.5 text-xs text-bom">
            ✓ {e.mensagem} {e.link && <a href={e.link} target="_blank" rel="noreferrer" className="underline">Abrir no Gerenciador ↗</a>}
          </li>
        ))}
      </ul>
    </section>
  );
}
