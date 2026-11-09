"use client";

import { useEffect, useState } from "react";
import type { AnaliseCriativo } from "@/lib/analise-criativo";
import { Janela } from "./midia-meta";

const COR_GANCHO = { forte: "bg-bom-bg text-bom", medio: "bg-atencao-bg text-atencao", fraco: "bg-critico-bg text-critico" } as const;
const corNota = (n: number) => (n >= 8 ? "text-bom" : n >= 5 ? "text-atencao" : "text-critico");

function Lista({ titulo, itens, cor }: { titulo: string; itens: string[]; cor: string }) {
  if (!itens.length) return null;
  return (
    <div className="space-y-1.5">
      <h3 className={`text-sm font-semibold ${cor}`}>{titulo}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm text-texto-2">{itens.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

/** A análise na tela: nota, gancho, estrutura (linha do tempo), falas, pontos fortes/fracos, sugestões e números. */
function Resultado({ a }: { a: AnaliseCriativo }) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        <div className="text-center">
          <div className={`num text-4xl font-extrabold ${corNota(a.nota)}`}>{a.nota}</div>
          <div className="text-[11px] text-texto-3">de 10</div>
        </div>
        <p className="flex-1 text-sm leading-relaxed text-texto-2">{a.resumo}</p>
      </div>

      <div className="space-y-1.5 rounded-xl bg-superficie-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{a.formato === "video" ? "Gancho (3 primeiros segundos)" : "O que chama atenção primeiro"}</h3>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${COR_GANCHO[a.gancho.avaliacao]}`}>{a.gancho.avaliacao === "medio" ? "médio" : a.gancho.avaliacao}</span>
        </div>
        <p className="text-sm text-texto">{a.gancho.oQueAcontece}</p>
        <p className="text-sm text-texto-2">{a.gancho.porque}</p>
      </div>

      {a.estrutura.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Estrutura {a.formato === "video" ? "do vídeo" : "da peça"}</h3>
          <ol className="space-y-1.5 border-l-2 border-destaque/40 pl-4">
            {a.estrutura.map((e, i) => (
              <li key={i} className="text-sm">
                <span className="font-semibold text-destaque">{e.parte}</span>
                {e.momento && <span className="text-xs text-texto-3"> · {e.momento}</span>}
                <div className="text-texto-2">{e.conteudo}</div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {a.falas && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{a.formato === "video" ? "O que é falado" : "Texto na arte"}</h3>
          <p className="whitespace-pre-line rounded-lg bg-fundo p-3 text-sm text-texto-2">{a.falas}</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Lista titulo="✓ Pontos fortes" itens={a.pontosFortes} cor="text-bom" />
        <Lista titulo="▲ Pontos fracos" itens={a.pontosFracos} cor="text-atencao" />
      </div>
      <Lista titulo="→ Sugestões para a próxima versão" itens={a.sugestoes} cor="text-destaque" />

      {a.numeros && (
        <div className="space-y-1 rounded-xl border border-borda p-3">
          <h3 className="text-sm font-semibold">O que os números dizem</h3>
          <p className="text-sm text-texto-2">{a.numeros}</p>
        </div>
      )}
      <p className="text-[11px] text-texto-3">
        Análise feita por IA em {new Date(a.criadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}, com os números de {a.periodo.toLowerCase()}. Confira antes de decidir.
      </p>
    </div>
  );
}

/** Botão "✦ Analisar com IA" de um criativo: mostra a análise salva ou faz uma nova. */
export function AnalisarCriativo({ adId, clienteId, nome, formato, classe }: { adId: string; clienteId: string; nome: string; formato: string; classe?: string }) {
  const [aberto, setAberto] = useState(false);
  const [analise, setAnalise] = useState<AnaliseCriativo | null | undefined>(undefined);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto || analise !== undefined) return;
    let vivo = true;
    fetch(`/api/criativos/analise?ad=${adId}`).then((r) => r.json()).then((j) => vivo && setAnalise(j.analise ?? null)).catch(() => vivo && setAnalise(null));
    return () => { vivo = false; };
  }, [aberto, adId, analise]);

  async function analisar() {
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch("/api/criativos/analise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ad: adId, clienteId }) });
      const j = await r.json().catch(() => ({ erro: `erro ${r.status}` }));
      if (j.erro) throw new Error(j.erro);
      setAnalise(j.analise);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className={classe ?? "text-xs font-semibold text-destaque underline"}>✦ Analisar com IA</button>
      {aberto && (
        <Janela titulo={`Análise do criativo: ${nome}`} onFechar={() => setAberto(false)} largura="max-w-3xl">
          {analise === undefined ? (
            <p className="py-8 text-center text-sm text-texto-3">Carregando…</p>
          ) : ocupado ? (
            <p className="py-8 text-center text-sm text-texto-3">
              {formato === "video" ? "A IA está assistindo ao vídeo (com o áudio) e cruzando com os números… leva uns 30 a 90 segundos." : "A IA está olhando a imagem e cruzando com os números…"}
            </p>
          ) : analise ? (
            <div className="space-y-4">
              <Resultado a={analise} />
              <button type="button" onClick={analisar} className="rounded-lg border border-borda px-3 py-1.5 text-sm hover:border-destaque">Analisar de novo (números atualizados)</button>
            </div>
          ) : (
            <div className="space-y-3 py-4 text-center">
              <p className="text-sm text-texto-2">
                A IA {formato === "video" ? "assiste ao vídeo inteiro, com o áudio," : "olha a imagem"} e lê o texto do anúncio, e cruza com os números dele
                (gancho, retenção, CTR, custo e CRM) para dizer o que funciona, o que não funciona e o que mudar.
              </p>
              <button type="button" onClick={analisar} className="rounded-[10px] bg-destaque px-5 py-2 text-sm font-semibold text-white">Analisar agora</button>
            </div>
          )}
          {erro && <p className="mt-3 text-sm text-critico">{erro}</p>}
        </Janela>
      )}
    </>
  );
}
