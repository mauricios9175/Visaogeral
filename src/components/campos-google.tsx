"use client";

import { useEffect, useState } from "react";
import {
  escreverPalavras, LANCES, lerPalavras, LIMITES, type ConfigGoogle, type LanceGoogle, type LocalGoogle,
} from "@/lib/modelos-google";
import { campo } from "./campos-meta";

const rotulo = "block space-y-1 text-sm";

/** Textarea de palavras-chave no formato do Google Ads (mantém o que a pessoa digita e só interpreta). */
function CampoPalavras({ valor, onChange, linhas = 6, placeholder }: {
  valor: ConfigGoogle["negativas"]; onChange: (v: ConfigGoogle["negativas"]) => void; linhas?: number; placeholder?: string;
}) {
  const [texto, setTexto] = useState(() => escreverPalavras(valor));
  // valor trocado de fora (modelo, esboço da IA): reescreve o texto
  const [ultimo, setUltimo] = useState(valor);
  if (valor !== ultimo) {
    setUltimo(valor);
    if (escreverPalavras(lerPalavras(texto)) !== escreverPalavras(valor)) setTexto(escreverPalavras(valor));
  }
  return (
    <textarea
      rows={linhas} value={texto} placeholder={placeholder}
      onChange={(e) => { setTexto(e.target.value); const v = lerPalavras(e.target.value); setUltimo(v); onChange(v); }}
      className={`${campo} font-mono text-[13px]`}
    />
  );
}

/** Lista de textos com contador de caracteres (títulos e descrições do anúncio responsivo). */
function Textos({ titulo, valor, limite, max, min, onChange }: {
  titulo: string; valor: string[]; limite: number; max: number; min: number; onChange: (v: string[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm">{titulo} <span className="text-xs text-texto-3">(mín. {min}, máx. {max}, até {limite} caracteres)</span></div>
      {valor.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <input value={t} onChange={(e) => onChange(valor.map((x, j) => (j === i ? e.target.value : x)))} className={campo} />
          <span className={`w-12 shrink-0 text-right text-xs ${t.length > limite ? "font-bold text-critico" : "text-texto-3"}`}>{t.length}/{limite}</span>
          {valor.length > min && (
            <button type="button" onClick={() => onChange(valor.filter((_, j) => j !== i))} className="text-xs text-texto-3 hover:text-critico" aria-label="Remover">✕</button>
          )}
        </div>
      ))}
      {valor.length < max && (
        <button type="button" onClick={() => onChange([...valor, ""])} className="text-xs text-destaque hover:underline">+ adicionar</button>
      )}
    </div>
  );
}

