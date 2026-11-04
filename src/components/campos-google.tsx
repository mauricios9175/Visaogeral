"use client";

import { useEffect, useState } from "react";
import {
  escreverPalavras, grupoVazio, LANCES, lerPalavras, LIMITES, TIPOS_GOOGLE,
  type ConfigGoogle, type GrupoGoogle, type LanceGoogle, type LocalGoogle, type Sitelink, type TipoGoogle,
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

const secao = "space-y-3 rounded-xl border border-borda p-3";

/** Campos do grupo de anúncios de Pesquisa: palavras-chave e o anúncio responsivo dele. */
function Grupo({ g, i, total, urlCampanha, onChange, onRemover, onCopiarTextos }: {
  g: GrupoGoogle; i: number; total: number; urlCampanha: string;
  onChange: (g: Partial<GrupoGoogle>) => void; onRemover: () => void; onCopiarTextos?: () => void;
}) {
  return (
    <div className="space-y-3 rounded-lg bg-superficie-2 p-3">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs font-bold text-texto-3">{i + 1}.</span>
        <input value={g.nome} onChange={(e) => onChange({ nome: e.target.value })} placeholder="Nome do grupo" className={`${campo} font-semibold`} />
        {total > 1 && <button type="button" onClick={onRemover} className="shrink-0 text-xs text-texto-3 hover:text-critico">Remover grupo</button>}
      </div>
      <div className="space-y-1">
        <div className="text-xs text-texto-2">Palavras-chave ({g.palavras.length}) · sem nada = ampla · &quot;aspas&quot; = frase · [colchetes] = exata</div>
        <CampoPalavras valor={g.palavras} onChange={(p) => onChange({ palavras: p })} placeholder={'"loja de celular"\n[conserto de iphone]\ncelular seminovo'} />
      </div>
      <div className="space-y-3 rounded-lg border border-borda p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">Anúncio deste grupo</div>
          {onCopiarTextos && <button type="button" onClick={onCopiarTextos} className="text-xs text-destaque hover:underline">copiar títulos e descrições do grupo 1</button>}
        </div>
        <Textos titulo="Títulos" valor={g.titulos} limite={LIMITES.titulo} max={LIMITES.titulos} min={3} onChange={(v) => onChange({ titulos: v })} />
        <Textos titulo="Descrições" valor={g.descricoes} limite={LIMITES.descricao} max={LIMITES.descricoes} min={2} onChange={(v) => onChange({ descricoes: v })} />
        <div className="grid gap-2 sm:grid-cols-3">
          <label className={rotulo}><span className="text-xs">Link próprio (opcional)</span>
            <input value={g.url} onChange={(e) => onChange({ url: e.target.value })} placeholder={urlCampanha || "https://…"} className={campo} />
          </label>
          <label className={rotulo}><span className="text-xs">Caminho 1 ({g.caminho1.length}/{LIMITES.caminho})</span>
            <input value={g.caminho1} maxLength={LIMITES.caminho} onChange={(e) => onChange({ caminho1: e.target.value })} placeholder="o da campanha" className={campo} />
          </label>
          <label className={rotulo}><span className="text-xs">Caminho 2 ({g.caminho2.length}/{LIMITES.caminho})</span>
            <input value={g.caminho2} maxLength={LIMITES.caminho} onChange={(e) => onChange({ caminho2: e.target.value })} className={campo} />
          </label>
        </div>
      </div>
    </div>
  );
}

/** Sitelinks e frases de destaque (valem para Pesquisa e Performance Max). */
function Extensoes({ valor, set }: { valor: ConfigGoogle; set: <K extends keyof ConfigGoogle>(k: K, v: ConfigGoogle[K]) => void }) {
  const sl = (i: number, x: Partial<Sitelink>) => set("sitelinks", valor.sitelinks.map((s, j) => (j === i ? { ...s, ...x } : s)));
  const cont = (t: string, lim: number) => <span className={`text-[11px] ${t.length > lim ? "font-bold text-critico" : "text-texto-3"}`}>{t.length}/{lim}</span>;
  return (
    <section className={secao}>
      <h3 className="text-sm font-semibold">Sitelinks e frases de destaque <span className="font-normal text-texto-3">(opcionais, recomendados: 4 sitelinks e 4 frases)</span></h3>
      <div className="space-y-2">
        {valor.sitelinks.map((s, i) => (
          <div key={i} className="grid gap-2 rounded-lg bg-superficie-2 p-2 sm:grid-cols-[1fr_1fr_1fr_1.3fr_auto]">
            <label className="text-xs text-texto-2">Texto {cont(s.texto, LIMITES.sitelinkTexto)}<input value={s.texto} onChange={(e) => sl(i, { texto: e.target.value })} placeholder="Fale no WhatsApp" className={campo} /></label>
            <label className="text-xs text-texto-2">Descrição 1 {cont(s.descricao1, LIMITES.sitelinkDescricao)}<input value={s.descricao1} onChange={(e) => sl(i, { descricao1: e.target.value })} className={campo} /></label>
            <label className="text-xs text-texto-2">Descrição 2 {cont(s.descricao2, LIMITES.sitelinkDescricao)}<input value={s.descricao2} onChange={(e) => sl(i, { descricao2: e.target.value })} className={campo} /></label>
            <label className="text-xs text-texto-2">Link<input value={s.url} onChange={(e) => sl(i, { url: e.target.value })} placeholder={valor.url || "https://…"} className={campo} /></label>
            <button type="button" onClick={() => set("sitelinks", valor.sitelinks.filter((_, j) => j !== i))} className="self-end pb-2 text-xs text-texto-3 hover:text-critico" aria-label="Remover sitelink">✕</button>
          </div>
        ))}
        {valor.sitelinks.length < LIMITES.sitelinks && (
          <button type="button" onClick={() => set("sitelinks", [...valor.sitelinks, { texto: "", descricao1: "", descricao2: "", url: "" }])} className="text-xs text-destaque hover:underline">+ sitelink</button>
        )}
        <p className="text-[11px] text-texto-3">Link vazio = o link da campanha. As descrições são opcionais (as duas ou nenhuma).</p>
      </div>
      <Textos titulo="Frases de destaque" valor={valor.frases} limite={LIMITES.frase} max={LIMITES.frases} min={0} onChange={(v) => set("frases", v)} />
    </section>
  );
}

/** Campos de uma campanha do Google (modelo ou montagem): Pesquisa (grupos com anúncio próprio) ou Performance Max. */
export function CamposGoogle({ valor, onChange, conta, imagens }: {
  valor: ConfigGoogle; onChange: (v: ConfigGoogle) => void; conta?: string;
  /** só na montagem: o seletor de imagens da Performance Max */
  imagens?: React.ReactNode;
}) {
  const set = <K extends keyof ConfigGoogle>(k: K, v: ConfigGoogle[K]) => onChange({ ...valor, [k]: v });
  const grupo = (i: number, g: Partial<GrupoGoogle>) => set("grupos", valor.grupos.map((x, j) => (j === i ? { ...x, ...g } : x)));
  const pm = valor.pmax;
  const setPm = (x: Partial<ConfigGoogle["pmax"]>) => set("pmax", { ...pm, ...x });
  const pmax = valor.tipo === "pmax";
  return (
    <div className="space-y-4">
      <section className={secao}>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(TIPOS_GOOGLE) as TipoGoogle[]).map((t) => (
            <button key={t} type="button" onClick={() => onChange({ ...valor, tipo: t, lance: t === "pmax" && valor.lance === "maximizar_cliques" ? "maximizar_conversoes" : valor.lance, nomeCampanha: valor.nomeCampanha.replace(/^\[(Pesquisa|PMax)\]/, t === "pmax" ? "[PMax]" : "[Pesquisa]") })}
              className={`rounded-[10px] border px-3 py-2 text-left text-sm ${valor.tipo === t ? "border-destaque bg-destaque-bg font-semibold" : "border-borda text-texto-2 hover:text-texto"}`}>
              {TIPOS_GOOGLE[t].rotulo}<span className="block text-[11px] font-normal text-texto-3">{TIPOS_GOOGLE[t].descricao}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={rotulo}>Nome da campanha <span className="text-xs text-texto-3">({"{cliente}"}, {"{data}"}, {"{cidade}"})</span>
            <input value={valor.nomeCampanha} onChange={(e) => set("nomeCampanha", e.target.value)} className={campo} />
          </label>
          <label className={rotulo}>Orçamento diário (R$)
            <input type="number" min={1} step="any" value={valor.orcamentoDiario} onChange={(e) => set("orcamentoDiario", Number(e.target.value))} className={campo} />
          </label>
          <label className={rotulo}>Estratégia de lance
            <select value={valor.lance} onChange={(e) => set("lance", e.target.value as LanceGoogle)} className={campo}>
              {(Object.keys(LANCES) as LanceGoogle[]).filter((l) => !pmax || l !== "maximizar_cliques").map((l) => <option key={l} value={l}>{LANCES[l]}</option>)}
            </select>
          </label>
          {valor.lance === "cpa_desejado" && (
            <label className={rotulo}>CPA desejado (R$)
              <input type="number" min={0} step="any" value={valor.cpaDesejado} onChange={(e) => set("cpaDesejado", Number(e.target.value))} className={campo} />
            </label>
          )}
          <label className={rotulo}>Link do site {pmax ? "" : <span className="text-xs text-texto-3">(padrão dos grupos)</span>}
            <input value={valor.url} onChange={(e) => set("url", e.target.value)} placeholder="https://www.site.com.br" className={campo} />
          </label>
          {!pmax && (
            <div className="grid grid-cols-2 gap-2">
              <label className={rotulo}><span className="text-sm">Caminho 1 <span className="text-xs text-texto-3">({valor.caminho1.length}/{LIMITES.caminho})</span></span>
                <input value={valor.caminho1} maxLength={LIMITES.caminho} onChange={(e) => set("caminho1", e.target.value)} placeholder="celulares" className={campo} />
              </label>
              <label className={rotulo}><span className="text-sm">Caminho 2 <span className="text-xs text-texto-3">({valor.caminho2.length}/{LIMITES.caminho})</span></span>
                <input value={valor.caminho2} maxLength={LIMITES.caminho} onChange={(e) => set("caminho2", e.target.value)} placeholder="iphone" className={campo} />
              </label>
            </div>
          )}
        </div>
        {!pmax && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={valor.parceiros} onChange={(e) => set("parceiros", e.target.checked)} />
            Incluir parceiros de pesquisa do Google <span className="text-xs text-texto-3">(a Rede de Display fica sempre desligada)</span>
          </label>
        )}
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

      {!pmax ? (
        <section className={secao}>
          <div>
            <h3 className="text-sm font-semibold">Grupos de anúncios</h3>
            <p className="text-xs text-texto-3">Cada grupo tem as suas palavras-chave e o seu anúncio, com títulos que conversam com essas palavras.</p>
          </div>
          {valor.grupos.map((g, i) => (
            <Grupo
              key={i} g={g} i={i} total={valor.grupos.length} urlCampanha={valor.url}
              onChange={(x) => grupo(i, x)} onRemover={() => set("grupos", valor.grupos.filter((_, j) => j !== i))}
              onCopiarTextos={i > 0 ? () => grupo(i, { titulos: [...valor.grupos[0].titulos], descricoes: [...valor.grupos[0].descricoes] }) : undefined}
            />
          ))}
          <button type="button" onClick={() => set("grupos", [...valor.grupos, grupoVazio(`Grupo ${valor.grupos.length + 1}`)])} className="text-sm text-destaque hover:underline">
            + adicionar grupo
          </button>
          <div className="space-y-1">
            <div className="text-sm">Palavras negativas da campanha</div>
            <CampoPalavras valor={valor.negativas} onChange={(p) => set("negativas", p)} linhas={4} placeholder={"grátis\nvagas\ncurso"} />
          </div>
        </section>
      ) : (
        <section className={secao}>
          <div>
            <h3 className="text-sm font-semibold">Grupo de recursos</h3>
            <p className="text-xs text-texto-3">O Google combina esses textos e imagens nos anúncios de Pesquisa, YouTube, Display, Discover, Gmail e Maps.</p>
          </div>
          <label className={rotulo}>Nome da empresa <span className="text-xs text-texto-3">({pm.nomeEmpresa.length}/{LIMITES.nomeEmpresa})</span>
            <input value={pm.nomeEmpresa} onChange={(e) => setPm({ nomeEmpresa: e.target.value })} className={campo} />
          </label>
          <Textos titulo="Títulos" valor={pm.titulos} limite={LIMITES.titulo} max={LIMITES.titulos} min={3} onChange={(v) => setPm({ titulos: v })} />
          <Textos titulo="Títulos longos" valor={pm.titulosLongos} limite={LIMITES.tituloLongo} max={LIMITES.titulosLongos} min={1} onChange={(v) => setPm({ titulosLongos: v })} />
          <Textos titulo={`Descrições (uma com até ${LIMITES.descricaoCurta})`} valor={pm.descricoes} limite={LIMITES.descricao} max={LIMITES.descricoesPmax} min={2} onChange={(v) => setPm({ descricoes: v })} />
          <label className={rotulo}>Temas de pesquisa <span className="text-xs text-texto-3">(sinal para o Google: o que o seu cliente pesquisa, um por linha, até {LIMITES.temas})</span>
            <textarea rows={4} value={pm.temas.join("\n")} onChange={(e) => setPm({ temas: e.target.value.split("\n").slice(0, LIMITES.temas) })} className={campo} placeholder={"loja de celular\niphone seminovo"} />
          </label>
          {imagens ?? <p className="text-xs text-texto-3">As imagens (logo, paisagem e quadrada) são escolhidas na hora de montar a campanha do cliente.</p>}
        </section>
      )}

      <Extensoes valor={valor} set={set} />

      <section className={secao}>
        <label className={rotulo}>Parâmetros de URL <span className="text-xs text-texto-3">({"{campanha}"} e {"{grupo}"} viram os nomes; {"{keyword}"} é a palavra pesquisada)</span>
          <input value={valor.parametrosUrl} onChange={(e) => set("parametrosUrl", e.target.value)} className={`${campo} font-mono text-[13px]`} />
        </label>
      </section>
    </div>
  );
}
