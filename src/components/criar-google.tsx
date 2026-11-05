"use client";

import { useState } from "react";
import { criarNoGoogle } from "@/app/acoes-anuncios";
import { LIMITES } from "@/lib/modelos-google";
import { BotaoEnviar } from "./botao";

const campo = "w-full rounded-lg border border-borda bg-fundo px-2 py-1.5 text-sm outline-none focus:border-destaque";
const caixa = "space-y-2 rounded-2xl border border-borda bg-superficie p-4";

function Ocultos({ v }: { v: Record<string, string> }) {
  return <>{Object.entries(v).map(([k, x]) => <input key={k} type="hidden" name={k} value={x} />)}</>;
}

/** Adicionar várias palavras-chave (no grupo) ou negativas (na campanha), no formato do Google Ads. */
export function AdicionarPalavras({ tipo, contaId, objetoId, nome, voltar }: {
  tipo: "palavras" | "negativas"; contaId: string; objetoId: string; nome: string; voltar: string;
}) {
  return (
    <details className={caixa}>
      <summary className="cursor-pointer text-sm font-semibold">
        {tipo === "palavras" ? `+ Adicionar palavras-chave ao grupo “${nome}”` : `+ Adicionar negativas na campanha “${nome}”`}
      </summary>
      <form action={criarNoGoogle} className="space-y-2">
        <Ocultos v={{ conta_id: contaId, tipo, objeto_id: objetoId, nome, voltar }} />
        <p className="text-xs text-texto-3">Uma por linha: sem nada = ampla · &quot;entre aspas&quot; = frase · [entre colchetes] = exata.</p>
        <textarea name="texto" rows={5} required className={`${campo} font-mono text-[13px]`}
          placeholder={tipo === "palavras" ? '"loja de celular"\n[iphone 13 usado]' : "grátis\n[vagas]\n\"como consertar\""} />
        <BotaoEnviar className="min-h-9 rounded-lg bg-destaque px-4 text-sm font-semibold text-white" aguardando="Enviando ao Google…">
          {tipo === "palavras" ? "Adicionar palavras-chave" : "Adicionar negativas"}
        </BotaoEnviar>
      </form>
    </details>
  );
}

function Textos({ titulo, valor, limite, max, onChange }: { titulo: string; valor: string[]; limite: number; max: number; onChange: (v: string[]) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm">{titulo} <span className="text-xs text-texto-3">(até {max}, {limite} caracteres)</span></div>
      {valor.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <input value={t} onChange={(e) => onChange(valor.map((x, j) => (j === i ? e.target.value : x)))} className={campo} />
          <span className={`w-12 shrink-0 text-right text-xs ${t.length > limite ? "font-bold text-critico" : "text-texto-3"}`}>{t.length}/{limite}</span>
          <button type="button" onClick={() => onChange(valor.filter((_, j) => j !== i))} className="text-xs text-texto-3 hover:text-critico" aria-label="Remover">✕</button>
        </div>
      ))}
      {valor.length < max && <button type="button" onClick={() => onChange([...valor, ""])} className="text-xs text-destaque hover:underline">+ adicionar</button>}
    </div>
  );
}

