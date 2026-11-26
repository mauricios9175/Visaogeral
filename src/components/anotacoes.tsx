"use client";

import { useMemo, useState } from "react";
import type { Anotacao } from "@/lib/anotacoes";
import type { LinkFicha } from "@/lib/ficha";

const PARECE_SENHA = /\b(senha|password|pass|pwd)\b\s*[:=-]?\s*\S{4,}/i;
const caixa = "w-full rounded-[10px] border border-borda bg-fundo px-3 py-2 text-sm outline-none focus:border-destaque";
const botao = "rounded-lg border border-borda px-2.5 py-1 text-xs text-texto-2 hover:border-destaque hover:text-texto";

/** Texto com os endereços (http…) clicáveis. */
function TextoComLinks({ texto }: { texto: string }) {
  const partes = texto.split(/(https?:\/\/[^\s<>()]+[^\s<>().,;:!?"'])/g);
  return (
    <>
      {partes.map((p, i) => (i % 2
        ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="break-all text-destaque underline">{p}</a>
        : <span key={i}>{p}</span>))}
    </>
  );
}

/**
 * Anotações gerais, como os cartões do Trello que não eram de nenhum cliente: título, texto, links e uma lista.
 * Busca no topo; fixadas primeiro; cada lista vira um filtro.
 */
export function Anotacoes({ inicial }: { inicial: Anotacao[] }) {
  const [notas, setNotas] = useState(inicial);
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null); // id, ou "nova"
  const [erro, setErro] = useState<string | null>(null);

  const listas = useMemo(() => [...new Set(notas.map((n) => n.lista))].sort((a, b) => a.localeCompare(b, "pt-BR")), [notas]);
  const termo = busca.trim().toLowerCase();
  const visiveis = notas
    .filter((n) => !lista || n.lista === lista)
    .filter((n) => !termo || [n.titulo, n.texto, n.lista, ...n.links.flatMap((l) => [l.rotulo, l.url])].join(" ").toLowerCase().includes(termo))
    .sort((a, b) => Number(!!b.fixada) - Number(!!a.fixada) || b.atualizadaEm.localeCompare(a.atualizadaEm));

  async function enviar(corpo: object) {
    setErro(null);
    try {
      const r = await fetch("/api/anotacoes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = await r.json().catch(() => ({ erro: `erro ${r.status}` }));
      if (!r.ok || j.erro) throw new Error(j.erro ?? `erro ${r.status}`);
      setNotas(j.anotacoes);
      return true;
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      return false;
    }
  }
  const salvar = async (a: Partial<Anotacao>) => { if (await enviar({ op: "salvar", anotacao: a })) setEditando(null); };
  const excluir = (a: Anotacao) => { if (confirm(`Apagar a anotação “${a.titulo || "sem título"}”?`)) enviar({ op: "excluir", id: a.id }); };

  const chip = (sel: boolean) => `rounded-full border px-3 py-1.5 text-sm ${sel ? "border-destaque bg-destaque-bg font-semibold text-texto" : "border-borda text-texto-2 hover:text-texto"}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nas anotações…" aria-label="Buscar nas anotações"
          className="min-h-10 min-w-0 flex-1 rounded-[10px] border border-borda bg-fundo px-3 text-sm outline-none focus:border-destaque" />
        <button type="button" onClick={() => setEditando("nova")} className="min-h-10 shrink-0 rounded-[10px] bg-destaque px-4 text-sm font-semibold text-white">
          + Nova anotação
        </button>
      </div>
      {listas.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setLista(null)} className={chip(lista === null)}>Todas <span className="text-texto-3">{notas.length}</span></button>
          {listas.map((l) => (
            <button key={l} type="button" onClick={() => setLista(l)} className={chip(lista === l)}>
              {l} <span className="text-texto-3">{notas.filter((n) => n.lista === l).length}</span>
            </button>
          ))}
        </div>
      )}
      {erro && <p className="text-sm text-critico">{erro}</p>}

      {editando === "nova" && (
        <Editor inicial={{ lista: lista ?? "" }} listas={listas} salvar={salvar} cancelar={() => setEditando(null)} />
      )}

      {!visiveis.length && editando !== "nova" && (
        <p className="rounded-2xl border border-dashed border-borda p-6 text-center text-sm text-texto-3">
          {notas.length ? "Nada encontrado." : "Nenhuma anotação ainda. Guarde aqui links úteis, processos, ideias, contatos de fornecedores… tudo o que não é de um cliente."}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {visiveis.map((n) => (editando === n.id
          ? <div key={n.id} className="sm:col-span-2"><Editor inicial={n} listas={listas} salvar={salvar} cancelar={() => setEditando(null)} excluir={() => excluir(n)} /></div>
          : <Cartao key={n.id} n={n} editar={() => setEditando(n.id)} fixar={() => enviar({ op: "salvar", anotacao: { id: n.id, fixada: !n.fixada } })} />))}
      </div>
    </div>
  );
}

function Cartao({ n, editar, fixar }: { n: Anotacao; editar: () => void; fixar: () => void }) {
  const [aberto, setAberto] = useState(false);
  const longo = n.texto.length > 400 || n.texto.split("\n").length > 8;
  return (
    <article className={`flex flex-col gap-2 rounded-2xl border bg-superficie p-4 ${n.fixada ? "border-destaque/50" : "border-borda"}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold leading-snug">{n.titulo || <span className="text-texto-3">Sem título</span>}</h2>
          <span className="text-xs text-texto-3">{n.lista}</span>
        </div>
        <button type="button" onClick={fixar} title={n.fixada ? "Desafixar" : "Fixar no topo"} aria-pressed={!!n.fixada}
          className={`shrink-0 rounded-md px-1.5 py-0.5 text-sm ${n.fixada ? "text-destaque" : "text-texto-3 hover:text-texto"}`}>
          {n.fixada ? "★" : "☆"}
        </button>
        <button type="button" onClick={editar} className={`${botao} shrink-0`}>Editar</button>
      </div>
      {n.texto.trim() && (
        <div className={`whitespace-pre-wrap break-words text-sm leading-relaxed text-texto-2 ${longo && !aberto ? "line-clamp-8" : ""}`}>
          <TextoComLinks texto={n.texto} />
        </div>
      )}
      {longo && (
        <button type="button" onClick={() => setAberto((x) => !x)} className="self-start text-xs text-destaque underline">
          {aberto ? "Mostrar menos" : "Mostrar tudo"}
        </button>
      )}
      {n.links.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {n.links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" title={l.url}
              className="rounded-md border border-borda px-2 py-1 text-texto-2 hover:border-destaque hover:text-texto">{l.rotulo} ↗</a>
          ))}
        </div>
      )}
    </article>
  );
}

