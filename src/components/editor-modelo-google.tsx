"use client";

import { useState } from "react";
import { salvarModeloGoogle } from "@/app/acoes-modelos";
import { normalizarGoogle, type ConfigGoogle } from "@/lib/modelos-google";
import { BotaoEnviar } from "./botao";
import { campo } from "./campos-meta";
import { CamposGoogle } from "./campos-google";
import { EsbocoIA } from "./esboco-ia";

/** Criar ou editar um modelo de campanha de Pesquisa do Google (com o atalho de criar pela IA, falando ou escrevendo). */
export function EditorModeloGoogle({ modelo }: { modelo?: { id: string; nome: string; config: ConfigGoogle } }) {
  const [config, setConfig] = useState(normalizarGoogle(modelo?.config));
  const [nome, setNome] = useState(modelo?.nome ?? "");
  return (
    <div className="space-y-3">
      {!modelo && (
        <EsbocoIA plataforma="google" modelo onPronto={(e) => {
          setConfig(normalizarGoogle(e.config));
          if (e.nome) setNome((n) => n || e.nome);
        }} />
      )}
      <form action={salvarModeloGoogle} className="space-y-5 rounded-2xl border border-borda bg-superficie p-4">
        <input type="hidden" name="id" value={modelo?.id ?? ""} />
        <input type="hidden" name="config" value={JSON.stringify(config)} />
        <label className="block space-y-1 text-sm">Nome do modelo
          <input name="nome" required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Celulares – Pesquisa" className={campo} />
        </label>
        <CamposGoogle valor={config} onChange={setConfig} />
        <BotaoEnviar className="rounded-lg bg-destaque px-4 py-2 text-sm font-medium text-white" aguardando="Salvando…">
          Salvar modelo
        </BotaoEnviar>
      </form>
    </div>
  );
}
