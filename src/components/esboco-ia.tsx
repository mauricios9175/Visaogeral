"use client";

import { useEffect, useRef, useState } from "react";
import type { ConfigMeta, ObjetivoMeta } from "@/lib/modelos";
import { BotaoMicrofone, useMicrofone } from "./analise-ia";

type Esboco = { objetivo: ObjetivoMeta; config: ConfigMeta; naoEncontrados: string[]; observacoes: string };

/**
 * "Esboço com IA" na montagem: a pessoa descreve a campanha e a IA preenche objetivo, públicos (com interesses
 * reais do Meta), textos, títulos e descrição. Nada é publicado: só preenche a tela para revisar.
 */
export function EsbocoIA({ clienteId, conta, pedidoInicial, onPronto }: {
  clienteId: string; conta: string; pedidoInicial?: string; onPronto: (objetivo: ObjetivoMeta, config: ConfigMeta) => void;
}) {
  const [pedido, setPedido] = useState(pedidoInicial ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<Esboco | null>(null);
  const { ouvindo, falar } = useMicrofone(setPedido, setErro);
  const automatico = useRef(false);

  async function esbocar(texto = pedido) {
    if (!texto.trim()) return setErro("Descreva a campanha, ex.: “formulário para loja de celulares, foco em iPhone”.");
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch("/api/esboco", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, pedido: texto, contaId: conta || null }),
      });
      const j = await r.json().catch(() => ({ erro: `erro ${r.status}` }));
      if (j.erro) throw new Error(j.erro);
      setFeito(j as Esboco);
      onPronto(j.objetivo, j.config);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  // veio da caixa "Pergunte ao painel": faz o esboço assim que a conta estiver escolhida
  useEffect(() => {
    if (!pedidoInicial || automatico.current) return;
    automatico.current = true;
    void esbocar(pedidoInicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoInicial]);

  const interesses = feito?.config.conjuntos.reduce((t, c) => t + c.interesses.length, 0) ?? 0;
  return (
    <section className="rounded-2xl border border-destaque/40 bg-destaque-bg/40 p-4">
      <h2 className="mb-1 flex items-center gap-2 font-bold"><span aria-hidden className="text-destaque">✦</span> Esboço com IA</h2>
      <p className="mb-3 text-xs text-texto-3">
        Descreva a campanha (objetivo, nicho, público, oferta). A IA escolhe os interesses (conferidos no Meta) e escreve
        textos, títulos e descrição. <b>Nada é publicado</b>: só preenche a tela abaixo para você revisar.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); void esbocar(); }} className="flex gap-2">
        <input
          value={pedido} onChange={(e) => setPedido(e.target.value)} aria-label="Descrição da campanha"
          placeholder="ex.: campanha de WhatsApp para loja de celulares, foco em iPhone seminovo, R$ 40 por dia"
          className="min-h-11 min-w-0 flex-1 rounded-[10px] border border-borda bg-fundo px-3 text-sm placeholder:text-texto-3 focus:border-destaque focus:outline-none"
        />
        <BotaoMicrofone ouvindo={ouvindo} falar={falar} />
        <button disabled={ocupado} className="min-h-11 shrink-0 rounded-[10px] bg-destaque px-4 text-sm font-semibold text-white disabled:opacity-60">
          {ocupado ? "Montando…" : "Montar esboço"}
        </button>
      </form>
      {ouvindo && <p className="mt-2 text-xs text-destaque">Ouvindo… toque no microfone de novo para parar.</p>}
      {ocupado && <p className="mt-2 text-sm text-texto-3">Escrevendo os textos e conferindo os interesses no Meta (uns 20 a 40 segundos)…</p>}
      {erro && <p className="mt-2 text-sm text-critico">{erro}</p>}
      {feito && !ocupado && (
        <div className="mt-3 space-y-1 text-sm text-texto-2">
          <p className="font-semibold text-bom">✓ Esboço aplicado: {feito.config.conjuntos.length} conjunto(s), {interesses} interesse(s), {feito.config.textos.length} texto(s) e {feito.config.titulos.length} título(s). Revise abaixo.</p>
          {feito.naoEncontrados.length > 0 && <p className="text-xs text-texto-3">Não achei no Meta (ficaram de fora): {feito.naoEncontrados.join(", ")}.</p>}
          {feito.observacoes && <p className="text-xs text-texto-3">💡 {feito.observacoes}</p>}
          <p className="text-xs text-texto-3">Falta só: cidade, página/formulário e os criativos (ou marque para subir sem criativo). Textos com [colchetes] são para você completar.</p>
        </div>
      )}
    </section>
  );
}