function Editor({ inicial, listas, salvar, cancelar, excluir }: {
  inicial: Partial<Anotacao>; listas: string[];
  salvar: (a: Partial<Anotacao>) => Promise<void>; cancelar: () => void; excluir?: () => void;
}) {
  const [titulo, setTitulo] = useState(inicial.titulo ?? "");
  const [texto, setTexto] = useState(inicial.texto ?? "");
  const [lista, setLista] = useState(inicial.lista ?? "");
  const [links, setLinks] = useState<LinkFicha[]>(inicial.links ?? []);
  const [novo, setNovo] = useState({ rotulo: "", url: "" });
  const [mexendo, setMexendo] = useState<number | null>(null); // link sendo alterado (posição)
  const [salvando, setSalvando] = useState(false);

  // link digitado (novo ou alterado) e não confirmado ainda também vai junto ao salvar
  const comPendente = () => {
    let url = novo.url.trim();
    if (!url) return links;
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(url)) url = `https://${url}`;
    const link = { rotulo: novo.rotulo.trim(), url };
    return mexendo == null ? [...links, link] : links.map((l, i) => (i === mexendo ? link : l));
  };
  function adicionar() {
    setLinks(comPendente());
    setNovo({ rotulo: "", url: "" });
    setMexendo(null);
  }
  function alterar(i: number) {
    setMexendo(i);
    setNovo({ rotulo: links[i].rotulo, url: links[i].url });
  }
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    await salvar({ ...(inicial.id ? { id: inicial.id } : {}), titulo, texto, lista, links: comPendente() });
    setSalvando(false);
  }

  return (
    <form onSubmit={enviar} className="space-y-2 rounded-2xl border border-destaque/50 bg-superficie p-4">
      <div className="flex flex-wrap gap-2">
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título (ex.: Fornecedores de vídeo)" autoFocus
          className={`${caixa} min-w-0 flex-[2] font-semibold`} />
        <input value={lista} onChange={(e) => setLista(e.target.value)} placeholder="Lista (ex.: Links úteis)" list="listas-anotacoes"
          className={`${caixa} min-w-0 flex-1`} aria-label="Lista" />
        <datalist id="listas-anotacoes">{listas.map((l) => <option key={l} value={l} />)}</datalist>
      </div>
      <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={8} placeholder="Escreva à vontade. Links colados aqui ficam clicáveis."
        className={`${caixa} leading-relaxed`} />
      {PARECE_SENHA.test(texto) && (
        <p className="text-xs text-atencao">▲ Parece ter uma senha no texto. Prefira guardar só onde ela está (ex.: “no Bitwarden, pasta Agência”).</p>
      )}
      <div className="space-y-1.5">
        {links.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 text-xs">
            {links.map((l, i) => (
              <li key={l.url + i} className={`flex items-center gap-1 rounded-md border px-2 py-1 text-texto-2 ${mexendo === i ? "border-destaque" : "border-borda"}`}>
                <button type="button" onClick={() => alterar(i)} title={`${l.url}\nClique para alterar`} className="hover:text-texto">
                  {l.rotulo || l.url} <span className="text-texto-3">✎</span>
                </button>
                <button type="button" onClick={() => { setLinks(links.filter((_, j) => j !== i)); if (mexendo === i) { setMexendo(null); setNovo({ rotulo: "", url: "" }); } }}
                  className="text-texto-3 hover:text-critico" aria-label={`Tirar ${l.rotulo || l.url}`}>✕</button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <input value={novo.rotulo} onChange={(e) => setNovo({ ...novo, rotulo: e.target.value })} placeholder="Nome do link (opcional)" className={`${caixa} min-w-0 flex-1`} />
          <input value={novo.url} onChange={(e) => setNovo({ ...novo, url: e.target.value })} placeholder="Endereço (https://…)" className={`${caixa} min-w-0 flex-[2]`}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionar(); } }} />
          <button type="button" onClick={adicionar} disabled={!novo.url.trim()} className={`${botao} disabled:opacity-50`}>{mexendo == null ? "+ Link" : "Atualizar link"}</button>
          {mexendo != null && (
            <button type="button" onClick={() => { setMexendo(null); setNovo({ rotulo: "", url: "" }); }} className={botao}>Cancelar</button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button disabled={salvando} className="rounded-lg bg-destaque px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60">{salvando ? "Salvando…" : "Salvar"}</button>
        <button type="button" onClick={cancelar} className={botao}>Cancelar</button>
        {excluir && <button type="button" onClick={excluir} className={`${botao} ml-auto text-critico`}>Apagar</button>}
      </div>
    </form>
  );
}
