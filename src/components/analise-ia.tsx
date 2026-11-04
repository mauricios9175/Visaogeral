"use client";

import Link from "next/link";
import { useRef, useState } from "react";

type Resultado = { cliente: { id: string; nome: string }; periodo: { rotulo: string; qs: string }; texto: string };

// reconhecimento de voz do navegador (Chrome/Android/Safari); sem custo
type Reconhecedor = { lang: string; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
const criarReconhecedor = (): Reconhecedor | null => {
  if (typeof window === "undefined") return null;
  const C = (window as unknown as { SpeechRecognition?: new () => Reconhecedor; webkitSpeechRecognition?: new () => Reconhecedor }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => Reconhecedor }).webkitSpeechRecognition;
  return C ? new C() : null;
};

/** Negrito (**x**) dentro de uma linha. */
function Inline({ t }: { t: string }) {
  return <>{t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p))}</>;
}

/** Markdown simples da resposta: títulos (##), listas (- ou *) e parágrafos. */
function Texto({ texto }: { texto: string }) {
  const blocos: React.ReactNode[] = [];
  let lista: string[] = [];
  const fecharLista = () => {
    if (lista.length) blocos.push(<ul key={blocos.length} className="list-disc space-y-1 pl-5">{lista.map((l, i) => <li key={i}><Inline t={l} /></li>)}</ul>);
    lista = [];
  };
  for (const linha of texto.split("\n").map((l) => l.trim())) {
    if (!linha) { fecharLista(); continue; }
    const titulo = /^#{1,4}\s+(.*)$/.exec(linha);
    const item = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(linha);
    if (titulo) { fecharLista(); blocos.push(<h3 key={blocos.length} className="pt-2 text-sm font-bold uppercase tracking-wide text-destaque">{titulo[1].replace(/\*\*/g, "")}</h3>); }
    else if (item) lista.push(item[1]);
    else { fecharLista(); blocos.push(<p key={blocos.length}><Inline t={linha} /></p>); }
  }
  fecharLista();
  return <div className="space-y-2 text-sm leading-relaxed text-texto-2">{blocos}</div>;
}

/**
 * "Pergunte ao painel": análise em texto com IA.
 * Na visão geral, o cliente e o período vêm do texto. Na tela do cliente, `clienteId` e `periodo` já vêm da tela.
 */
export function AnaliseIA({ clienteId, periodo, rotuloPeriodo }: { clienteId?: string; periodo?: { p: string; de?: string; ate?: string }; rotuloPeriodo?: string }) {
  const [pedido, setPedido] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [res, setRes] = useState<Resultado | null>(null);
  const [ouvindo, setOuvindo] = useState(false);
  const rec = useRef<Reconhecedor | null>(null);

  async function analisar(corpo: Record<string, unknown>) {
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch("/api/analise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = await r.json().catch(() => ({ erro: `erro ${r.status}` }));
      if (j.erro) throw new Error(j.erro);
      setRes(j as Resultado);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!pedido.trim()) return clienteId && periodo ? analisar({ clienteId, ...periodo }) : setErro("Escreva o pedido, ex.: “últimos 14 dias da Loja X”.");
    analisar({ pedido, clienteId });
  }

  function falar() {
    if (ouvindo) { rec.current?.stop(); return; }
    const r = criarReconhecedor();
    if (!r) { setErro("Este navegador não tem reconhecimento de voz. Use o Chrome, ou o microfone do teclado do celular."); return; }
    r.lang = "pt-BR";
    r.interimResults = true;
    r.onresult = (ev) => setPedido(Array.from(ev.results).map((x) => x[0].transcript).join(" "));
    r.onend = () => setOuvindo(false);
    r.onerror = () => setOuvindo(false);
    rec.current = r;
    setOuvindo(true);
    r.start();
  }

  const exemplo = clienteId ? "ex.: do dia 1 ao dia 15, últimos 30 dias, mês passado" : "ex.: análise dos últimos 14 dias da Loja X";
  return (
    <section className="rounded-2xl border border-borda bg-superficie p-4 lg:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold">
          <span aria-hidden className="text-destaque">✦</span> {clienteId ? "Análise com IA" : "Pergunte ao painel"}
        </h2>
        {clienteId && periodo && (
          <button type="button" disabled={ocupado} onClick={() => analisar({ clienteId, ...periodo })}
            className="min-h-10 rounded-[10px] bg-destaque px-4 text-sm font-semibold text-white disabled:opacity-60">
            {ocupado ? "Analisando…" : `Analisar ${rotuloPeriodo ? rotuloPeriodo.toLowerCase() : "o período"}`}
          </button>
        )}
      </div>
      <form onSubmit={enviar} className="flex gap-2">
        <input
          value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder={clienteId ? `Outro período? ${exemplo}` : exemplo}
          aria-label="Pedido de análise"
          className="min-h-11 min-w-0 flex-1 rounded-[10px] border border-borda bg-fundo px-3 text-sm placeholder:text-texto-3 focus:border-destaque focus:outline-none"
        />
        <button type="button" onClick={falar} aria-label={ouvindo ? "Parar de ouvir" : "Falar o pedido"} title="Falar"
          className={`flex min-h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border ${ouvindo ? "border-destaque bg-destaque-bg text-destaque" : "border-borda text-texto-2 hover:text-texto"}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        </button>
        <button disabled={ocupado} className="min-h-11 shrink-0 rounded-[10px] border border-borda bg-superficie-2 px-4 text-sm font-semibold hover:border-destaque disabled:opacity-60">
          {ocupado ? "…" : "Analisar"}
        </button>
      </form>
      {ouvindo && <p className="mt-2 text-xs text-destaque">Ouvindo… fale o pedido e toque no microfone de novo para parar.</p>}
      {ocupado && <p className="mt-3 text-sm text-texto-3">Juntando os números e escrevendo a análise (leva uns 10 a 30 segundos)…</p>}
      {erro && <p className="mt-3 text-sm text-critico">{erro}</p>}
      {res && !ocupado && (
        <div className="mt-4 border-t border-borda pt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-texto-3">
            <span>
              {!clienteId && <><Link href={`/clientes/${res.cliente.id}?${res.periodo.qs}`} className="font-semibold text-texto hover:text-destaque">{res.cliente.nome}</Link> · </>}
              {res.periodo.rotulo}
            </span>
            <button type="button" onClick={() => navigator.clipboard?.writeText(res.texto)} className="hover:text-texto">Copiar texto</button>
          </div>
          <Texto texto={res.texto} />
          <p className="mt-3 text-[11px] text-texto-3">Gerado por IA a partir dos números do painel. Confira antes de mandar para o cliente.</p>
        </div>
      )}
    </section>
  );
}
