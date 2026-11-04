"use client";

import { useState } from "react";
import { salvarModelo } from "@/app/acoes-modelos";
import { normalizarConfig, OBJETIVOS, type Modelo, type ObjetivoMeta } from "@/lib/modelos";
import { BotaoEnviar } from "./botao";
import { CamposMeta, campo } from "./campos-meta";
import { EsbocoIA } from "./esboco-ia";

/** Formulário para criar ou editar um modelo de campanha do Meta. */
export function EditorModelo({ modelo }: { modelo?: Modelo }) {
  const [objetivo, setObjetivo] = useState<ObjetivoMeta>(modelo?.objetivo ?? "formulario");
  const [config, setConfig] = useState(normalizarConfig(modelo?.config));
  const [nome, setNome] = useState(modelo?.nome ?? "");
  return (
    <div className="space-y-3">
    {!modelo && (
      <EsbocoIA modelo onPronto={(e) => {
        setObjetivo(e.objetivo);
        setConfig(normalizarConfig(e.config));
        if (e.nome) setNome((n) => n || e.nome);
      }} />
    )}
    <form action={salvarModelo} className="space-y-5 rounded-2xl border border-borda bg-superficie p-4">
      <input type="hidden" name="id" value={modelo?.id ?? ""} />
      <input type="hidden" name="config" value={JSON.stringify(config)} />
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block space-y-1 text-sm">Nome do modelo
          <input name="nome" required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Planejados – Formulário" className={campo} />
        </label>
        <label className="block space-y-1 text-sm">Objetivo
          <select name="objetivo" value={objetivo} onChange={(e) => setObjetivo(e.target.value as ObjetivoMeta)} className={campo}>
            {(Object.keys(OBJETIVOS) as ObjetivoMeta[]).map((o) => <option key={o} value={o}>{OBJETIVOS[o].rotulo}</option>)}
          </select>
          <span className="block text-xs text-texto-3">{OBJETIVOS[objetivo].descricao}</span>
        </label>
      </div>
      <CamposMeta objetivo={objetivo} valor={config} onChange={setConfig} />
      <BotaoEnviar className="rounded-lg bg-destaque px-4 py-2 text-sm font-medium text-white" aguardando="Salvando…">
        Salvar modelo
      </BotaoEnviar>
    </form>
    </div>
  );
}
