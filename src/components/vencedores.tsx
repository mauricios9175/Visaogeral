"use client";

import { useEffect, useState } from "react";
import type { AnaliseVencedores, ItemComparado } from "@/lib/vencedores";

function Lista({ titulo, itens, cor }: { titulo: string; itens: string[]; cor: string }) {
  if (!itens.length) return null;
  return (
    <div className="space-y-1.5">
      <h3 className={`text-sm font-semibold ${cor}`}>{titulo}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm text-texto-2">{itens.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

function Grupo({ titulo, itens, prefixo, cor }: { titulo: string; itens: ItemComparado[]; prefixo: string; cor: string }) {
  return (
    <div className="space-y-2">
      <h3 className={`text-sm font-semibold ${cor}`}>{titulo}</h3>
      <ul className="space-y-1.5">
        {itens.map((x, i) => (
          <li key={x.id} className="flex items-center gap-2.5 rounded-lg border border-borda bg-fundo p-2">
            {x.miniatura
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={x.miniatura} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" loading="lazy" />
              : <span className="h-12 w-12 shrink-0 rounded-md bg-superficie-2" />}
            <div className="min-w-0 text-xs">
              <div className="truncate text-sm font-medium"><span className={cor}>{prefixo}{i + 1}</span> · {x.nome}</div>
              <div className="text-texto-3">{x.resumoNumeros}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Por que os vencedores ganham": comparação feita pela IA entre os melhores e os piores criativos do cliente. */
export function VencedoresIA({ clienteId, hoje }: { clienteId: string; hoje: string }) {
  const [analise, setAnalise] = useState<AnaliseVencedores | null | undefined>(undefined);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tarefas, setTarefas] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let vivo = true;
    fetch(`/api/criativos/vencedores?cliente=${clienteId}`).then((r) => r.json()).then((j) => vivo && setAnalise(j.analise ?? null)).catch(() => vivo && setAnalise(null));
    return () => { vivo = false; };
  }, [clienteId]);

  async function comparar() {
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch("/api/criativos/vencedores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clienteId }) });
      const j = await r.json().catch(() => ({ erro: `erro ${r.status}` }));
      if (j.erro) throw new Error(j.erro);
      setAnalise(j.analise);
      setTarefas({});
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  async function virarTarefa(i: number, t: { hipotese: string; como: string }) {
    setTarefas((x) => ({ ...x, [i]: true }));
    const r = await fetch("/api/tarefas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "criar", texto: `Testar criativo: ${t.hipotese}`.slice(0, 300), clienteId, data: hoje }),
    }).catch(() => null);
    if (!r?.ok) setTarefas((x) => ({ ...x, [i]: false }));
  }

  return (
    <section id="vencedores" className="space-y-4 rounded-2xl border border-borda bg-superficie p-4 lg:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-bold"><span aria-hidden className="text-destaque">✦</span> Por que os vencedores ganham</h2>
          <p className="text-xs text-texto-3">A IA compara os criativos que mais trazem resultado com os que mais gastam sem trazer (últimos 90 dias) e mostra o padrão.</p>
        </div>
        <button type="button" onClick={comparar} disabled={ocupado} className="min-h-10 rounded-[10px] bg-destaque px-4 text-sm font-semibold text-white disabled:opacity-60">
          {ocupado ? "Comparando…" : analise ? "Comparar de novo" : "Comparar agora"}
        </button>
      </div>
      {ocupado && <p className="text-sm text-texto-3">Juntando números, textos e miniaturas e pedindo a comparação à IA (leva uns 20 a 60 segundos)…</p>}
      {erro && <p className="text-sm text-critico">{erro}</p>}
      {analise === undefined && <p className="text-sm text-texto-3">Carregando…</p>}
      {analise && !ocupado && (
        <div className="space-y-5">
          <p className="rounded-xl bg-destaque-bg/40 p-3 text-sm leading-relaxed">{analise.resumo}</p>
          <div className="grid gap-4 lg:grid-cols-2">
            <Grupo titulo="★ Vencedores" itens={analise.vencedores} prefixo="V" cor="text-bom" />
            <Grupo titulo="■ Perdedores" itens={analise.perdedores} prefixo="P" cor="text-critico" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Lista titulo="O que os vencedores têm em comum" itens={analise.padroesVencedores} cor="text-bom" />
            <Lista titulo="O que os perdedores têm em comum" itens={analise.padroesPerdedores} cor="text-critico" />
          </div>
          <Lista titulo="O que separa um grupo do outro" itens={analise.diferencas} cor="text-texto" />
          <Lista titulo="→ Receita do próximo criativo" itens={analise.receita} cor="text-destaque" />
          {analise.testes.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Testes sugeridos</h3>
              <ul className="space-y-2">
                {analise.testes.map((t, i) => (
                  <li key={i} className="flex flex-wrap items-start gap-3 rounded-lg border border-borda p-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{t.hipotese}</div>
                      <div className="text-texto-2">{t.como}</div>
                    </div>
                    <button type="button" disabled={tarefas[i]} onClick={() => virarTarefa(i, t)} className="shrink-0 rounded-lg border border-borda px-3 py-1.5 text-xs hover:border-destaque disabled:opacity-60">
                      {tarefas[i] ? "✓ Virou tarefa" : "+ Tarefa"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {analise.ressalvas && <p className="text-xs text-texto-3">Ressalvas: {analise.ressalvas}</p>}
          <p className="text-[11px] text-texto-3">
            Critério de vencedor: {analise.criterio} · {analise.periodo} · feito em {new Date(analise.criadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.
            {analise.semAnalise > 0 && <> {analise.semAnalise} dos comparados ainda não têm a análise individual (com o vídeo assistido): analisar esses antes deixa a comparação mais precisa.</>}
          </p>
        </div>
      )}
      {analise === null && !ocupado && !erro && <p className="text-sm text-texto-3">Ainda não comparado. Precisa de pelo menos 4 criativos com investimento nos últimos 90 dias.</p>}
    </section>
  );
}