/** Busca de locais do Google (cidade, estado, país). */
function BuscaLocal({ conta, onEscolher }: { conta?: string; onEscolher: (l: LocalGoogle) => void }) {
  const [q, setQ] = useState("");
  const [itens, setItens] = useState<LocalGoogle[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      fetch(`/api/google/locais?q=${encodeURIComponent(q)}${conta ? `&conta=${conta}` : ""}`).then((r) => r.json())
        .then((j) => { setItens(j.itens ?? []); setErro(j.erro ?? null); })
        .catch(() => setErro("Falha na busca."));
    }, 350);
    return () => clearTimeout(t);
  }, [q, conta]);
  return (
    <div className="relative">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cidade, estado ou país…" className={campo} />
      {erro && <p className="mt-1 text-xs text-critico">{erro}</p>}
      {q.trim().length >= 2 && itens.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-borda bg-superficie text-sm shadow-lg">
          {itens.map((l) => (
            <li key={l.id}>
              <button type="button" onClick={() => { onEscolher(l); setQ(""); setItens([]); }} className="w-full px-3 py-2 text-left hover:bg-superficie-2">
                {l.nome} <span className="text-xs text-texto-3">{l.tipo}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Campos de uma campanha de Pesquisa do Google (modelo ou montagem). */
export function CamposGoogle({ valor, onChange, conta }: { valor: ConfigGoogle; onChange: (v: ConfigGoogle) => void; conta?: string }) {
  const set = <K extends keyof ConfigGoogle>(k: K, v: ConfigGoogle[K]) => onChange({ ...valor, [k]: v });
  const grupo = (i: number, g: Partial<ConfigGoogle["grupos"][number]>) => set("grupos", valor.grupos.map((x, j) => (j === i ? { ...x, ...g } : x)));
  const secao = "space-y-3 rounded-xl border border-borda p-3";
  return (
    <div className="space-y-4">
      <section className={secao}>
        <h3 className="text-sm font-semibold">Campanha</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={rotulo}>Nome da campanha <span className="text-xs text-texto-3">({"{cliente}"}, {"{data}"}, {"{cidade}"})</span>
            <input value={valor.nomeCampanha} onChange={(e) => set("nomeCampanha", e.target.value)} className={campo} />
          </label>
          <label className={rotulo}>Orçamento diário (R$)
            <input type="number" min={1} step="any" value={valor.orcamentoDiario} onChange={(e) => set("orcamentoDiario", Number(e.target.value))} className={campo} />
          </label>
          <label className={rotulo}>Estratégia de lance
            <select value={valor.lance} onChange={(e) => set("lance", e.target.value as LanceGoogle)} className={campo}>
              {(Object.keys(LANCES) as LanceGoogle[]).map((l) => <option key={l} value={l}>{LANCES[l]}</option>)}
            </select>
          </label>
          {valor.lance === "cpa_desejado" && (
            <label className={rotulo}>CPA desejado (R$)
              <input type="number" min={0} step="any" value={valor.cpaDesejado} onChange={(e) => set("cpaDesejado", Number(e.target.value))} className={campo} />
            </label>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={valor.parceiros} onChange={(e) => set("parceiros", e.target.checked)} />
          Incluir parceiros de pesquisa do Google <span className="text-xs text-texto-3">(a Rede de Display fica sempre desligada)</span>
        </label>
        <div className="space-y-1.5">
          <div className="text-sm">Locais <span className="text-xs text-texto-3">(só quem está no local; idioma português)</span></div>
          <BuscaLocal conta={conta} onEscolher={(l) => !valor.locais.some((x) => x.id === l.id) && set("locais", [...valor.locais, l])} />
          {valor.locais.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {valor.locais.map((l) => (
                <span key={l.id} className="inline-flex items-center gap-1 rounded-full bg-superficie-2 px-2.5 py-1 text-xs">
                  {l.nome}
                  <button type="button" onClick={() => set("locais", valor.locais.filter((x) => x.id !== l.id))} className="text-texto-3 hover:text-critico" aria-label={`Remover ${l.nome}`}>✕</button>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className={secao}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Grupos de anúncios e palavras-chave</h3>
          <span className="text-xs text-texto-3">Uma por linha: sem nada = ampla · &quot;entre aspas&quot; = frase · [entre colchetes] = exata</span>
        </div>
        {valor.grupos.map((g, i) => (
          <div key={i} className="space-y-2 rounded-lg bg-superficie-2 p-3">
            <div className="flex items-center gap-2">
              <input value={g.nome} onChange={(e) => grupo(i, { nome: e.target.value })} placeholder="Nome do grupo" className={`${campo} font-semibold`} />
              <span className="shrink-0 text-xs text-texto-3">{g.palavras.length} palavra(s)</span>
              {valor.grupos.length > 1 && (
                <button type="button" onClick={() => set("grupos", valor.grupos.filter((_, j) => j !== i))} className="shrink-0 text-xs text-texto-3 hover:text-critico">Remover</button>
              )}
            </div>
            <CampoPalavras valor={g.palavras} onChange={(p) => grupo(i, { palavras: p })} placeholder={'"loja de celular"\n[conserto de iphone]\ncelular seminovo'} />
          </div>
        ))}
        <button type="button" onClick={() => set("grupos", [...valor.grupos, { nome: `Grupo ${valor.grupos.length + 1}`, palavras: [] }])} className="text-sm text-destaque hover:underline">
          + adicionar grupo
        </button>
        <div className="space-y-1">
          <div className="text-sm">Palavras negativas da campanha</div>
          <CampoPalavras valor={valor.negativas} onChange={(p) => set("negativas", p)} linhas={4} placeholder={"grátis\nvagas\ncurso"} />
        </div>
      </section>

      <section className={secao}>
        <h3 className="text-sm font-semibold">Anúncio responsivo <span className="font-normal text-texto-3">(o mesmo em todos os grupos)</span></h3>
        <label className={rotulo}>Link do site
          <input value={valor.url} onChange={(e) => set("url", e.target.value)} placeholder="https://www.site.com.br" className={campo} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={rotulo}>Caminho 1 <span className="text-xs text-texto-3">({valor.caminho1.length}/{LIMITES.caminho})</span>
            <input value={valor.caminho1} maxLength={LIMITES.caminho} onChange={(e) => set("caminho1", e.target.value)} placeholder="celulares" className={campo} />
          </label>
          <label className={rotulo}>Caminho 2 <span className="text-xs text-texto-3">({valor.caminho2.length}/{LIMITES.caminho})</span>
            <input value={valor.caminho2} maxLength={LIMITES.caminho} onChange={(e) => set("caminho2", e.target.value)} placeholder="iphone" className={campo} />
          </label>
        </div>
        <Textos titulo="Títulos" valor={valor.titulos} limite={LIMITES.titulo} max={LIMITES.titulos} min={3} onChange={(v) => set("titulos", v)} />
        <Textos titulo="Descrições" valor={valor.descricoes} limite={LIMITES.descricao} max={LIMITES.descricoes} min={2} onChange={(v) => set("descricoes", v)} />
        <label className={rotulo}>Parâmetros de URL <span className="text-xs text-texto-3">({"{campanha}"} e {"{grupo}"} viram os nomes; {"{keyword}"} é a palavra pesquisada)</span>
          <input value={valor.parametrosUrl} onChange={(e) => set("parametrosUrl", e.target.value)} className={`${campo} font-mono text-[13px]`} />
        </label>
      </section>
    </div>
  );
}
