"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MidiaConta } from "@/lib/meta-montar";
import { enviarImagem, enviarVideoAoMeta } from "./enviar-midia";

// Mídia do Meta no painel: tocar vídeo com som, biblioteca da conta (como a do Gerenciador) e prévia do anúncio.

// janelas abertas, a de cima por último (o Esc fecha só a de cima: o player por cima da biblioteca)
const pilha: symbol[] = [];

/** Janela por cima da tela (fecha no ✕, no fundo ou com Esc). */
export function Janela({ titulo, onFechar, children, largura = "max-w-5xl" }: { titulo: string; onFechar: () => void; children: React.ReactNode; largura?: string }) {
  useEffect(() => {
    const eu = Symbol(titulo);
    pilha.push(eu);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && pilha[pilha.length - 1] === eu) onFechar(); };
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("keydown", esc);
      pilha.splice(pilha.indexOf(eu), 1);
    };
  }, [onFechar, titulo]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onClick={onFechar} role="dialog" aria-modal="true" aria-label={titulo}>
      <div className={`flex max-h-[94vh] w-full ${largura} flex-col overflow-hidden rounded-2xl border border-borda bg-superficie`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-borda px-4 py-3">
          <h2 className="font-semibold">{titulo}</h2>
          <button type="button" onClick={onFechar} className="rounded-lg px-2 text-lg text-texto-3 hover:text-texto" aria-label="Fechar">✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

/** Player grande, com som. `arquivo` = link local (mídia que acabou de ser escolhida); senão busca o vídeo no Meta. */
export function PlayerVideo({ conta, videoId, arquivo, titulo = "Vídeo", onFechar }: {
  conta: string; videoId?: string | null; arquivo?: string | null; titulo?: string; onFechar: () => void;
}) {
  const [fonte, setFonte] = useState<string | null>(arquivo ?? null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (arquivo || !videoId) return;
    let vivo = true;
    fetch(`/api/meta/midia?acao=fonte&conta=${encodeURIComponent(conta)}&id=${videoId}`).then((r) => r.json()).then((j) => {
      if (!vivo) return;
      if (j.fonte) setFonte(j.fonte); else setErro(j.erro ?? "O Meta não liberou o arquivo deste vídeo.");
    }).catch(() => vivo && setErro("Falha ao buscar o vídeo."));
    return () => { vivo = false; };
  }, [conta, videoId, arquivo]);
  return (
    <Janela titulo={titulo} onFechar={onFechar} largura="max-w-3xl">
      {fonte ? (
        <video src={fonte} controls autoPlay playsInline className="mx-auto max-h-[78vh] w-auto max-w-full rounded-lg bg-black" />
      ) : (
        <p className="py-10 text-center text-sm text-texto-3">{erro ?? "Carregando o vídeo…"}</p>
      )}
    </Janela>
  );
}

