"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Resultado = { cliente: { id: string; nome: string }; periodo: { rotulo: string; qs: string }; texto: string };

// reconhecimento de voz do navegador (Chrome/Android/Safari); sem custo
type ResultadoVoz = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type Reconhecedor = {
  lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void;
  onresult: ((e: { results: ArrayLike<ResultadoVoz> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
};
const criarReconhecedor = (): Reconhecedor | null => {
  if (typeof window === "undefined") return null;
  const C = (window as unknown as { SpeechRecognition?: new () => Reconhecedor; webkitSpeechRecognition?: new () => Reconhecedor }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => Reconhecedor }).webkitSpeechRecognition;
  return C ? new C() : null;
};

const LIMITE_MIC_MS = 3 * 60_000; // desliga sozinho depois de 3 minutos, por segurança

/**
 * Microfone do navegador: vai escrevendo o que a pessoa fala em `setTexto` e só para quando ela tocar de novo.
 * O navegador encerra a escuta sozinho depois de uma pausa; aqui ela é religada na hora, guardando o que já foi dito.
 */
export function useMicrofone(setTexto: (t: string) => void, setErro: (e: string) => void) {
  const [ouvindo, setOuvindo] = useState(false);
  const rec = useRef<Reconhecedor | null>(null);
  const quer = useRef(false);      // a pessoa ainda quer falar (não tocou para parar)
  const dito = useRef("");         // texto das escutas anteriores (antes do navegador religar)
  const inicio = useRef(0);

  function parar() {
    quer.current = false;
    rec.current?.stop();
    setOuvindo(false);
  }

  function escutar() {
    const r = criarReconhecedor();
    if (!r) { parar(); setErro("Este navegador não tem reconhecimento de voz. Use o Chrome, ou o microfone do teclado do celular."); return; }
    // no Android o modo contínuo repete as frases; lá cada escuta é curta e religamos a cada pausa
    r.continuous = !/android/i.test(navigator.userAgent);
    r.interimResults = true;
    r.lang = "pt-BR";
    let daVez = "";
    r.onresult = (ev) => {
      daVez = Array.from(ev.results).map((x) => x[0].transcript.trim()).filter(Boolean).join(" ");
      setTexto([dito.current, daVez].filter(Boolean).join(" "));
    };
    r.onerror = (ev) => {
      // sem permissão: não adianta religar
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed" || ev.error === "audio-capture") {
        parar();
        setErro(ev.error === "audio-capture" ? "Não achei o microfone deste aparelho." : "O navegador bloqueou o microfone. Libere a permissão do microfone para o painel e tente de novo.");
      }
      // "no-speech", "network", "aborted": o onend religa
    };
    r.onend = () => {
      dito.current = [dito.current, daVez].filter(Boolean).join(" ");
      if (quer.current && Date.now() - inicio.current < LIMITE_MIC_MS) {
        try { escutar(); } catch { parar(); }
      } else {
        parar();
      }
    };
    rec.current = r;
    r.start();
  }

  /** Toque no botão: liga (continuando o texto que já está na caixa) ou desliga. */
  function falar(textoAtual = "") {
    if (quer.current) { parar(); return; }
    quer.current = true;
    dito.current = textoAtual.trim();
    inicio.current = Date.now();
    setOuvindo(true);
    try { escutar(); } catch { parar(); }
  }
  return { ouvindo, falar, parar };
}

/** Botão do microfone (mesmo visual nas caixas de IA). */
export function BotaoMicrofone({ ouvindo, falar }: { ouvindo: boolean; falar: () => void }) {
  return (
    <button type="button" onClick={() => falar()} aria-label={ouvindo ? "Parar de ouvir" : "Falar o pedido"} title="Falar"
      className={`flex min-h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border ${ouvindo ? "border-destaque bg-destaque-bg text-destaque" : "border-borda text-texto-2 hover:text-texto"}`}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
    </button>
  );
}

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
  const router = useRouter();

  async function analisar(corpo: Record<string, unknown>) {
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch("/api/analise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = await r.json().catch(() => ({ erro: `erro ${r.status}` }));
      if (j.erro) throw new Error(j.erro);
      // pedido de campanha: abre a montagem, que faz o esboço
      if (j.ir) { router.push(j.ir); return; }
      setRes(j as Resultado);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    parar();
    if (!pedido.trim()) return clienteId && periodo ? analisar({ clienteId, ...periodo }) : setErro("Escreva o pedido, ex.: “últimos 14 dias da Loja X”.");
    analisar({ pedido, clienteId });
  }

  const { ouvindo, falar, parar } = useMicrofone(setPedido, setErro);

  const exemplo = clienteId
    ? "ex.: do dia 1 ao dia 15, mês passado, ou “monta uma campanha de WhatsApp…”"
    : "ex.: análise dos últimos 14 dias da Loja X · ou: campanha de formulário para a Loja X";
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
        <BotaoMicrofone ouvindo={ouvindo} falar={() => falar(pedido)} />
        <button disabled={ocupado} className="min-h-11 shrink-0 rounded-[10px] border border-borda bg-superficie-2 px-4 text-sm font-semibold hover:border-destaque disabled:opacity-60">
          {ocupado ? "…" : "Analisar"}
        </button>
      </form>
      {ouvindo && <p className="mt-2 text-xs text-destaque">● Ouvindo… pode fazer pausas. Toque no microfone de novo quando terminar.</p>}
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
