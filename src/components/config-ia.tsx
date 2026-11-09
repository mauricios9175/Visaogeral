"use client";

import { useState } from "react";
import { salvarConfigIA } from "@/app/acoes-ia";

type Item = { provedor: string; nome: string; variavel: string; modeloPadrao: string; video: boolean; busca: boolean; temChave: boolean; ligado: boolean; modelo: string };

/** Provedores de IA: ordem de tentativa (se o 1º der limite ou erro, vai para o próximo), ligar/desligar e modelo. */
export function ConfigIA({ itens: iniciais }: { itens: Item[] }) {
  const [itens, setItens] = useState(iniciais);
  const mover = (i: number, d: number) => setItens((l) => {
    const n = [...l];
    const [x] = n.splice(i, 1);
    n.splice(Math.max(0, Math.min(n.length, i + d)), 0, x);
    return n;
  });
  return (
    <form action={salvarConfigIA} className="space-y-3">
      <input type="hidden" name="ordem" value={itens.map((x) => x.provedor).join(",")} />
      <ol className="space-y-2">
        {itens.map((x, i) => (
          <li key={x.provedor} className="flex flex-wrap items-center gap-3 rounded-xl border border-borda bg-fundo p-3">
            <div className="flex flex-col">
              <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} className="text-xs text-texto-3 hover:text-texto disabled:opacity-30" aria-label={`Subir ${x.nome}`}>▲</button>
              <button type="button" onClick={() => mover(i, 1)} disabled={i === itens.length - 1} className="text-xs text-texto-3 hover:text-texto disabled:opacity-30" aria-label={`Descer ${x.nome}`}>▼</button>
            </div>
            <span className="w-5 text-center text-sm font-bold text-texto-3">{i + 1}º</span>
            <div className="min-w-48 flex-1">
              <div className="font-semibold">{x.nome}</div>
              <div className="text-xs text-texto-3">
                {x.temChave ? <span className="text-bom">● chave configurada</span> : <span className="text-atencao">○ falta a chave: crie {x.variavel} na Vercel</span>}
                {" · "}{[x.video && "assiste vídeo", x.busca && "pesquisa na internet", "imagem e texto"].filter(Boolean).join(", ")}
              </div>
            </div>
            <label className="text-xs text-texto-2">Modelo
              <input name={`modelo_${x.provedor}`} defaultValue={x.modelo} placeholder={x.modeloPadrao}
                className="mt-0.5 block w-48 rounded-lg border border-borda bg-superficie px-2 py-1.5 font-mono text-xs" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={`ligado_${x.provedor}`} defaultChecked={x.ligado} /> Ligado
            </label>
          </li>
        ))}
      </ol>
      <button className="min-h-10 rounded-[10px] bg-destaque px-4 text-sm font-semibold text-white">Salvar</button>
    </form>
  );
}
