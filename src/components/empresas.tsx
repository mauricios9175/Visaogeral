"use client";

import { useState } from "react";
import type { ConfigEmpresa, LayoutRelatorio } from "@/lib/empresas";

type Empresa = ConfigEmpresa & { clientes: number; ativos: number };
type Layout = { chave: string; nome: string; descricao: string };

const link = (id: string) => `https://docs.google.com/presentation/d/${id}/edit`;

/** Miniatura do relatório nas cores escolhidas (capa + um cartão do resumo + barras). */
function Previa({ e }: { e: Pick<ConfigEmpresa, "primaria" | "destaque" | "fonte" | "nome"> }) {
  const p = `#${e.primaria}`, d = `#${e.destaque}`;
  return (
    <div className="flex gap-2" style={{ fontFamily: `"${e.fonte}", sans-serif` }} aria-hidden>
      <div className="flex h-[72px] w-[128px] flex-col justify-center rounded-md px-2.5 text-white" style={{ background: p, borderBottom: `5px solid ${d}` }}>
        <span className="text-[7px] font-bold uppercase" style={{ color: d }}>Relatório mensal</span>
        <span className="truncate text-[12px] font-bold">Cliente</span>
        <span className="text-[8px] opacity-80">Outubro/2026</span>
      </div>
      <div className="flex h-[72px] w-[128px] flex-col justify-between rounded-md border border-borda bg-white p-2">
        <span className="text-[8px] font-bold" style={{ color: p }}>Resumo do período</span>
        <div className="flex items-end gap-1">
          {[40, 60, 35, 75, 55].map((h, i) => <span key={i} className="w-3 rounded-sm" style={{ height: h * 0.4, background: i % 2 ? d : p }} />)}
        </div>
      </div>
    </div>
  );
}

function CartaoEmpresa({ e, layouts, fontes, aoSalvar }: { e: Empresa; layouts: Layout[]; fontes: string[]; aoSalvar: (lista: Empresa[]) => void }) {
  const [f, setF] = useState(e);
  const [estado, setEstado] = useState<string | null>(null);
  const mudou = JSON.stringify([f.nome, f.layout, f.relatorioMensal, f.primaria, f.destaque, f.fonte]) !== JSON.stringify([e.nome, e.layout, e.relatorioMensal, e.primaria, e.destaque, e.fonte]);

  async function salvar() {
    if (f.nome.trim() !== e.nome && e.clientes > 0 && !confirm(`Renomear “${e.nome}” para “${f.nome.trim()}” em ${e.clientes} cliente(s)?`)) return;
    if (f.layout !== e.layout && e.modeloId && !confirm("Trocar o layout cria um modelo novo no Drive no próximo relatório (o atual continua lá, mas deixa de ser usado). Continuar?")) return;
    setEstado("Salvando…");
    try {
      const r = await fetch("/api/empresas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nomeAtual: e.nome, empresa: f }) });
      const j = await r.json().catch(() => ({ erro: `erro ${r.status}` }));
      if (!r.ok || j.erro) throw new Error(j.erro ?? `erro ${r.status}`);
      aoSalvar(j.empresas);
      setEstado("Salvo ✓" + (e.modeloId && (f.primaria !== e.primaria || f.destaque !== e.destaque || f.fonte !== e.fonte) ? " O modelo no Drive é repintado no próximo relatório." : ""));
    } catch (err) {
      setEstado(`Não salvou: ${err instanceof Error ? err.message : err}`);
    }
  }

  const campo = "min-h-10 w-full rounded-lg border border-borda bg-fundo px-3 text-sm";
  return (
    <section className="space-y-4 rounded-2xl border border-borda bg-superficie p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <input value={f.nome} onChange={(x) => setF({ ...f, nome: x.target.value })} aria-label="Nome da empresa"
            className="w-full max-w-sm rounded-lg border border-transparent bg-transparent px-1 text-lg font-bold hover:border-borda focus:border-destaque focus:outline-none" />
          <p className="px-1 text-xs text-texto-3">{e.ativos} cliente(s) ativo(s){e.clientes > e.ativos ? ` · ${e.clientes - e.ativos} inativo(s)` : ""}</p>
        </div>
        <Previa e={f} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 md:col-span-2"><span className="text-xs text-texto-3">Layout do relatório</span>
          <select value={f.layout} onChange={(x) => setF({ ...f, layout: x.target.value as LayoutRelatorio })} className={campo}>
            {layouts.map((l) => <option key={l.chave} value={l.chave}>{l.nome}</option>)}
          </select>
          <span className="block text-xs text-texto-3">{layouts.find((l) => l.chave === f.layout)?.descricao}</span>
        </label>
        <label className="space-y-1"><span className="text-xs text-texto-3">Cor principal</span>
          <span className="flex items-center gap-2">
            <input type="color" value={`#${f.primaria}`} onChange={(x) => setF({ ...f, primaria: x.target.value.slice(1).toUpperCase() })} className="h-10 w-14 cursor-pointer rounded border border-borda bg-fundo" />
            <code className="text-xs text-texto-3">#{f.primaria}</code>
          </span></label>
        <label className="space-y-1"><span className="text-xs text-texto-3">Cor de destaque</span>
          <span className="flex items-center gap-2">
            <input type="color" value={`#${f.destaque}`} onChange={(x) => setF({ ...f, destaque: x.target.value.slice(1).toUpperCase() })} className="h-10 w-14 cursor-pointer rounded border border-borda bg-fundo" />
            <code className="text-xs text-texto-3">#{f.destaque}</code>
          </span></label>
        <label className="space-y-1"><span className="text-xs text-texto-3">Fonte</span>
          <select value={f.fonte} onChange={(x) => setF({ ...f, fonte: x.target.value })} className={campo}>
            {fontes.map((n) => <option key={n} value={n}>{n}</option>)}
          </select></label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={f.relatorioMensal} onChange={(x) => setF({ ...f, relatorioMensal: x.target.checked })} />
          Recebe relatório todo mês <span className="text-xs text-texto-3">(lembrete nas tarefas e no checklist)</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" onClick={salvar} disabled={!mudou} className="rounded-[10px] bg-destaque px-4 py-2 font-semibold text-white disabled:opacity-40">Salvar</button>
        {e.modeloId
          ? <a href={link(e.modeloId)} target="_blank" rel="noopener noreferrer" className="text-destaque underline">Editar o modelo no Google Slides ↗</a>
          : <span className="text-xs text-texto-3">O modelo vai para o seu Drive no primeiro relatório desta empresa, já nestas cores.</span>}
        {estado && <span className="text-xs text-texto-2">{estado}</span>}
      </div>
    </section>
  );
}

export function EditorEmpresas({ inicial, layouts, fontes }: { inicial: Empresa[]; layouts: Layout[]; fontes: string[] }) {
  const [empresas, setEmpresas] = useState(inicial);
  const [versao, setVersao] = useState(0);
  const atualizar = (lista: Empresa[]) => { setEmpresas(lista); setVersao((v) => v + 1); };
  return (
    <div className="space-y-4">
      {empresas.map((e) => <CartaoEmpresa key={`${e.nome}-${versao}`} e={e} layouts={layouts} fontes={fontes} aoSalvar={atualizar} />)}
      <p className="text-xs text-texto-3">
        Empresa nova: é só digitar o nome dela no cadastro do cliente (Configurações → Clientes) que ela aparece aqui.
        Logo, imagens e ajustes finos de design: abra o modelo no Google Slides e edite à vontade (só não apague os textos entre {"{{ }}"}).
      </p>
    </div>
  );
}