const duracao = (s?: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");

type Envio = { nome: string; estado: string; erro?: boolean };

/**
 * Biblioteca de mídia da conta, como a do Gerenciador: vídeos e imagens já enviados, com miniatura, nome e duração.
 * Escolhe um (edição) ou vários (montagem). "Enviar arquivos" sobe vários de uma vez para a biblioteca.
 */
export function BibliotecaMidia({ conta, multiplo = false, onEscolher, onFechar }: {
  conta: string; multiplo?: boolean; onEscolher: (itens: MidiaConta[]) => void; onFechar: () => void;
}) {
  const [tipo, setTipo] = useState<"video" | "imagem">("video");
  const [itens, setItens] = useState<MidiaConta[]>([]);
  const [depois, setDepois] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [escolhidos, setEscolhidos] = useState<MidiaConta[]>([]);
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [tocando, setTocando] = useState<MidiaConta | null>(null);
  const lote = useMemo(() => crypto.randomUUID(), []);

  const carregar = useCallback(async (t: "video" | "imagem", cursor: string | null) => {
    setCarregando(true);
    setErro(null);
    try {
      const j = await fetch(`/api/meta/midia?acao=lista&conta=${encodeURIComponent(conta)}&tipo=${t}${cursor ? `&depois=${encodeURIComponent(cursor)}` : ""}`).then((r) => r.json());
      if (j.erro) throw new Error(j.erro);
      setItens((x) => (cursor ? [...x, ...j.itens] : j.itens));
      setDepois(j.depois);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [conta]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar(tipo, null); }, [tipo, carregar]);

  const alternar = (m: MidiaConta) => {
    if (!multiplo) { setEscolhidos([m]); return; }
    setEscolhidos((x) => (x.some((y) => y.id === m.id) ? x.filter((y) => y.id !== m.id) : [...x, m]));
  };

  async function enviar(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    const lista = Array.from(arquivos);
    setEnvios(lista.map((f) => ({ nome: f.name, estado: "na fila" })));
    const novos: MidiaConta[] = [];
    for (const [i, f] of lista.entries()) {
      const marcar = (estado: string, e = false) => setEnvios((x) => x.map((y, j) => (j === i ? { ...y, estado, erro: e } : y)));
      try {
        if (f.type.startsWith("video/")) {
          const { videoId } = await enviarVideoAoMeta(f, conta, (pct) => marcar(`enviando ${pct}%`));
          novos.push({ tipo: "video", id: videoId, nome: f.name, miniatura: null });
        } else {
          marcar("enviando…");
          const { caminho } = await enviarImagem(f, lote);
          const j = await fetch("/api/meta/midia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conta, caminho }) }).then((r) => r.json());
          if (j.erro) throw new Error(j.erro);
          novos.push({ tipo: "imagem", id: j.hash, nome: f.name, miniatura: URL.createObjectURL(f) });
        }
        marcar("✓ na biblioteca");
      } catch (e) {
        marcar(e instanceof Error ? e.message : String(e), true);
      }
    }
    // os enviados já ficam escolhidos (vídeo novo pode levar um tempo para ganhar miniatura no Meta)
    if (novos.length) {
      setEscolhidos((x) => (multiplo ? [...x, ...novos] : [novos[novos.length - 1]]));
      setItens((x) => [...novos.filter((n) => n.tipo === tipo), ...x]);
    }
  }

  const visiveis = itens.filter((m) => !busca.trim() || m.nome.toLowerCase().includes(busca.trim().toLowerCase()));
  const aba = (t: "video" | "imagem", r: string) => (
    <button type="button" onClick={() => { setTipo(t); setItens([]); setDepois(null); }}
      className={`rounded-full border px-3 py-1 text-sm ${tipo === t ? "border-destaque bg-destaque-bg font-semibold" : "border-borda text-texto-2 hover:text-texto"}`}>{r}</button>
  );
  return (
    <Janela titulo="Biblioteca de mídia da conta" onFechar={onFechar}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {aba("video", "Vídeos")}{aba("imagem", "Imagens")}
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome…" className="min-h-9 flex-1 rounded-lg border border-borda bg-fundo px-2.5 text-sm sm:max-w-xs" />
          <label className="ml-auto cursor-pointer rounded-lg border border-borda bg-superficie-2 px-3 py-2 text-sm font-semibold hover:border-destaque">
            + Enviar arquivos
            <input type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" className="hidden"
              onChange={(e) => { void enviar(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
        {envios.length > 0 && (
          <ul className="space-y-0.5 rounded-lg bg-superficie-2 p-2 text-xs">
            {envios.map((e, i) => <li key={i} className={e.erro ? "text-critico" : "text-texto-2"}>{e.nome}: {e.estado}</li>)}
          </ul>
        )}
        {erro && <p className="text-sm text-critico">{erro}</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {visiveis.map((m) => {
            const sel = escolhidos.some((x) => x.id === m.id);
            return (
              <div key={m.id} className={`overflow-hidden rounded-xl border-2 bg-fundo ${sel ? "border-destaque" : "border-transparent"}`}>
                <button type="button" onClick={() => alternar(m)} className="relative block aspect-square w-full bg-black" title={m.nome}>
                  {m.miniatura
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={m.miniatura} alt={m.nome} className="h-full w-full object-contain" loading="lazy" />
                    : <span className="flex h-full items-center justify-center text-xs text-texto-3">{m.tipo === "video" ? "processando…" : "sem prévia"}</span>}
                  {sel && <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-destaque text-xs font-bold text-white">✓</span>}
                  {m.duracao ? <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 text-[11px] text-white">{duracao(m.duracao)}</span> : null}
                </button>
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs" title={m.nome}>{m.nome}</span>
                  {m.tipo === "video" && (
                    <button type="button" onClick={() => setTocando(m)} className="shrink-0 rounded px-1.5 text-xs text-destaque hover:bg-destaque-bg" aria-label={`Assistir ${m.nome}`}>▶</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {!carregando && !visiveis.length && <p className="py-6 text-center text-sm text-texto-3">Nada {busca ? "com esse nome" : "nesta conta ainda"}.</p>}
        {carregando && <p className="text-center text-sm text-texto-3">Carregando…</p>}
        {depois && !carregando && (
          <div className="text-center"><button type="button" onClick={() => carregar(tipo, depois)} className="rounded-lg border border-borda px-3 py-1.5 text-sm hover:border-destaque">Carregar mais</button></div>
        )}
      </div>
      <div className="sticky bottom-0 -mx-4 -mb-4 mt-3 flex items-center justify-between gap-2 border-t border-borda bg-superficie px-4 py-3">
        <span className="text-sm text-texto-2">{escolhidos.length ? `${escolhidos.length} escolhido(s)` : multiplo ? "Escolha um ou mais" : "Escolha um"}</span>
        <button type="button" disabled={!escolhidos.length} onClick={() => { onEscolher(escolhidos); onFechar(); }}
          className="rounded-[10px] bg-destaque px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          Usar {escolhidos.length > 1 ? `os ${escolhidos.length}` : ""}
        </button>
      </div>
      {tocando && <PlayerVideo conta={conta} videoId={tocando.id} titulo={tocando.nome} onFechar={() => setTocando(null)} />}
    </Janela>
  );
}

const FORMATOS: [string, string][] = [
  ["MOBILE_FEED_STANDARD", "Feed do Facebook"], ["INSTAGRAM_STANDARD", "Feed do Instagram"],
  ["INSTAGRAM_STORY", "Stories do Instagram"], ["INSTAGRAM_REELS", "Reels do Instagram"], ["FACEBOOK_STORY_MOBILE", "Stories do Facebook"],
];

/** Prévia oficial do Meta para o anúncio (a mesma do Gerenciador), por posicionamento. */
export function PreviaAnuncio({ conta, anuncioId }: { conta: string; anuncioId: string }) {
  const [formato, setFormato] = useState(FORMATOS[0][0]);
  const [res, setRes] = useState<{ chave: string; src: string | null; erro?: string } | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch(`/api/meta/midia?acao=previa&conta=${encodeURIComponent(conta)}&anuncio=${anuncioId}&formato=${formato}`).then((r) => r.json())
      .then((j) => vivo && setRes({ chave: formato, src: j.src ?? null, erro: j.erro }))
      .catch(() => vivo && setRes({ chave: formato, src: null, erro: "Falha ao buscar a prévia." }));
    return () => { vivo = false; };
  }, [conta, anuncioId, formato]);
  const carregando = !res || res.chave !== formato;
  return (
    <section className="space-y-3 rounded-2xl border border-borda bg-superficie p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Prévia do anúncio <span className="text-xs font-normal text-texto-3">(do próprio Meta, como está publicado agora)</span></h2>
        <select value={formato} onChange={(e) => setFormato(e.target.value)} className="min-h-9 rounded-lg border border-borda bg-fundo px-2 text-sm">
          {FORMATOS.map(([k, r]) => <option key={k} value={k}>{r}</option>)}
        </select>
      </div>
      <div className="flex justify-center">
        {carregando ? <p className="py-10 text-sm text-texto-3">Carregando a prévia…</p>
          : res.src ? <iframe key={res.src} src={res.src} title="Prévia do anúncio" className="h-[640px] w-[360px] max-w-full rounded-xl border border-borda bg-white" />
          : <p className="py-10 text-sm text-texto-3">{res.erro ?? "O Meta não gerou prévia neste formato."}</p>}
      </div>
    </section>
  );
}

/** Botão ▶ por cima da miniatura: abre o vídeo grande, com som. */
export function AssistirVideo({ conta, videoId, titulo }: { conta: string; videoId: string; titulo: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className="absolute inset-0 flex items-center justify-center" aria-label={`Assistir ${titulo} com som`}>
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/70 text-xl text-white shadow-lg transition hover:scale-105">▶</span>
      </button>
      {aberto && <PlayerVideo conta={conta} videoId={videoId} titulo={titulo} onFechar={() => setAberto(false)} />}
    </>
  );
}
