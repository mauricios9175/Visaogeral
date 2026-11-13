"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { LinhaNivelGoogle, NivelGoogle } from "@/lib/google";
import { decimal, dinheiro, inteiro, pct } from "@/lib/formato";
import { BotaoGoogle } from "./botao-google";
import { AcoesRapidas } from "./acoes-rapidas";

/** Linha pronta para a tabela (o servidor já calcula o link e a conta de cada uma). */
export type LinhaTabelaGoogle = LinhaNivelGoogle & {
  href?: string | null;
  conta?: string;
  orcamento?: number | null;  // campanhas
  compartilhado?: boolean;
  info?: string;              // campanhas: canal · conta
};

// selo de status (o mesmo visual do resto do painel; aqui sem importar ui.tsx, que puxa código do servidor)
const SELO: Record<string, { rotulo: string; classe: string; icone: string }> = {
  ENABLED: { rotulo: "Ativo", classe: "bg-bom-bg text-bom", icone: "●" },
  PAUSED: { rotulo: "Pausado", classe: "bg-fundo text-texto-2", icone: "❚❚" },
  REMOVED: { rotulo: "Excluído", classe: "bg-fundo text-texto-3", icone: "○" },
};
function SeloStatus({ status }: { status: string }) {
  const s = SELO[status] ?? { rotulo: status || "—", classe: "bg-fundo text-texto-3", icone: "○" };
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${s.classe}`}>
      <span aria-hidden>{s.icone}</span>{s.rotulo}
    </span>
  );
}
const FORCA: Record<string, string> = { EXCELLENT: "Excelente", GOOD: "Boa", AVERAGE: "Média", POOR: "Fraca", PENDING: "Pendente", UNRATED: "" };
const APROVACAO: Record<string, string> = { APPROVED: "", APPROVED_LIMITED: "aprovado (limitado)", DISAPPROVED: "reprovado", AREA_OF_INTEREST_ONLY: "limitado" };

type Coluna = "nome" | "gasto" | "conversoes" | "cpa" | "cliques" | "ctr" | "cpc";
const COLUNAS: { chave: Coluna; rotulo: string }[] = [
  { chave: "gasto", rotulo: "Investido" }, { chave: "conversoes", rotulo: "Conversões" }, { chave: "cpa", rotulo: "Custo/conv." },
  { chave: "cliques", rotulo: "Cliques" }, { chave: "ctr", rotulo: "CTR" }, { chave: "cpc", rotulo: "CPC" },
];
const valor = (l: LinhaNivelGoogle, c: Coluna): number | string | null => {
  switch (c) {
    case "nome": return l.nome.toLowerCase();
    case "gasto": return l.gasto;
    case "conversoes": return l.conversoes;
    case "cpa": return l.conversoes ? l.gasto / l.conversoes : null;
    case "cliques": return l.cliques;
    case "ctr": return l.impressoes ? l.cliques / l.impressoes : null;
    case "cpc": return l.cliques ? l.gasto / l.cliques : null;
  }
};

type Filtro = { chave: string; rotulo: string; aceita: (l: LinhaTabelaGoogle) => boolean };
const FILTROS_GERAIS: Filtro[] = [
  { chave: "todos", rotulo: "Todos", aceita: () => true },
  { chave: "com", rotulo: "Com conversão", aceita: (l) => l.conversoes > 0 },
  { chave: "sem", rotulo: "Gastou sem converter", aceita: (l) => l.gasto > 0 && l.conversoes === 0 },
  { chave: "ativos", rotulo: "Ativos", aceita: (l) => l.status === "ENABLED" },
  { chave: "pausados", rotulo: "Pausados", aceita: (l) => l.status === "PAUSED" },
];
const FILTROS_TERMOS: Filtro[] = [
  { chave: "todos", rotulo: "Todos", aceita: () => true },
  { chave: "com", rotulo: "Com conversão", aceita: (l) => l.conversoes > 0 },
  { chave: "sem", rotulo: "Gastou sem converter", aceita: (l) => l.gasto > 0 && l.conversoes === 0 },
  { chave: "novos", rotulo: "Ainda não adicionados", aceita: (l) => !l.extra?.termoStatus || l.extra.termoStatus === "NONE" },
  { chave: "palavra", rotulo: "Já são palavra-chave", aceita: (l) => l.extra?.termoStatus === "ADDED" },
  { chave: "negativados", rotulo: "Negativados", aceita: (l) => l.extra?.termoStatus === "EXCLUDED" || l.extra?.termoStatus === "ADDED_EXCLUDED" },
];
const POR_PAGINA = [10, 25, 50, 100];

/**
 * Tabela de um nível do Google (campanhas, grupos, anúncios, palavras-chave ou termos), igual à do Google Ads:
 * busca, filtros rápidos, ordenar pelo cabeçalho e paginação — tudo na hora, sem recarregar a página.
 */
export function TabelaGoogle({ nivel, linhas, voltar, cpaMedio }: {
  nivel: "campanhas" | NivelGoogle; linhas: LinhaTabelaGoogle[]; voltar: string; cpaMedio: number | null;
}) {
  const filtros = nivel === "termos" ? FILTROS_TERMOS : FILTROS_GERAIS;
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const [ordem, setOrdem] = useState<{ col: Coluna; desc: boolean }>({ col: "gasto", desc: true });
  const [porPagina, setPorPagina] = useState(nivel === "campanhas" ? 25 : 10);
  const [pagina, setPagina] = useState(0);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const f = filtros.find((x) => x.chave === filtro) ?? filtros[0];
    const ls = linhas.filter((l) => f.aceita(l) && (!termo || `${l.nome} ${l.grupo ?? ""} ${l.campanha}`.toLowerCase().includes(termo)));
    return ls.sort((a, b) => {
      const va = valor(a, ordem.col), vb = valor(b, ordem.col);
      // vazios (ex.: custo/conv. sem conversão) sempre no fim
      if (va == null || vb == null) return va == null ? (vb == null ? 0 : 1) : -1;
      const r = typeof va === "string" ? va.localeCompare(String(vb)) : va - (vb as number);
      return ordem.desc ? -r : r;
    });
  }, [linhas, busca, filtro, ordem, filtros]);

  if (!linhas.length) return <p className="p-4 text-sm text-texto-3">Sem dados neste nível no período.</p>;
  const paginas = Math.max(1, Math.ceil(visiveis.length / porPagina));
  const pag = Math.min(pagina, paginas - 1);
  const mostradas = visiveis.slice(pag * porPagina, (pag + 1) * porPagina);
  const soma = visiveis.reduce((t, l) => ({ gasto: t.gasto + l.gasto, conv: t.conv + l.conversoes, cliques: t.cliques + l.cliques, impr: t.impr + l.impressoes }),
    { gasto: 0, conv: 0, cliques: 0, impr: 0 });
  const ordenar = (col: Coluna) => { setOrdem((o) => ({ col, desc: o.col === col ? !o.desc : col !== "nome" && col !== "cpa" && col !== "cpc" })); setPagina(0); };
  const seta = (col: Coluna) => (ordem.col === col ? (ordem.desc ? " ↓" : " ↑") : "");
  const cab = nivel === "campanhas" ? "Campanha" : nivel === "grupos" ? "Grupo" : nivel === "anuncios" ? "Anúncio" : nivel === "palavras" ? "Palavra-chave" : "Termo pesquisado";
  const nivelAcao = nivel === "grupos" ? "grupo" : nivel === "anuncios" ? "anuncio" : "palavra";
  const chip = (ativo: boolean) => `rounded-full border px-2.5 py-1 ${ativo ? "border-destaque bg-destaque-bg font-semibold text-texto" : "border-borda text-texto-2 hover:text-texto"}`;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-borda p-3 text-xs">
        <input
          value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(0); }} placeholder={`Buscar ${cab.toLowerCase()}…`} aria-label="Buscar"
          className="min-h-8 w-full rounded-lg border border-borda bg-fundo px-2.5 text-sm sm:w-56"
        />
        {filtros.map((f) => (
          <button key={f.chave} type="button" onClick={() => { setFiltro(f.chave); setPagina(0); }} className={chip(filtro === f.chave)}>{f.rotulo}</button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-texto-3">
            <tr>
              <th className="px-4 py-2 font-normal"><button type="button" onClick={() => ordenar("nome")} className="hover:text-texto">{cab}{seta("nome")}</button></th>
              {COLUNAS.map((c) => (
                <th key={c.chave} className="px-3 py-2 text-right font-normal">
                  <button type="button" onClick={() => ordenar(c.chave)} className={`hover:text-texto ${ordem.col === c.chave ? "font-semibold text-texto" : ""}`}>{c.rotulo}{seta(c.chave)}</button>
                </th>
              ))}
              {nivel === "campanhas" && <th className="px-3 py-2 text-right font-normal">Orçamento</th>}
              <th className="px-3 py-2 text-right font-normal">Ações</th>
            </tr>
          </thead>
          <tbody className="num">
            {mostradas.map((l) => {
              const cpa = l.conversoes ? l.gasto / l.conversoes : null;
              const semConv = l.gasto > 0 && l.conversoes === 0;
              const caro = cpaMedio != null && cpa != null && cpa > cpaMedio * 1.3;
              const ativo = l.status === "ENABLED";
              const info = nivel === "campanhas" ? l.info : [
                nivel === "grupos" ? l.tipo : null,
                nivel !== "grupos" ? l.grupo : null,
                l.detalhe,
                l.extra?.qualidade ? `qualidade ${l.extra.qualidade}/10` : null,
                l.extra?.forca && FORCA[l.extra.forca] ? `força ${FORCA[l.extra.forca]}` : null,
                l.extra?.aprovacao && APROVACAO[l.extra.aprovacao] ? APROVACAO[l.extra.aprovacao] : null,
              ].filter(Boolean).join(" · ");
              return (
                <tr key={`${l.campanhaId}-${l.id}`} className="border-t border-borda">
                  <td className="max-w-96 px-4 py-2">
                    <div className="flex items-center gap-2">
                      {nivel !== "termos" && <SeloStatus status={l.status} />}
                      {l.href ? <Link href={l.href} className="truncate hover:text-destaque hover:underline" title={l.nome}>{l.nome}</Link>
                        : <span className="truncate" title={l.nome}>{l.nome}</span>}
                    </div>
                    <div className="truncate text-xs text-texto-3" title={info || l.campanha}>{info || l.campanha}</div>
                  </td>
                  <td className="px-3 py-2 text-right">{dinheiro(l.gasto)}</td>
                  <td className="px-3 py-2 text-right">{decimal(l.conversoes).replace(/,00$/, "")}</td>
                  <td className={`px-3 py-2 text-right ${semConv || caro ? "text-critico" : ""}`}>{semConv ? "sem conversão" : dinheiro(cpa)}</td>
                  <td className="px-3 py-2 text-right">{inteiro(l.cliques)}</td>
                  <td className="px-3 py-2 text-right">{pct(l.impressoes ? (l.cliques / l.impressoes) * 100 : null)}</td>
                  <td className="px-3 py-2 text-right">{dinheiro(l.cliques ? l.gasto / l.cliques : null)}</td>
                  {nivel === "campanhas" && (
                    <td className="px-3 py-2 text-right text-texto-2">
                      {l.orcamento != null ? `${dinheiro(l.orcamento)}/dia` : "—"}
                      {l.compartilhado && <div className="text-[11px] text-texto-3">compartilhado</div>}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    {l.conta && nivel === "campanhas" && (
                      <AcoesRapidas
                        plataforma="google" contaId={l.conta} objetoId={l.id} nivel="campanha" nome={l.nome}
                        ativo={ativo ? true : l.status === "PAUSED" ? false : null}
                        orcamento={l.orcamento != null ? { valor: l.orcamento, tipo: "dia" } : null}
                        mostrarOrcamento={l.status !== "REMOVED"} voltar={voltar}
                      />
                    )}
                    {l.conta && nivel === "campanhas" && (
                      <Link href={`/copiar-google?${new URLSearchParams({ conta: l.conta, campanha: l.id, nome: l.nome, voltar })}`}
                        className="mt-1 inline-block text-xs text-texto-3 underline hover:text-destaque" title="Copiar e colar esta campanha em outra conta (como no Google Ads Editor)">
                        Copiar para…
                      </Link>
                    )}
                    {l.conta && nivel !== "campanhas" && (
                      <div className="flex justify-end gap-1.5">
                        {nivel !== "termos" && (l.status === "ENABLED" || l.status === "PAUSED") && (
                          <BotaoGoogle voltar={voltar} rotulo={ativo ? "Pausar" : "Ativar"} perigo={ativo}
                            confirmar={`${ativo ? "Pausar" : "Ativar"} “${l.nome}” no Google?`}
                            campos={{ conta_id: l.conta, nivel: nivelAcao, acao: ativo ? "pausar" : "ativar", objeto_id: l.id, nome: l.nome }} />
                        )}
                        {nivel === "termos" && l.extra?.termoStatus !== "EXCLUDED" && (
                          <BotaoGoogle voltar={voltar} rotulo="Negativar" perigo
                            confirmar={`Adicionar [${l.nome}] como negativa (exata) na campanha “${l.campanha}”?`}
                            campos={{ conta_id: l.conta, nivel: "termo", acao: "negativar", objeto_id: l.campanhaId, texto: l.nome, tipo: "EXACT", nome: l.campanha }} />
                        )}
                        {nivel === "termos" && l.grupoId && l.extra?.termoStatus !== "ADDED" && (
                          <BotaoGoogle voltar={voltar} rotulo="+ Palavra"
                            confirmar={`Adicionar [${l.nome}] como palavra-chave (exata) no grupo “${l.grupo}”?`}
                            campos={{ conta_id: l.conta, nivel: "termo", acao: "adicionar", objeto_id: l.grupoId, texto: l.nome, tipo: "EXACT", nome: l.grupo ?? "" }} />
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!mostradas.length && (
              <tr><td colSpan={9} className="px-4 py-4 text-sm text-texto-3">Nada com esse filtro.</td></tr>
            )}
          </tbody>
          {visiveis.length > 0 && (
            <tfoot className="num border-t-2 border-borda text-xs font-semibold">
              <tr>
                <td className="px-4 py-2">Total {filtro !== "todos" || busca ? "do filtro" : ""} ({inteiro(visiveis.length)})</td>
                <td className="px-3 py-2 text-right">{dinheiro(soma.gasto)}</td>
                <td className="px-3 py-2 text-right">{decimal(soma.conv).replace(/,00$/, "")}</td>
                <td className="px-3 py-2 text-right">{dinheiro(soma.conv ? soma.gasto / soma.conv : null)}</td>
                <td className="px-3 py-2 text-right">{inteiro(soma.cliques)}</td>
                <td className="px-3 py-2 text-right">{pct(soma.impr ? (soma.cliques / soma.impr) * 100 : null)}</td>
                <td className="px-3 py-2 text-right">{dinheiro(soma.cliques ? soma.gasto / soma.cliques : null)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-borda px-4 py-2.5 text-xs text-texto-2">
        <label className="flex items-center gap-1.5">
          Linhas por página
          <select value={porPagina} onChange={(e) => { setPorPagina(Number(e.target.value)); setPagina(0); }} className="min-h-8 rounded-lg border border-borda bg-fundo px-2">
            {POR_PAGINA.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <span>{visiveis.length ? `${pag * porPagina + 1}–${Math.min((pag + 1) * porPagina, visiveis.length)} de ${inteiro(visiveis.length)}` : "0"}</span>
          <button type="button" disabled={pag === 0} onClick={() => setPagina(pag - 1)} className="rounded-lg border border-borda px-2.5 py-1 disabled:opacity-40" aria-label="Página anterior">‹</button>
          <button type="button" disabled={pag >= paginas - 1} onClick={() => setPagina(pag + 1)} className="rounded-lg border border-borda px-2.5 py-1 disabled:opacity-40" aria-label="Próxima página">›</button>
        </div>
      </div>
    </div>
  );
}
