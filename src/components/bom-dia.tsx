"use client";

import { useState } from "react";

/** Configuração do "bom dia" no celular: ligar/desligar, horário e um botão para ver como chega. */
export function ConfigBomDia({ inicial }: { inicial: { ligado: boolean; hora: number } }) {
  const [c, setC] = useState(inicial);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function salvar(novo: { ligado: boolean; hora: number }) {
    setC(novo);
    const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bomDia: novo }) })
      .then((x) => x.json()).catch(() => ({ erro: "falha" }));
    setMsg(r.erro ? `Erro: ${r.erro}` : "Salvo.");
  }
  async function testar() {
    setOcupado(true);
    const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bomDiaTeste: true }) })
      .then((x) => x.json()).catch(() => ({ erro: "falha" }));
    setMsg(r.erro ? `Erro: ${r.erro}` : `Bom dia enviado para ${r.enviados ?? 0} aparelho(s).`);
    setOcupado(false);
  }

  return (
    <div className="space-y-2 rounded-xl border border-borda bg-fundo p-3 text-sm">
      <div className="font-semibold">☀️ Bom dia no celular</div>
      <p className="text-xs text-texto-3">Uma notificação por dia com as reuniões, tarefas, contas com saldo/problema e os clientes que pedem atenção.</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={c.ligado} onChange={(e) => salvar({ ...c, ligado: e.target.checked })} /> Ligado
        </label>
        <label className="flex items-center gap-2">
          a partir das
          <select value={c.hora} onChange={(e) => salvar({ ...c, hora: Number(e.target.value) })} className="rounded-lg border border-borda bg-superficie px-2 py-1">
            {[5, 6, 7, 8, 9, 10, 11, 12].map((h) => <option key={h} value={h}>{h}h</option>)}
          </select>
        </label>
        <button type="button" onClick={testar} disabled={ocupado} className="rounded-lg border border-borda px-3 py-1.5 hover:border-destaque disabled:opacity-60">
          {ocupado ? "Enviando…" : "Ver o de hoje agora"}
        </button>
      </div>
      <p className="text-xs text-texto-3">
        Chega na primeira verificação depois do horário escolhido (até as 13h). Como o agendador do GitHub às vezes atrasa, pode chegar um pouco depois.
      </p>
      {msg && <p className="text-xs text-texto-2">{msg}</p>}
    </div>
  );
}