/** Anúncio responsivo novo num grupo, escrito à mão ou pela IA (a partir das palavras-chave do grupo). */
export function NovoAnuncioGoogle({ clienteId, contaId, grupoId, grupo, palavras, atuais, urlPadrao, voltar }: {
  clienteId: string; contaId: string; grupoId: string; grupo: string; palavras: string[]; atuais: string[]; urlPadrao: string; voltar: string;
}) {
  const [titulos, setTitulos] = useState<string[]>(["", "", ""]);
  const [descricoes, setDescricoes] = useState<string[]>(["", ""]);
  const [url, setUrl] = useState(urlPadrao);
  const [caminho1, setCaminho1] = useState("");
  const [caminho2, setCaminho2] = useState("");
  const [ativo, setAtivo] = useState(false);
  const [pedido, setPedido] = useState("");
  const [ia, setIa] = useState<"livre" | "ocupado">("livre");
  const [erro, setErro] = useState<string | null>(null);

  async function escrever() {
    setIa("ocupado");
    setErro(null);
    try {
      const r = await fetch("/api/esboco", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plataforma: "google-anuncio", clienteId, grupo, palavras, atuais, pedido }),
      });
      const j = await r.json().catch(() => ({ erro: `erro ${r.status}` }));
      if (j.erro) throw new Error(j.erro);
      setTitulos(j.titulos.length >= 3 ? j.titulos : [...j.titulos, "", "", ""].slice(0, 3));
      setDescricoes(j.descricoes.length >= 2 ? j.descricoes : [...j.descricoes, "", ""].slice(0, 2));
      if (j.caminho1) setCaminho1(j.caminho1);
      if (j.caminho2) setCaminho2(j.caminho2);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setIa("livre");
    }
  }

  const t = titulos.map((x) => x.trim()).filter(Boolean), d = descricoes.map((x) => x.trim()).filter(Boolean);
  const falta = t.length < 3 ? "Pelo menos 3 títulos." : d.length < 2 ? "Pelo menos 2 descrições."
    : t.some((x) => x.length > LIMITES.titulo) || d.some((x) => x.length > LIMITES.descricao) ? "Tem texto acima do limite." : !/^https?:\/\/\S+\.\S+/.test(url) ? "Informe o link." : null;
  return (
    <details className={caixa}>
      <summary className="cursor-pointer text-sm font-semibold">+ Novo anúncio no grupo “{grupo}”</summary>
      <div className="space-y-3 rounded-xl bg-destaque-bg/40 p-3">
        <div className="text-sm font-semibold"><span className="text-destaque">✦</span> Escrever com IA</div>
        <p className="text-xs text-texto-3">Usa as {palavras.length} palavra(s)-chave do grupo{atuais.length ? " e traz ângulos diferentes dos anúncios atuais" : ""}. Você revisa antes de criar.</p>
        <div className="flex gap-2">
          <input value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder="opcional: foco do anúncio (ex.: garantia de 1 ano, entrega no mesmo dia)" className={campo} />
          <button type="button" onClick={escrever} disabled={ia === "ocupado"} className="shrink-0 rounded-lg bg-destaque px-3 text-sm font-semibold text-white disabled:opacity-60">
            {ia === "ocupado" ? "Escrevendo…" : "Escrever"}
          </button>
        </div>
        {erro && <p className="text-xs text-critico">{erro}</p>}
      </div>
      <form action={criarNoGoogle} className="space-y-3">
        <Ocultos v={{ conta_id: contaId, tipo: "anuncio", objeto_id: grupoId, nome: grupo, voltar, anuncio: JSON.stringify({ titulos, descricoes, url, caminho1, caminho2, ativo }) }} />
        <Textos titulo="Títulos" valor={titulos} limite={LIMITES.titulo} max={LIMITES.titulos} onChange={setTitulos} />
        <Textos titulo="Descrições" valor={descricoes} limite={LIMITES.descricao} max={LIMITES.descricoes} onChange={setDescricoes} />
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-texto-2">Link<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={campo} /></label>
          <label className="text-xs text-texto-2">Caminho 1 ({caminho1.length}/15)<input value={caminho1} maxLength={15} onChange={(e) => setCaminho1(e.target.value)} className={campo} /></label>
          <label className="text-xs text-texto-2">Caminho 2 ({caminho2.length}/15)<input value={caminho2} maxLength={15} onChange={(e) => setCaminho2(e.target.value)} className={campo} /></label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          Já criar ativo <span className="text-xs text-texto-3">(desmarcado = cria pausado para você revisar no Google)</span>
        </label>
        {falta && <p className="text-xs text-atencao">{falta}</p>}
        <BotaoEnviar className="min-h-9 rounded-lg bg-destaque px-4 text-sm font-semibold text-white disabled:opacity-50" aguardando="Criando no Google…">
          Criar anúncio
        </BotaoEnviar>
      </form>
    </details>
  );
}
