"use client";

import { useState } from "react";
import { salvarFunilCliente } from "@/app/acoes";
import type { FunilCliente, PassoFunil } from "@/lib/funil";
import { BotaoEnviar } from "./botao";

type Funil = { id: string; nome: string; etapas: { id: string; nome: string; ordem: number }[] };

const campo = "rounded-lg border border-borda bg-fundo px-2 py-1.5 text-sm outline-none focus:border-destaque";
const botaoPequeno = "rounded border border-borda px-2 py-0.5 text-xs text-texto-2 hover:border-destaque disabled:opacity-40";

/** Monta o funil do relatório: passos com nome livre e as etapas do CRM que contam em cada um. */
export function EditorFunil({ clienteId, funis, inicial }: { clienteId: string; funis: Funil[]; inicial: FunilCliente }) {
  const [f, setF] = useState<FunilCliente>(inicial);
  const mudarPasso = (i: number, p: Partial<PassoFunil>) => setF({ ...f, passos: f.passos.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const mover = (i: number, d: -1 | 1) => {
    const passos = [...f.passos];
    [passos[i], passos[i + d]] = [passos[i + d], passos[i]];
    setF({ ...f, passos });
  };
  const alternarEtapa = (i: number, etapa: string) => {
    const atual = f.passos[i].etapas;
    mudarPasso(i, { etapas: atual.includes(etapa) ? atual.filter((e) => e !== etapa) : [...atual, etapa] });
  };

  return (
    <form action={salvarFunilCliente} className="space-y-4">
      <input type="hidden" name="cliente_id" value={clienteId} />
      <input type="hidden" name="funil" value={JSON.stringify(f)} />

      <p className="rounded-lg bg-fundo px-3 py-2 text-sm">
        {[f.leads, ...f.passos.map((p) => p.nome || "…"), f.vendas].join("  →  ")}
      </p>

      <fieldset className="space-y-1 text-sm">
        <legend className="mb-1 font-medium">Quais leads entram no relatório?</legend>
        <label className="flex items-center gap-2">
          <input type="radio" checked={f.soAnuncio} onChange={() => setF({ ...f, soAnuncio: true })} />
          Só os leads das <b>fontes de anúncio</b> (marcadas na seção 3)
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={!f.soAnuncio} onChange={() => setF({ ...f, soAnuncio: false })} />
          Todos os leads do CRM
        </label>
      </fieldset>

      {funis.length > 1 && (
        <fieldset className="space-y-1 text-sm">
          <legend className="mb-1 font-medium">Quais funis do CRM entram?</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {funis.map((fu) => (
              <label key={fu.id} className="flex items-center gap-1.5">
                <input type="checkbox" checked={!f.funis.length || f.funis.includes(fu.id)}
                  onChange={() => {
                    const atuais = f.funis.length ? f.funis : funis.map((x) => x.id);
                    const novos = atuais.includes(fu.id) ? atuais.filter((x) => x !== fu.id) : [...atuais, fu.id];
                    if (!novos.length) return; // pelo menos um funil
                    // todos marcados = sem filtro (funis novos do CRM entram sozinhos)
                    setF({ ...f, funis: novos.length === funis.length ? [] : novos });
                  }} />
                {fu.nome}
              </label>
            ))}
          </div>
          <p className="text-xs text-texto-3">Leads e vendas de funis desmarcados (pós-venda, reativação, listas…) ficam fora do relatório.</p>
        </fieldset>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Nome do primeiro passo (todos os leads)
          <input value={f.leads} onChange={(e) => setF({ ...f, leads: e.target.value })} className={campo} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Nome do último passo (negócios ganhos)
          <input value={f.vendas} onChange={(e) => setF({ ...f, vendas: e.target.value })} className={campo} />
        </label>
      </div>

      <div className="space-y-3">
        {f.passos.map((p, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-borda bg-fundo p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                Passo {i + 1}
                <input value={p.nome} onChange={(e) => mudarPasso(i, { nome: e.target.value })} placeholder="Ex.: Interessados, Propostas, Agendamentos" className={campo} />
              </label>
              <button type="button" className={botaoPequeno} disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir">↑</button>
              <button type="button" className={botaoPequeno} disabled={i === f.passos.length - 1} onClick={() => mover(i, 1)} aria-label="Descer">↓</button>
              <button type="button" className={`${botaoPequeno} hover:text-critico`} onClick={() => setF({ ...f, passos: f.passos.filter((_, j) => j !== i) })}>remover</button>
            </div>
            <p className="text-xs text-texto-3">
              Etapas do CRM que contam como “{p.nome || `passo ${i + 1}`}” ({p.etapas.length} marcada{p.etapas.length === 1 ? "" : "s"}):
            </p>
            {funis.map((fu) => (
              <div key={fu.id} className="text-sm">
                {funis.length > 1 && <div className="text-xs font-medium text-texto-2">Funil: {fu.nome}</div>}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {fu.etapas.map((e) => (
                    <label key={e.id} className="flex items-center gap-1.5">
                      <input type="checkbox" checked={p.etapas.includes(e.id)} onChange={() => alternarEtapa(i, e.id)} />
                      {e.nome}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
        <button type="button" onClick={() => setF({ ...f, passos: [...f.passos, { nome: "", etapas: [] }] })}
          className="rounded-lg border border-dashed border-borda px-3 py-1.5 text-sm text-texto-2 hover:border-destaque hover:text-texto">
          + Adicionar passo
        </button>
      </div>

      <p className="text-xs text-texto-3">
        Um lead conta num passo se está numa das etapas marcadas <b>ou já avançou</b> para as etapas de um passo seguinte
        (quem está em “Proposta enviada” também conta como interessado). Negócios ganhos contam em todos os passos. Etapas
        não marcadas em nenhum passo (ex.: primeiro contato, manutenção) ficam fora do funil. Depois de salvar, clique em
        “Buscar e gravar” no histórico para recalcular os meses.
      </p>
      <BotaoEnviar className="rounded-lg bg-destaque px-3 py-1.5 text-sm font-medium text-white">Salvar funil</BotaoEnviar>
    </form>
  );
}
