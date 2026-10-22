"use client";

import { useEffect, useRef, useState } from "react";
import { CTAS, type ConfigMeta, type Interesse, type Local, type ObjetivoMeta } from "@/lib/modelos";

export const campo = "w-full rounded-lg border border-borda bg-fundo px-2 py-1.5 text-sm outline-none focus:border-destaque";
const rotulo = "block space-y-1 text-sm";
const dica = "text-xs text-texto-3";

/** Busca no Meta (cidades/estados ou interesses) com sugestões enquanto digita. */
function Busca<T>({ tipo, conta, placeholder, onEscolher, rotuloItem }: {
  tipo: "local" | "interesse";
  conta?: string;
  placeholder: string;
  onEscolher: (item: T) => void;
  rotuloItem: (item: T) => string;
}) {
  const [termo, setTermo] = useState("");
  const [itens, setItens] = useState<T[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const relogio = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(relogio.current);
    if (termo.trim().length < 2) return;
    relogio.current = setTimeout(async () => {
      const qs = new URLSearchParams({ tipo, q: termo, ...(conta ? { conta } : {}) });
      const r = await fetch(`/api/meta/busca?${qs}`).then((x) => x.json()).catch(() => ({ itens: [], erro: "Falha na busca" }));
      setItens(r.itens ?? []);
      setErro(r.erro ?? null);
    }, 350);
    return () => clearTimeout(relogio.current);
  }, [termo, tipo, conta]);
  const mostrar = termo.trim().length >= 2;
  return (
    <div className="relative">
      <input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder={placeholder} className={campo} />
      {mostrar && (itens.length > 0 || erro) && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-borda bg-superficie text-sm shadow-lg">
          {erro && <li className="px-3 py-2 text-critico">{erro}</li>}
          {itens.map((it, i) => (
            <li key={i}>
              <button type="button" onClick={() => { onEscolher(it); setTermo(""); setItens([]); }} className="w-full px-3 py-1.5 text-left hover:bg-fundo">
                {rotuloItem(it)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chips<T>({ itens, texto, onRemover }: { itens: T[]; texto: (t: T) => string; onRemover: (i: number) => void }) {
  if (!itens.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {itens.map((t, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded-full bg-fundo px-2 py-0.5 text-xs ring-1 ring-borda">
          {texto(t)}
          <button type="button" onClick={() => onRemover(i)} className="text-texto-3 hover:text-critico" aria-label="Remover">×</button>
        </span>
      ))}
    </div>
  );
}

/** Lista de variações de texto (texto principal / títulos), até 5. */
function Variacoes({ valores, onChange, linhas, placeholder }: {
  valores: string[]; onChange: (v: string[]) => void; linhas: number; placeholder: string;
}) {
  return (
    <div className="space-y-1">
      {valores.map((v, i) => (
        <div key={i} className="flex gap-1">
          {linhas > 1 ? (
            <textarea rows={linhas} value={v} placeholder={placeholder} onChange={(e) => onChange(valores.map((x, j) => (j === i ? e.target.value : x)))} className={campo} />
          ) : (
            <input value={v} placeholder={placeholder} onChange={(e) => onChange(valores.map((x, j) => (j === i ? e.target.value : x)))} className={campo} />
          )}
          {valores.length > 1 && (
            <button type="button" onClick={() => onChange(valores.filter((_, j) => j !== i))} className="px-2 text-texto-3 hover:text-critico" aria-label="Remover">×</button>
          )}
        </div>
      ))}
      {valores.length < 5 && (
        <button type="button" onClick={() => onChange([...valores, ""])} className="text-xs text-destaque underline">+ variação</button>
      )}
    </div>
  );
}

const RAIOS = [0, 10, 15, 25, 40, 80];

/**
 * Campos de campanha, público e anúncio do Meta. Usado no editor de modelos e na montagem.
 * `conta` (opcional) é usada nas buscas; sem ela, a busca usa qualquer login conectado.
 */
export function CamposMeta({ objetivo, valor, onChange, conta, naMontagem = false }: {
  objetivo: ObjetivoMeta;
  valor: ConfigMeta;
  onChange: (v: ConfigMeta) => void;
  conta?: string;
  naMontagem?: boolean;
}) {
  const set = <K extends keyof ConfigMeta>(k: K, v: ConfigMeta[K]) => onChange({ ...valor, [k]: v });
  const ctas = CTAS[objetivo];
  return (
    <div className="space-y-5">
      <fieldset className="grid gap-3 md:grid-cols-3">
        <legend className="mb-2 text-sm font-medium">Nomes</legend>
        <label className={rotulo}>Campanha<input value={valor.nomeCampanha} onChange={(e) => set("nomeCampanha", e.target.value)} className={campo} /></label>
        <label className={rotulo}>Conjunto<input value={valor.nomeConjunto} onChange={(e) => set("nomeConjunto", e.target.value)} className={campo} /></label>
        <label className={rotulo}>Anúncio<input value={valor.nomeAnuncio} onChange={(e) => set("nomeAnuncio", e.target.value)} className={campo} /></label>
        <p className={`${dica} md:col-span-3`}>Use {"{cliente}"}, {"{objetivo}"}, {"{data}"}, {"{cidade}"}; no anúncio também {"{n}"} (número) e {"{arquivo}"} (nome do arquivo).</p>
      </fieldset>

      <fieldset className="grid gap-3 md:grid-cols-3">
        <legend className="mb-2 text-sm font-medium">Orçamento</legend>
        <label className={rotulo}>Orçamento diário (R$)
          <input type="number" min={1} step="0.01" value={valor.orcamentoDiario} onChange={(e) => set("orcamentoDiario", Number(e.target.value))} className={campo} />
        </label>
        <label className={rotulo}>Onde fica o orçamento
          <select value={valor.orcamentoEm} onChange={(e) => set("orcamentoEm", e.target.value as ConfigMeta["orcamentoEm"])} className={campo}>
            <option value="conjunto">No conjunto (ABO)</option>
            <option value="campanha">Na campanha (CBO / Advantage+)</option>
          </select>
        </label>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Público</legend>
        <div className="grid gap-3 md:grid-cols-4">
          <label className={rotulo}>Idade mínima<input type="number" min={18} max={65} value={valor.idadeMin} onChange={(e) => set("idadeMin", Number(e.target.value))} className={campo} /></label>
          <label className={rotulo}>Idade máxima<input type="number" min={18} max={65} value={valor.idadeMax} onChange={(e) => set("idadeMax", Number(e.target.value))} className={campo} /></label>
          <label className={rotulo}>Gênero
            <select value={valor.generos} onChange={(e) => set("generos", e.target.value as ConfigMeta["generos"])} className={campo}>
              <option value="todos">Todos</option><option value="mulheres">Mulheres</option><option value="homens">Homens</option>
            </select>
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={valor.advantage} onChange={(e) => set("advantage", e.target.checked)} /> Público Advantage+
          </label>
        </div>
        <div className="space-y-1">
          <span className="text-sm">Localização {naMontagem ? "" : <span className={dica}>(opcional no modelo; na montagem você escolhe a cidade do cliente)</span>}</span>
          <Busca<Local>
            tipo="local" conta={conta} placeholder="Digite a cidade ou o estado…"
            rotuloItem={(l) => l.nome}
            onEscolher={(l) => !valor.locais.some((x) => x.key === l.key) && set("locais", [...valor.locais, { ...l, raio: l.tipo === "city" ? 15 : undefined }])}
          />
          <div className="flex flex-wrap gap-2">
            {valor.locais.map((l, i) => (
              <span key={l.key} className="inline-flex items-center gap-1 rounded-full bg-fundo px-2 py-0.5 text-xs ring-1 ring-borda">
                {l.nome}
                {l.tipo === "city" && (
                  <select
                    value={l.raio ?? 0}
                    onChange={(e) => set("locais", valor.locais.map((x, j) => (j === i ? { ...x, raio: Number(e.target.value) || undefined } : x)))}
                    className="rounded bg-transparent text-xs"
                  >
                    {RAIOS.map((r) => <option key={r} value={r}>{r ? `+${r} km` : "só a cidade"}</option>)}
                  </select>
                )}
                <button type="button" onClick={() => set("locais", valor.locais.filter((_, j) => j !== i))} className="text-texto-3 hover:text-critico" aria-label="Remover">×</button>
              </span>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-sm">Interesses <span className={dica}>(vazio = aberto)</span></span>
          <Busca<Interesse>
            tipo="interesse" conta={conta} placeholder="Ex.: móveis planejados, arquitetura…"
            rotuloItem={(x) => x.nome}
            onEscolher={(x) => !valor.interesses.some((y) => y.id === x.id) && set("interesses", [...valor.interesses, x])}
          />
          <Chips itens={valor.interesses} texto={(x) => x.nome} onRemover={(i) => set("interesses", valor.interesses.filter((_, j) => j !== i))} />
        </div>
        <p className={dica}>Posicionamentos: automáticos (Advantage+), como o Meta recomenda.</p>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Anúncio</legend>
        <label className={rotulo}>Texto principal
          <Variacoes valores={valor.textos} onChange={(v) => set("textos", v)} linhas={3} placeholder="Texto que aparece acima do criativo" />
        </label>
        <label className={rotulo}>Título
          <Variacoes valores={valor.titulos} onChange={(v) => set("titulos", v)} linhas={1} placeholder="Título curto" />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={rotulo}>Descrição (opcional)<input value={valor.descricao} onChange={(e) => set("descricao", e.target.value)} className={campo} /></label>
          <label className={rotulo}>Botão
            <select value={ctas.some((c) => c.valor === valor.cta) ? valor.cta : ctas[0].valor} onChange={(e) => set("cta", e.target.value)} className={campo}>
              {ctas.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
            </select>
          </label>
        </div>
        {objetivo === "site" && (
          <div className="grid gap-3 md:grid-cols-2">
            <label className={rotulo}>Link do site<input value={valor.url} onChange={(e) => set("url", e.target.value)} placeholder="https://" className={campo} /></label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={valor.utm} onChange={(e) => set("utm", e.target.checked)} />
              Acrescentar UTMs (utm_source=facebook, utm_campaign, utm_content = nome do anúncio)
            </label>
          </div>
        )}
        {objetivo === "mensagens" && (
          <label className={rotulo}>Mensagem que já vem escrita no WhatsApp (opcional)
            <input value={valor.mensagemWhatsapp} onChange={(e) => set("mensagemWhatsapp", e.target.value)} className={campo} />
          </label>
        )}
      </fieldset>
    </div>
  );
}
