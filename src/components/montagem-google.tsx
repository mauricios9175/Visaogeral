"use client";

import { useActionState, useState } from "react";
import { montarCampanhaGoogle, type ImagemPmax, type ResultadoGoogle } from "@/app/acoes-montagem-google";
import { ImagensPmax } from "./imagens-pmax";
import { CONFIG_GOOGLE_PADRAO, normalizarGoogle, problemasDoAnuncio, type ConfigGoogle } from "@/lib/modelos-google";
import { campo } from "./campos-meta";
import { CamposGoogle } from "./campos-google";
import { EsbocoIA } from "./esboco-ia";

type Opcao = { id: string; nome: string };

/** Montagem de campanha de Pesquisa no Google: modelo (ou do zero / IA) → revisar → criar pausada. */
export function MontagemGoogle({ clienteId, contas, modelos, pedidoInicial }: {
  clienteId: string; contas: Opcao[]; modelos: (Opcao & { config: ConfigGoogle })[]; pedidoInicial?: string;
}) {
  const [conta, setConta] = useState(contas[0]?.id ?? "");
  const [modeloId, setModeloId] = useState(pedidoInicial ? "zero" : modelos[0]?.id ?? "zero");
  const [config, setConfig] = useState<ConfigGoogle>(() => normalizarGoogle(pedidoInicial ? CONFIG_GOOGLE_PADRAO : modelos[0]?.config ?? CONFIG_GOOGLE_PADRAO));
  const [salvarModeloComo, setSalvarModeloComo] = useState("");
  const [imagens, setImagens] = useState<ImagemPmax[]>([]);
  const [resultado, enviar, montando] = useActionState<ResultadoGoogle | null, FormData>(montarCampanhaGoogle, null);

  function trocarModelo(id: string) {
    setModeloId(id);
    const m = modelos.find((x) => x.id === id);
    // mantém os locais já escolhidos para o cliente
    setConfig((atual) => normalizarGoogle({ ...(m?.config ?? CONFIG_GOOGLE_PADRAO), locais: atual.locais.length ? atual.locais : m?.config.locais ?? [] }));
  }

  const pmax = config.tipo === "pmax";
  const faltando = !conta ? "Escolha a conta do Google." : problemasDoAnuncio(config)
    ?? (!config.locais.length ? "Escolha pelo menos um local." : null)
    ?? (pmax && !imagens.some((i) => i.tipo === "logo") ? "Escolha o logo." : null)
    ?? (pmax && !imagens.some((i) => i.tipo === "paisagem") ? "Escolha pelo menos uma imagem paisagem." : null)
    ?? (pmax && !imagens.some((i) => i.tipo === "quadrada") ? "Escolha pelo menos uma imagem quadrada." : null);
  return (
    <div className="space-y-6">
      <EsbocoIA plataforma="google" clienteId={clienteId} pedidoInicial={pedidoInicial} onPronto={(e) => {
        setModeloId("zero");
        setConfig((atual) => normalizarGoogle({ ...e.config, url: e.config.url || atual.url, locais: atual.locais }));
      }} />

      <section className="grid gap-3 rounded-2xl border border-borda bg-superficie p-4 md:grid-cols-2">
        <label className="block space-y-1 text-sm">Modelo
          <select value={modeloId} onChange={(e) => trocarModelo(e.target.value)} className={campo}>
            <option value="zero">✚ Do zero</option>
            {modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </label>
        <label className="block space-y-1 text-sm">Conta do Google Ads
          <select value={conta} onChange={(e) => setConta(e.target.value)} className={campo}>
            {contas.map((c) => <option key={c.id} value={c.id}>{c.nome} ({c.id.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3")})</option>)}
          </select>
        </label>
      </section>

      <CamposGoogle valor={config} onChange={setConfig} conta={conta} imagens={<ImagensPmax valor={imagens} onChange={setImagens} />} />

      <form action={enviar} className="space-y-3 rounded-2xl border border-borda bg-superficie p-4">
        <input type="hidden" name="payload" value={JSON.stringify({ clienteId, conta, config, salvarModeloComo, imagens: pmax ? imagens : [] })} />
        <label className="block space-y-1 text-sm">Salvar esta configuração também como modelo <span className="text-xs text-texto-3">(opcional)</span>
          <input value={salvarModeloComo} onChange={(e) => setSalvarModeloComo(e.target.value)} placeholder="Nome do modelo" className={campo} />
        </label>
        {faltando && <p className="text-sm text-atencao">{faltando}</p>}
        <button disabled={!!faltando || montando} className="min-h-11 rounded-[10px] bg-destaque px-5 text-sm font-semibold text-white disabled:opacity-50">
          {montando ? "Criando no Google…" : `Criar ${pmax ? "Performance Max" : "campanha de Pesquisa"} no Google (pausada)`}
        </button>
        {resultado && (
          <div className={`space-y-1 rounded-xl border p-4 text-sm ${resultado.ok ? "border-bom bg-bom-bg" : "border-critico bg-critico-bg"}`}>
            <p>{resultado.mensagem}</p>
            {resultado.link && <a href={resultado.link} target="_blank" rel="noreferrer" className="font-semibold underline">Abrir no Google Ads →</a>}
          </div>
        )}
      </form>
    </div>
  );
}
