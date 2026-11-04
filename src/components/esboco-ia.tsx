"use client";

import { useEffect, useRef, useState } from "react";
import type { ConfigMeta, ObjetivoMeta } from "@/lib/modelos";
import type { ConfigGoogle } from "@/lib/modelos-google";
import { BotaoMicrofone, useMicrofone } from "./analise-ia";

export type EsbocoMeta = { objetivo: ObjetivoMeta; config: ConfigMeta; naoEncontrados: string[]; observacoes: string; nome: string };
export type EsbocoGoogle = { config: ConfigGoogle; nome: string; observacoes: string; cortados: number };

type Props = {
  /** sem cliente = modelo (vale para qualquer cliente) */
  clienteId?: string;
  conta?: string;
  pedidoInicial?: string;
  modelo?: boolean;
} & ({ plataforma?: "meta"; onPronto: (e: EsbocoMeta) => void } | { plataforma: "google"; onPronto: (e: EsbocoGoogle) => void });

const EXEMPLOS = {
  meta: "ex.: campanha de WhatsApp para loja de celulares, foco em iPhone seminovo, R$ 40 por dia",
  google: "ex.: pesquisa para loja de celulares em Curitiba, foco em iPhone usado e conserto",
};

/**
 * "Esboço com IA": a pessoa descreve (por escrito ou falando) e a IA preenche a campanha ou o modelo.
 * Meta: objetivo, públicos (interesses conferidos no Meta) e textos. Google: grupos, palavras-chave, negativas e anúncio.
 * Nada é publicado: só preenche a tela para revisar.
 */
export function EsbocoIA(p: Props) {
  const plataforma = p.plataforma ?? "meta";
  const [pedido, setPedido] = useState(p.pedidoInicial ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resumo, setResumo] = useState<string[] | null>(null);
  const { ouvindo, falar, parar } = useMicrofone(setPedido, setErro);
  const automatico = useRef(false);

  async function esbocar(texto = pedido) {
    if (!texto.trim()) return setErro(`Descreva a campanha, ${EXEMPLOS[plataforma]}.`);
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch("/api/esboco", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plataforma, clienteId: p.clienteId ?? null, pedido: texto, contaId: p.conta || null }),
      });
      const j = await r.json().catch(() => ({ erro: `erro ${r.status}` }));
      if (j.erro) throw new Error(j.erro);
      if (p.plataforma === "google") {
        const e = j as EsbocoGoogle;
        p.onPronto(e);
        const palavras = e.config.grupos.reduce((t, g) => t + g.palavras.length, 0);
        setResumo([
          `✓ Esboço aplicado: ${e.config.grupos.length} grupo(s), ${palavras} palavra(s)-chave, ${e.config.negativas.length} negativa(s), ${e.config.titulos.filter(Boolean).length} títulos e ${e.config.descricoes.filter(Boolean).length} descrições. Revise abaixo.`,
          ...(e.cortados ? [`${e.cortados} texto(s) passaram do limite de caracteres e ficaram de fora.`] : []),
          ...(e.observacoes ? [`💡 ${e.observacoes}`] : []),
          p.modelo ? "Confira o nome e salve o modelo." : "Falta só: local, link do site (se não veio) e revisar. Textos com [colchetes] são para você completar.",
        ]);
      } else {
        const e = j as EsbocoMeta;
        (p.onPronto as (e: EsbocoMeta) => void)(e);
        const interesses = e.config.conjuntos.reduce((t, c) => t + c.interesses.length, 0);
        setResumo([
          `✓ Esboço aplicado: ${e.config.conjuntos.length} conjunto(s), ${interesses} interesse(s), ${e.config.textos.length} texto(s) e ${e.config.titulos.length} título(s). Revise abaixo.`,
          ...(e.naoEncontrados.length ? [`Não achei no Meta (ficaram de fora): ${e.naoEncontrados.join(", ")}.`] : []),
          ...(e.observacoes ? [`💡 ${e.observacoes}`] : []),
          p.modelo ? "Confira o nome e salve o modelo." : "Falta só: cidade, página/formulário e os criativos (ou marque para subir sem criativo). Textos com [colchetes] são para você completar.",
        ]);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  // veio da caixa "Pergunte ao painel": faz o esboço na hora
  useEffect(() => {
    if (!p.pedidoInicial || automatico.current) return;
    automatico.current = true;
    void esbocar(p.pedidoInicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.pedidoInicial]);

  return (
    <section className="rounded-2xl border border-destaque/40 bg-destaque-bg/40 p-4">
      <h2 className="mb-1 flex items-center gap-2 font-bold">
        <span aria-hidden className="text-destaque">✦</span> {p.modelo ? "Criar modelo com IA" : "Esboço com IA"}
      </h2>
      <p className="mb-3 text-xs text-texto-3">
        {plataforma === "google"
          ? "Descreva a campanha (nicho, serviços/produtos, região, oferta). A IA monta os grupos, as palavras-chave, as negativas e o anúncio responsivo."
          : "Descreva a campanha (objetivo, nicho, público, oferta). A IA escolhe os interesses (conferidos no Meta) e escreve textos, títulos e descrição."}{" "}
        Pode escrever ou falar. <b>Nada é publicado</b>: só preenche a tela abaixo para você revisar.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); parar(); void esbocar(); }} className="flex gap-2">
        <input
          value={pedido} onChange={(e) => setPedido(e.target.value)} aria-label="Descrição da campanha" placeholder={EXEMPLOS[plataforma]}
          className="min-h-11 min-w-0 flex-1 rounded-[10px] border border-borda bg-fundo px-3 text-sm placeholder:text-texto-3 focus:border-destaque focus:outline-none"
        />
        <BotaoMicrofone ouvindo={ouvindo} falar={() => falar(pedido)} />
        <button disabled={ocupado} className="min-h-11 shrink-0 rounded-[10px] bg-destaque px-4 text-sm font-semibold text-white disabled:opacity-60">
          {ocupado ? "Montando…" : p.modelo ? "Criar" : "Montar esboço"}
        </button>
      </form>
      {ouvindo && <p className="mt-2 text-xs text-destaque">● Ouvindo… pode fazer pausas. Toque no microfone de novo quando terminar.</p>}
      {ocupado && <p className="mt-2 text-sm text-texto-3">{plataforma === "google" ? "Escrevendo palavras-chave e anúncios" : "Escrevendo os textos e conferindo os interesses no Meta"} (uns 20 a 40 segundos)…</p>}
      {erro && <p className="mt-2 text-sm text-critico">{erro}</p>}
      {resumo && !ocupado && (
        <div className="mt-3 space-y-1 text-sm text-texto-2">
          {resumo.map((l, i) => <p key={i} className={i === 0 ? "font-semibold text-bom" : "text-xs text-texto-3"}>{l}</p>)}
        </div>
      )}
    </section>
  );
}
