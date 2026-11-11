"use client";

import Link from "next/link";
import { useState } from "react";
import type { AnuncioSalvo, NichoRadar, Radar } from "@/lib/radar";
import { enviarImagem } from "./enviar-midia";

const dinheiro = (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const pct = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);
const corNota = (n: number) => (n >= 8 ? "bg-bom-bg text-bom" : n >= 5 ? "bg-atencao-bg text-atencao" : "bg-critico-bg text-critico");

async function chamar(corpo: object) {
  const r = await fetch("/api/radar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({ erro: `erro ${r.status}` }));
  if (!r.ok || j.erro) throw new Error(j.erro ?? `erro ${r.status}`);
  return j;
}

export function RadarCriativos({ inicial, salvosIniciais, clientes, hoje }: {
  inicial: Radar | null; salvosIniciais: AnuncioSalvo[]; clientes: { id: string; nome: string; nicho: string | null }[]; hoje: string;
}) {
  const [radar, setRadar] = useState(inicial);
  const [salvos, setSalvos] = useState(salvosIniciais);
  const [sel, setSel] = useState(inicial?.nichos[0]?.nicho ?? "");
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const nicho = radar?.nichos.find((n) => n.nicho === sel) ?? radar?.nichos[0] ?? null;

  async function atualizar() {
    setGerando(true);
    setErro(null);
    try {
      const j = await chamar({ op: "gerar" });
      setRadar(j.radar);
      if (!j.radar.nichos.some((n: NichoRadar) => n.nicho === sel)) setSel(j.radar.nichos[0]?.nicho ?? "");
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setGerando(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-texto-3">
          {radar ? <>Atualizado {radar.data === hoje ? "hoje" : `em ${radar.data.split("-").reverse().join("/")}`} às {new Date(radar.criadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}. O radar se atualiza sozinho toda madrugada.</> : "O radar ainda não foi montado."}
        </p>
        <button type="button" onClick={atualizar} disabled={gerando} className="rounded-[10px] border border-borda px-4 py-2 text-sm font-semibold hover:border-destaque disabled:opacity-60">
          {gerando ? "Montando… (até 2 min na 1ª vez)" : "Atualizar agora"}
        </button>
      </div>
      {erro && <p className="text-sm text-critico">{erro}</p>}

      <AnalisarAnuncio clientes={clientes} nichos={radar?.nichos.map((n) => n.nicho) ?? []} nichoAtual={nicho?.nicho ?? ""} aoSalvar={(s) => setSalvos((xs) => [s, ...xs])} />

      {radar && radar.nichos.length === 0 && (
        <p className="text-sm text-texto-3">Nenhum cliente com nicho cadastrado. Preencha o nicho dos clientes em <Link href="/configuracoes" className="underline">Configurações</Link>.</p>
      )}
      {radar && radar.nichos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {radar.nichos.map((n) => (
            <button key={n.nicho} type="button" onClick={() => setSel(n.nicho)}
              className={`rounded-full border px-3.5 py-1.5 text-sm ${n.nicho === nicho?.nicho ? "border-destaque bg-destaque-bg font-semibold" : "border-borda text-texto-2 hover:text-texto"}`}>
              {n.nicho} <span className="text-texto-3">{n.clientes.length}</span>
            </button>
          ))}
        </div>
      )}
      {nicho && <SecaoNicho key={nicho.nicho} n={nicho} aoMudarPalavras={(palavras) => setRadar((r) => r && ({ ...r, nichos: r.nichos.map((x) => (x.nicho === nicho.nicho ? { ...x, palavras, buscas: palavras.map((p) => ({ palavra: p, url: linkBiblioteca(p), video: linkBiblioteca(p, "video") })) } : x)) }))} />}

      <Salvos salvos={salvos} hoje={hoje} aoExcluir={(id) => setSalvos((xs) => xs.filter((x) => x.id !== id))} />
    </div>
  );
}

function linkBiblioteca(palavra: string, midia: "all" | "video" = "all") {
  const q = new URLSearchParams({ active_status: "active", ad_type: "all", country: "BR", is_targeted_country: "false", media_type: midia, q: palavra, search_type: "keyword_unordered" });
  return `https://www.facebook.com/ads/library/?${q}`;
}

function SecaoNicho({ n, aoMudarPalavras }: { n: NichoRadar; aoMudarPalavras: (p: string[]) => void }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(n.palavras.join(", "));
  async function salvar() {
    const j = await chamar({ op: "palavras", nicho: n.nicho, palavras: texto.split(",") }).catch(() => null);
    if (j) aoMudarPalavras(j.palavras);
    setEditando(false);
  }
  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-2xl border border-borda bg-superficie p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">Buscar na Biblioteca de Anúncios <span className="text-sm font-normal text-texto-3">· anúncios ativos no Brasil</span></h2>
          <button type="button" onClick={() => setEditando((x) => !x)} className="text-xs text-texto-3 underline hover:text-texto">{editando ? "cancelar" : "editar termos"}</button>
        </div>
        {editando ? (
          <div className="flex flex-wrap gap-2">
            <input value={texto} onChange={(e) => setTexto(e.target.value)} className="min-h-10 min-w-0 flex-1 rounded-lg border border-borda bg-fundo px-3 text-sm" placeholder="termos separados por vírgula" />
            <button type="button" onClick={salvar} className="rounded-lg bg-destaque px-3 text-sm font-semibold text-white">Salvar</button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {n.buscas.map((b) => (
              <span key={b.palavra} className="inline-flex overflow-hidden rounded-lg border border-borda text-sm">
                <a href={b.url} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 hover:bg-destaque-bg">{b.palavra}</a>
                <a href={b.video} target="_blank" rel="noopener noreferrer" className="border-l border-borda px-2 py-1.5 text-texto-3 hover:bg-destaque-bg hover:text-texto" title="Só vídeos">▶</a>
              </span>
            ))}
          </div>
        )}
        <details className="text-xs text-texto-3">
          <summary className="cursor-pointer">Como saber se um anúncio de fora é bom (a Biblioteca não mostra números)</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><b>Tempo no ar</b> (“Veiculação iniciada em…”): o sinal mais forte. Ninguém deixa um anúncio que dá prejuízo rodando 30, 60, 90 dias.</li>
            <li><b>Versões</b> (“N anúncios usam esse criativo”): várias versões = estão escalando (vários públicos/conjuntos).</li>
            <li><b>Ainda ativo hoje</b> e em várias plataformas (Facebook, Instagram, Messenger).</li>
            <li><b>Tamanho do anunciante</b>: quantos anúncios ativos a página tem.</li>
            <li>Post impulsionado: <b>comentários e compartilhamentos</b> do post.</li>
            <li>Regra prática: <b>mais de 30 dias no ar + várias versões + ativo</b> = forte candidato. Baixe o vídeo ou tire print e use “Analisar este anúncio”.</li>
          </ul>
        </details>
      </section>

      <section className="space-y-3 rounded-2xl border border-borda bg-superficie p-4">
        <h2 className="font-bold">Melhores dos seus clientes neste nicho <span className="text-sm font-normal text-texto-3">· últimos 30 dias, com números reais</span></h2>
        {n.melhores.length === 0 ? <p className="text-sm text-texto-3">Ainda sem criativos com volume suficiente (pelo menos R$ 30 e 3 resultados).</p> : (
          <div className="grid gap-3 md:grid-cols-2">
            {n.melhores.map((c) => (
              <div key={c.id} className="flex gap-3 rounded-xl border border-borda bg-fundo p-3">
                {c.miniatura
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={c.miniatura} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" loading="lazy" />
                  : <span className="h-20 w-20 shrink-0 rounded-lg bg-superficie-2" />}
                <div className="min-w-0 space-y-1 text-xs">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.nome}</span>
                    {c.nota != null && <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${corNota(c.nota)}`}>IA {c.nota}/10</span>}
                  </div>
                  <div className="text-texto-3">{c.cliente.nome} · {c.formato === "video" ? "vídeo" : c.formato === "imagem" ? "imagem" : "carrossel"}</div>
                  <div className="text-texto-2">
                    {dinheiro(c.cpr)}/result. {c.vsMedia != null && c.vsMedia < 1 && <b className="text-bom">({Math.round((1 - c.vsMedia) * 100)}% abaixo da média)</b>} · CTR {pct(c.ctr)}{c.gancho != null && <> · gancho {pct(c.gancho)}</>}
                  </div>
                  {c.porque && <p className="line-clamp-3 text-texto-2">{c.porque}</p>}
                  <div className="flex gap-3 pt-0.5">
                    <Link href={`/criativos?cliente=${c.cliente.id}`} className="text-destaque underline">ver no painel</Link>
                    {c.link && <a href={c.link} target="_blank" rel="noopener noreferrer" className="text-destaque underline">ver o anúncio ↗</a>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {n.pesquisa && (
        <details className="rounded-2xl border border-borda bg-superficie p-4">
          <summary className="cursor-pointer font-bold">O que está em alta no nicho <span className="text-sm font-normal text-texto-3">· pesquisa na internet com IA de {new Date(n.pesquisa.criadoEm).toLocaleDateString("pt-BR")}</span></summary>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-texto-2">{n.pesquisa.texto}</p>
          {n.pesquisa.fontes.length > 0 && (
            <p className="mt-2 text-xs text-texto-3">Fontes: {n.pesquisa.fontes.slice(0, 8).map((f, i) => <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" className="mr-2 underline">{f.titulo || `fonte ${i + 1}`}</a>)}</p>
          )}
        </details>
      )}
    </div>
  );
}

function AnalisarAnuncio({ clientes, nichos, nichoAtual, aoSalvar }: {
  clientes: { id: string; nome: string; nicho: string | null }[]; nichos: string[]; nichoAtual: string; aoSalvar: (s: AnuncioSalvo) => void;
}) {
  const [f, setF] = useState({ link: "", nicho: nichoAtual, clienteId: "", diasNoAr: "", versoes: "", texto: "", observacao: "" });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);

  async function analisar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      let caminho: string | null = null;
      if (arquivo) {
        setOcupado("Enviando o arquivo…");
        caminho = (await enviarImagem(arquivo, `radar-${crypto.randomUUID().slice(0, 12)}`)).caminho;
      }
      setOcupado(arquivo?.type.startsWith("video/") ? "A IA está assistindo ao anúncio… (30 a 90 s)" : "A IA está analisando…");
      const nicho = f.nicho || clientes.find((c) => c.id === f.clienteId)?.nicho || "";
      const j = await chamar({ op: "analisar", ...f, nicho, caminho, mime: arquivo?.type ?? null });
      aoSalvar(j.salvo);
      setF({ ...f, link: "", diasNoAr: "", versoes: "", texto: "", observacao: "" });
      setArquivo(null);
      setAberto(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  const campo = "min-h-10 w-full rounded-lg border border-borda bg-fundo px-3 text-sm";
  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className="w-full rounded-2xl border border-dashed border-destaque/60 bg-destaque-bg/20 p-4 text-left text-sm hover:bg-destaque-bg/40">
        <b>✦ Analisar um anúncio que você achou</b> <span className="text-texto-3">· envie o vídeo ou o print e a IA diz por que funciona e como adaptar para o seu cliente</span>
      </button>
    );
  }
  return (
    <form onSubmit={analisar} className="space-y-3 rounded-2xl border border-destaque/50 bg-superficie p-4 text-sm">
      <div className="flex items-center justify-between"><b>✦ Analisar um anúncio que você achou</b>
        <button type="button" onClick={() => setAberto(false)} className="text-xs text-texto-3 underline">fechar</button></div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1"><span className="text-xs text-texto-3">Link do anúncio (Biblioteca, post…)</span>
          <input value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="https://www.facebook.com/ads/library/?id=…" className={campo} /></label>
        <label className="space-y-1"><span className="text-xs text-texto-3">Vídeo ou print do anúncio</span>
          <input type="file" accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} className="block w-full text-sm" /></label>
        <label className="space-y-1"><span className="text-xs text-texto-3">Adaptar para o cliente (opcional)</span>
          <select value={f.clienteId} onChange={(e) => setF({ ...f, clienteId: e.target.value })} className={campo}>
            <option value="">Só o nicho</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.nicho ? ` · ${c.nicho}` : ""}</option>)}
          </select></label>
        <label className="space-y-1"><span className="text-xs text-texto-3">Nicho</span>
          <input list="nichos-radar" value={f.nicho} onChange={(e) => setF({ ...f, nicho: e.target.value })} className={campo} />
          <datalist id="nichos-radar">{nichos.map((n) => <option key={n} value={n} />)}</datalist></label>
        <label className="space-y-1"><span className="text-xs text-texto-3">Há quantos dias está no ar? (opcional)</span>
          <input type="number" min={0} value={f.diasNoAr} onChange={(e) => setF({ ...f, diasNoAr: e.target.value })} placeholder="ex.: 45" className={campo} /></label>
        <label className="space-y-1"><span className="text-xs text-texto-3">Quantos anúncios usam esse criativo? (opcional)</span>
          <input type="number" min={0} value={f.versoes} onChange={(e) => setF({ ...f, versoes: e.target.value })} placeholder="ex.: 6" className={campo} /></label>
      </div>
      <label className="block space-y-1"><span className="text-xs text-texto-3">Texto do anúncio (opcional, cole aqui)</span>
        <textarea value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} rows={2} className="w-full rounded-lg border border-borda bg-fundo px-3 py-2 text-sm" /></label>
      {erro && <p className="text-critico">{erro}</p>}
      <button disabled={!!ocupado} className="rounded-[10px] bg-destaque px-4 py-2 font-semibold text-white disabled:opacity-60">{ocupado ?? "Analisar"}</button>
    </form>
  );
}

function Salvos({ salvos, hoje, aoExcluir }: { salvos: AnuncioSalvo[]; hoje: string; aoExcluir: (id: string) => void }) {
  const [aberto, setAberto] = useState<string | null>(salvos[0]?.id ?? null);
  const [tarefa, setTarefa] = useState<Record<string, boolean>>({});
  if (!salvos.length) return null;
  async function excluir(id: string) {
    if (!confirm("Apagar esta análise?")) return;
    await chamar({ op: "excluir", id }).catch(() => null);
    aoExcluir(id);
  }
  async function virarTarefa(s: AnuncioSalvo) {
    setTarefa((t) => ({ ...t, [s.id]: true }));
    await fetch("/api/tarefas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "criar", texto: `Criar criativo inspirado no radar: ${s.analise.resumo}`.slice(0, 280), clienteId: s.clienteId ?? "", data: hoje }),
    }).catch(() => setTarefa((t) => ({ ...t, [s.id]: false })));
  }
  return (
    <section className="space-y-2">
      <h2 className="font-bold">Anúncios analisados <span className="text-sm font-normal text-texto-3">· {salvos.length}</span></h2>
      {salvos.map((s) => (
        <div key={s.id} className="rounded-xl border border-borda bg-superficie p-3 text-sm">
          <button type="button" onClick={() => setAberto(aberto === s.id ? null : s.id)} className="flex w-full items-start gap-2 text-left">
            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${corNota(s.analise.nota)}`}>{s.analise.nota}/10</span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2">{s.analise.resumo}</span>
              <span className="text-xs text-texto-3">{s.nicho}{s.clienteNome ? ` · para ${s.clienteNome}` : ""} · {s.formato === "video" ? "vídeo" : "imagem"}{s.diasNoAr != null ? ` · ${s.diasNoAr} dias no ar` : ""}{s.versoes != null ? ` · ${s.versoes} versões` : ""} · {new Date(s.criadoEm).toLocaleDateString("pt-BR")}</span>
            </span>
          </button>
          {aberto === s.id && (
            <div className="mt-3 space-y-3 border-t border-borda pt-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div><h3 className="text-xs font-semibold text-bom">Por que funciona</h3><ul className="list-disc space-y-0.5 pl-5 text-texto-2">{s.analise.porQueFunciona.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                <div><h3 className="text-xs font-semibold text-destaque">Como adaptar</h3><ul className="list-disc space-y-0.5 pl-5 text-texto-2">{s.analise.comoAdaptar.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
              </div>
              <p className="text-texto-2"><b>Gancho:</b> {s.analise.gancho}</p>
              <p className="text-texto-2"><b>Estrutura:</b> {s.analise.estrutura}</p>
              <p className="text-texto-2"><b>Oferta:</b> {s.analise.oferta}</p>
              {s.analise.sinais && <p className="text-texto-2"><b>Sinais:</b> {s.analise.sinais}</p>}
              {s.analise.roteiro && <div><h3 className="text-xs font-semibold">Ideia de roteiro adaptado</h3><p className="whitespace-pre-line rounded-lg bg-fundo p-3 text-texto-2">{s.analise.roteiro}</p></div>}
              <div className="flex flex-wrap gap-2">
                {s.link && <a href={s.link} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-borda px-3 py-1.5 text-xs hover:border-destaque">Abrir o anúncio ↗</a>}
                <button type="button" disabled={tarefa[s.id]} onClick={() => virarTarefa(s)} className="rounded-lg border border-borda px-3 py-1.5 text-xs hover:border-destaque disabled:opacity-60">{tarefa[s.id] ? "✓ Virou tarefa" : "+ Tarefa: criar criativo inspirado"}</button>
                <button type="button" onClick={() => excluir(s.id)} className="rounded-lg border border-borda px-3 py-1.5 text-xs text-critico">Apagar</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
