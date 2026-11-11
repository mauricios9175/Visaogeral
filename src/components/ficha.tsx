"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { Ficha, LinkFicha } from "@/lib/ficha";

type Campo = "briefing" | "informacoes" | "acessos";

const CAMPOS: { chave: Campo; titulo: string; dica: string; linhas: number }[] = [
  {
    chave: "briefing", titulo: "Briefing", linhas: 7,
    dica: "O que vende, para quem, região, diferenciais, ticket, tom de voz, o que não pode. A IA do painel usa isto nas análises, sugestões e textos.",
  },
  { chave: "informacoes", titulo: "Informações importantes", linhas: 8, dica: "Contatos, designer, combinados, datas, observações." },
  {
    chave: "acessos", titulo: "Onde estão os acessos", linhas: 3,
    dica: "Só onde encontrar (ex.: “Bitwarden › Clientes › Kiko”). Não coloque senhas aqui: guarde num gerenciador de senhas.",
  },
];

const PARECE_SENHA = /\b(senha|password|pass|pwd)\b\s*[:=-]?\s*\S{4,}/i;

/** Ficha do cliente, editável. Salva sozinha ao sair de cada campo. */
export function EditorFicha({ clienteId, inicial }: { clienteId: string; inicial: Ficha }) {
  const [ficha, setFicha] = useState(inicial);
  const salva = useRef(inicial);
  const [estado, setEstado] = useState<string | null>(null);
  const [novoLink, setNovoLink] = useState({ rotulo: "", url: "" });

  async function salvar(mudanca: Partial<Ficha>) {
    setEstado("Salvando…");
    try {
      const r = await fetch("/api/ficha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "salvar", clienteId, ficha: mudanca }) });
      const j = await r.json().catch(() => ({ erro: `erro ${r.status}` }));
      if (!r.ok || j.erro) throw new Error(j.erro ?? `erro ${r.status}`);
      salva.current = j.ficha;
      setFicha((f) => ({ ...f, links: j.ficha.links, atualizadoEm: j.ficha.atualizadoEm }));
      setEstado("Salvo ✓");
    } catch (e) {
      setEstado(`Não salvou: ${e instanceof Error ? e.message : e}`);
    }
  }

  const sairDoCampo = (c: Campo) => { if (ficha[c] !== salva.current[c]) salvar({ [c]: ficha[c] }); };
  const links = (l: LinkFicha[]) => { setFicha((f) => ({ ...f, links: l })); salvar({ links: l }); };

  function adicionarLink(e: React.FormEvent) {
    e.preventDefault();
    let url = novoLink.url.trim();
    if (!url) return;
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(url)) url = `https://${url}`;
    links([...ficha.links, { rotulo: novoLink.rotulo.trim(), url }]);
    setNovoLink({ rotulo: "", url: "" });
  }

  const caixa = "w-full rounded-[10px] border border-borda bg-fundo px-3 py-2 text-sm leading-relaxed outline-none focus:border-destaque";

  return (
    <div className="space-y-5">
      <section className="space-y-2 rounded-2xl border border-borda bg-superficie p-4">
        <h2 className="text-sm font-bold">Links</h2>
        {ficha.links.length === 0 && <p className="text-sm text-texto-3">Nenhum link ainda (redes sociais, site, Drive, landing page…).</p>}
        <ul className="flex flex-wrap gap-2">
          {ficha.links.map((l, i) => (
            <li key={l.url} className="flex items-center gap-1 rounded-lg border border-borda bg-fundo pl-3 text-sm">
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="py-1.5 font-medium text-destaque hover:underline" title={l.url}>{l.rotulo}</a>
              <button type="button" onClick={() => links(ficha.links.filter((_, j) => j !== i))} aria-label={`Remover ${l.rotulo}`} className="px-2 py-1.5 text-texto-3 hover:text-critico">×</button>
            </li>
          ))}
        </ul>
        <form onSubmit={adicionarLink} className="flex flex-wrap gap-2 pt-1">
          <input value={novoLink.url} onChange={(e) => setNovoLink((n) => ({ ...n, url: e.target.value }))} placeholder="Endereço (instagram.com/…, drive…)" className="min-h-10 min-w-0 flex-[2] rounded-lg border border-borda bg-fundo px-3 text-sm" />
          <input value={novoLink.rotulo} onChange={(e) => setNovoLink((n) => ({ ...n, rotulo: e.target.value }))} placeholder="Nome (opcional)" className="min-h-10 min-w-0 flex-1 rounded-lg border border-borda bg-fundo px-3 text-sm" />
          <button className="min-h-10 rounded-lg border border-borda px-3 text-sm hover:border-destaque">Adicionar</button>
        </form>
      </section>

      {CAMPOS.map((c) => (
        <section key={c.chave} className="space-y-1.5">
          <h2 className="text-sm font-bold">{c.titulo}</h2>
          <p className="text-xs text-texto-3">{c.dica}</p>
          <textarea value={ficha[c.chave]} rows={c.linhas} onChange={(e) => setFicha((f) => ({ ...f, [c.chave]: e.target.value }))}
            onBlur={() => sairDoCampo(c.chave)} className={caixa} />
          {PARECE_SENHA.test(ficha[c.chave]) && (
            <p className="text-xs text-atencao">▲ Parece ter uma senha aqui. O ideal é guardar em um gerenciador de senhas (Bitwarden, 1Password) e deixar aqui só onde encontrar.</p>
          )}
        </section>
      ))}

      <p className="text-xs text-texto-3">
        {estado ?? (ficha.atualizadoEm ? `Atualizada em ${new Date(ficha.atualizadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.` : "Salva sozinha ao sair de cada campo.")}
        {ficha.trello && <> · <a href={ficha.trello} target="_blank" rel="noopener noreferrer" className="underline">cartão original no Trello</a></>}
      </p>
    </div>
  );
}

/** Os links da ficha em uma linha (topo da tela do cliente). */
export function LinksFicha({ links, href }: { links: LinkFicha[]; href: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {links.slice(0, 8).map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="rounded-md border border-borda px-2 py-1 text-texto-2 hover:border-destaque hover:text-texto">{l.rotulo}</a>
      ))}
      <Link href={href} className="px-1 text-destaque underline">{links.length ? (links.length > 8 ? `+${links.length - 8} na ficha` : "ficha") : "+ links na ficha"}</Link>
    </div>
  );
}
