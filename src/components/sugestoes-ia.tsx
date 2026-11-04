"use client";

import Link from "next/link";
import { useState } from "react";
import { AcoesRapidas } from "./acoes-rapidas";
import { salvarParamsIA } from "@/app/acoes-ia";
import { acaoGoogleDetalhe } from "@/app/acoes-anuncios";
import type { ParamsIA } from "@/lib/manual-ia";
import type { PlataformaIA, ResultadoSugestoes, Sugestao } from "@/lib/sugestoes";

const ROTULO_ACAO: Record<Sugestao["acao"], string> = {
  manter: "Manter", aguardar: "Aguardar", pausar: "Pausar", escalar: "Escalar", reduzir_orcamento: "Reduzir orçamento",
  otimizar_publico: "Otimizar público", revisar_formulario: "Revisar formulário/oferta", novo_criativo: "Novo criativo",
  recriar_campanha: "Recriar do zero", campanha_testes: "Campanha de testes", dividir_campanha: "Dividir campanha",
  mudar_objetivo: "Mudar objetivo", negativar: "Negativar termo", adicionar_palavra: "Adicionar palavra-chave",
  novo_anuncio: "Reescrever anúncio", mudar_correspondencia: "Mudar correspondência", revisar_lance: "Revisar lance",
  revisar_pagina: "Revisar página",
};
const COR_ACAO: Partial<Record<Sugestao["acao"], string>> = {
  pausar: "bg-critico-bg text-critico", reduzir_orcamento: "bg-atencao-bg text-atencao", escalar: "bg-bom-bg text-bom",
  manter: "bg-bom-bg text-bom", aguardar: "bg-superficie-2 text-texto-2", negativar: "bg-critico-bg text-critico",
  adicionar_palavra: "bg-bom-bg text-bom",
};
const DECISAO: Record<string, string> = {
  manter: "Manter: não há motivo para mexer", otimizar_custo: "Otimizar com foco em custo",
  otimizar_qualidade: "Otimizar com foco em qualidade", prioridade_maxima: "Otimizar: prioridade máxima", aguardar: "Aguardar mais dados",
};
const NIVEL: Record<string, string> = {
  anuncio: "Anúncio", conjunto: "Conjunto", campanha: "Campanha", grupo: "Grupo", palavra: "Palavra-chave", termo: "Termo de pesquisa",
};
const ATIVOS = ["ACTIVE", "IN_PROCESS", "PENDING_REVIEW", "PREAPPROVED", "ENABLED"];

/** Botão com confirmação que chama a ação do Google abaixo da campanha (grupo, palavra, termo). */
function BotaoGoogle({ campos, rotulo, confirmar, voltar }: { campos: Record<string, string>; rotulo: string; confirmar: string; voltar: string }) {
  return (
    <form action={acaoGoogleDetalhe} onSubmit={(e) => { if (!confirm(confirmar)) e.preventDefault(); }}>
      {Object.entries({ ...campos, voltar }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button className="rounded-md border border-borda bg-superficie px-2.5 py-1 text-xs font-semibold hover:border-destaque">{rotulo}</button>
    </form>
  );
}

/** Botões prontos de cada sugestão (pausar, orçamento, negativar, adicionar palavra). */
function Botoes({ s, voltar }: { s: Sugestao; voltar: string }) {
  const it = s.item;
  if (!it) return null;
  const google = it.plataforma === "google";
  if (!google || it.nivel === "campanha") {
    if (!["pausar", "escalar", "reduzir_orcamento"].includes(s.acao)) return null;
    return (
      <AcoesRapidas
        plataforma={google ? "google" : "meta"} contaId={it.conta} objetoId={it.id} nivel={it.nivel as "campanha" | "conjunto" | "anuncio"} nome={it.nome}
        ativo={it.status ? ATIVOS.includes(it.status) : null}
        orcamento={it.orcamento} mostrarOrcamento={s.acao !== "pausar" && it.nivel !== "anuncio"} voltar={voltar}
      />
    );
  }
  const tipo = s.correspondencia ?? "EXACT";
  const simbolo = tipo === "PHRASE" ? `"${it.nome}"` : `[${it.nome}]`;
  if (s.acao === "pausar" && (it.nivel === "grupo" || it.nivel === "palavra")) {
    return <BotaoGoogle voltar={voltar} rotulo={`Pausar ${it.nivel === "grupo" ? "grupo" : "palavra-chave"}`}
      confirmar={`Pausar ${it.nivel === "grupo" ? "o grupo" : "a palavra-chave"} “${it.nome}” no Google?`}
      campos={{ conta_id: it.conta, nivel: it.nivel, acao: "pausar", objeto_id: it.id, nome: it.nome }} />;
  }
  if (s.acao === "negativar" && it.nivel === "termo" && it.campanhaId) {
    return <BotaoGoogle voltar={voltar} rotulo={`Negativar ${simbolo}`}
      confirmar={`Adicionar ${simbolo} como negativa na campanha “${it.campanha ?? ""}”?`}
      campos={{ conta_id: it.conta, nivel: "termo", acao: "negativar", objeto_id: it.campanhaId, texto: it.nome, tipo, nome: it.campanha ?? "" }} />;
  }
  if (s.acao === "adicionar_palavra" && it.nivel === "termo" && it.grupoId) {
    return <BotaoGoogle voltar={voltar} rotulo={`Adicionar ${simbolo}`}
      confirmar={`Adicionar ${simbolo} como palavra-chave no grupo “${it.grupo ?? ""}”?`}
      campos={{ conta_id: it.conta, nivel: "termo", acao: "adicionar", objeto_id: it.grupoId, texto: it.nome, tipo, nome: it.grupo ?? "" }} />;
  }
  return null;
}

export type AcaoPainel = { objeto_id: string; acao: string; depois: string | null; criado_em: string };

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const FEITO: Record<string, string> = { pausar: "Pausado", ativar: "Ativado", orcamento: "Orçamento alterado", negativar: "Negativado", adicionar: "Adicionado" };

/** Sugestões de otimização com IA, seguindo o manual do gestor e os parâmetros do cliente. As últimas ficam salvas. */
export function SugestoesIA({ clienteId, params, cplMeta, periodo, rotuloPeriodo, voltar, historico, acoesPainel, temMeta = true, temGoogle = false }: {
  clienteId: string; params: ParamsIA; cplMeta: number | null;
  periodo: { p: string; de?: string; ate?: string }; rotuloPeriodo: string; voltar: string;
  historico: ResultadoSugestoes[]; acoesPainel: AcaoPainel[]; temMeta?: boolean; temGoogle?: boolean;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [plataforma, setPlataforma] = useState<PlataformaIA>(!temMeta && temGoogle ? "google" : (historico[0]?.plataforma ?? "meta"));
  const [todas, setLista] = useState<ResultadoSugestoes[]>(historico);
  const lista = todas.filter((x) => (x.plataforma ?? "meta") === plataforma);
  const [atualId, setAtualId] = useState<string | undefined>(historico[0]?.id);
  const res = lista.find((x) => x.id === atualId) ?? lista[0] ?? null;

  /** Ação do painel feita no item depois desta rodada de sugestões (termos: pelo texto negativado/adicionado). */
  const feitaNoPainel = (s: Sugestao) =>
    s.item && res?.criado_em ? acoesPainel.find((a) => Date.parse(a.criado_em) >= Date.parse(res.criado_em!) &&
      (s.item!.nivel === "termo" ? (a.acao === "negativar" || a.acao === "adicionar") && a.depois === s.item!.nome.toLowerCase() : a.objeto_id === s.item!.id)) : undefined;

  async function marcar(indice: number, feito: boolean) {
    if (!res?.id) return;
    const atualizado = { ...res, feitas: feito ? [...(res.feitas ?? []), indice] : (res.feitas ?? []).filter((i) => i !== indice) };
    setLista((l) => l.map((x) => (x.id === res.id ? atualizado : x)));
    await fetch("/api/sugestoes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clienteId, marcar: { id: res.id, indice, feito } }) })
      .catch(() => null);
  }

  async function gerar(p: { p: string; de?: string; ate?: string }) {
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch("/api/sugestoes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clienteId, plataforma, ...p }) });
      const j = await r.json().catch(() => ({ erro: `erro ${r.status}` }));
      if (j.erro) throw new Error(j.erro);
      const novo = j as ResultadoSugestoes;
      setLista((l) => [novo, ...l.filter((x) => x.id !== novo.id)]);
      setAtualId(novo.id);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  const campo = "min-h-9 w-full rounded-lg border border-borda bg-fundo px-2 text-sm";
  return (
    <section id="sugestoes" className="rounded-2xl border border-borda bg-superficie p-4 lg:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-bold"><span aria-hidden className="text-destaque">✦</span> Sugestões de otimização</h2>
          <p className="text-xs text-texto-3">
            A IA segue o seu <Link href="/configuracoes#manual-ia" className="underline hover:text-texto">manual</Link> e cruza {plataforma === "google" ? "campanhas, grupos, palavras-chave e termos de pesquisa" : "campanhas, conjuntos e anúncios"} com a qualidade no CRM.
            Nada é feito sozinho.
          </p>
          {temMeta && temGoogle && (
            <div className="mt-2 flex gap-1 text-xs">
              {(["meta", "google"] as const).map((x) => (
                <button key={x} type="button" onClick={() => { setPlataforma(x); setAtualId(undefined); }}
                  className={`rounded-full border px-3 py-1 ${plataforma === x ? "border-destaque bg-destaque-bg font-semibold text-texto" : "border-borda text-texto-2 hover:text-texto"}`}>
                  {x === "meta" ? "Meta Ads" : "Google Ads"}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={ocupado} onClick={() => gerar({ p: "14" })}
            className="min-h-10 rounded-[10px] bg-destaque px-4 text-sm font-semibold text-white disabled:opacity-60">
            {ocupado ? "Analisando…" : "Sugerir (14 dias)"}
          </button>
          {periodo.p !== "14" && (
            <button type="button" disabled={ocupado} onClick={() => gerar(periodo)}
              className="min-h-10 rounded-[10px] border border-borda px-3 text-sm text-texto-2 hover:text-texto disabled:opacity-60">
              {rotuloPeriodo}
            </button>
          )}
        </div>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-texto-3 hover:text-texto">
          Parâmetros deste cliente · meta CPA {cplMeta ? `R$ ${cplMeta.toLocaleString("pt-BR")}` : "não cadastrada"} · tolerância {params.tolerancia}% · qualificação mínima {params.qualificacaoMinima}%
        </summary>
        <form action={salvarParamsIA} className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <input type="hidden" name="cliente_id" value={clienteId} />
          <input type="hidden" name="voltar" value={voltar} />
          <label className="text-xs text-texto-2">Tolerância acima da meta (%)<input name="tolerancia" type="number" min={0} defaultValue={params.tolerancia} className={campo} /></label>
          <label className="text-xs text-texto-2">Dias mínimos de dados<input name="diasMinimos" type="number" min={0} defaultValue={params.diasMinimos} className={campo} /></label>
          <label className="text-xs text-texto-2">Leads mínimos por anúncio<input name="leadsMinimos" type="number" min={0} defaultValue={params.leadsMinimos} className={campo} /></label>
          <label className="text-xs text-texto-2">Gasto mínimo por anúncio (R$, 0 = 2× a meta)<input name="gastoMinimo" type="number" min={0} step="any" defaultValue={params.gastoMinimo} className={campo} /></label>
          <label className="text-xs text-texto-2">Qualificação mínima no CRM (%)<input name="qualificacaoMinima" type="number" min={0} max={100} defaultValue={params.qualificacaoMinima} className={campo} /></label>
          <label className="text-xs text-texto-2 sm:col-span-3 lg:col-span-5">Observações sobre o cliente (a IA lê junto)
            <textarea name="notas" rows={2} defaultValue={params.notas} placeholder="ex.: ticket alto, aceita CPL até R$ 80 se o lead for qualificado; não mexer na campanha de remarketing"
              className="w-full rounded-lg border border-borda bg-fundo p-2 text-sm" />
          </label>
          <div className="sm:col-span-3 lg:col-span-5">
            <button className="min-h-9 rounded-lg border border-borda bg-superficie-2 px-3 text-sm font-semibold hover:border-destaque">Salvar parâmetros</button>
            <span className="ml-2 text-xs text-texto-3">A meta de CPA é a do cadastro do cliente (Configurações).</span>
          </div>
        </form>
      </details>

      {ocupado && <p className="mt-3 text-sm text-texto-3">Cruzando {plataforma === "google" ? "campanhas, grupos, palavras-chave e termos" : "anúncios, conjuntos e campanhas"} com o CRM e aplicando o manual (uns 20 a 40 segundos)…</p>}
      {erro && <p className="mt-3 text-sm text-critico">{erro}</p>}

      {res && !ocupado && (
        <div className="mt-4 space-y-3 border-t border-borda pt-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-texto-3">
            <span>Gerada {res.criado_em ? quando(res.criado_em) : "agora"}</span>
            {lista.length > 1 && (
              <label className="ml-auto flex items-center gap-1.5">Ver anteriores
                <select value={res.id} onChange={(e) => setAtualId(e.target.value)} className="min-h-8 rounded-lg border border-borda bg-fundo px-2 text-xs text-texto">
                  {lista.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.criado_em ? quando(x.criado_em) : "agora"} · {x.periodo.rotulo} · {x.sugestoes.length} sugest{x.sugestoes.length === 1 ? "ão" : "ões"}{x.feitas?.length ? ` (${x.feitas.length} feita(s))` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="rounded-xl bg-superficie-2 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-destaque-bg px-2.5 py-0.5 font-semibold text-destaque">{DECISAO[res.diagnostico.decisao] ?? res.diagnostico.decisao}</span>
              <span className="text-texto-3">
                CPA {res.diagnostico.cpa === "dentro" ? "dentro da meta" : res.diagnostico.cpa === "acima" ? "acima da meta" : "sem meta"} ·
                qualidade {res.diagnostico.qualidade === "boa" ? "boa" : res.diagnostico.qualidade === "ruim" ? "ruim" : "sem dados do CRM"}
                {res.passo > 0 && <> · Passo {res.passo} do manual</>} · {res.periodo.rotulo}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-texto-2">{res.diagnostico.resumo}</p>
          </div>

          {res.sugestoes.length === 0 && <p className="text-sm text-texto-2">Nenhuma mudança sugerida: seguir como está.</p>}
          <ol className="space-y-2">
            {res.sugestoes.map((s, i) => {
              const painel = feitaNoPainel(s);
              const feita = !!painel || (res.feitas ?? []).includes(i);
              return (
              <li key={i} className={`rounded-xl border p-3 ${feita ? "border-bom/40 bg-bom-bg/30" : "border-borda"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-texto-3">{i + 1}.</span>
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${COR_ACAO[s.acao] ?? "bg-destaque-bg text-destaque"}`}>{ROTULO_ACAO[s.acao]}</span>
                  <span className={`text-sm font-semibold ${feita ? "text-texto-2 line-through decoration-texto-3" : ""}`}>{s.titulo}</span>
                  <span className={`ml-auto text-[11px] ${s.confianca === "alta" ? "text-bom" : s.confianca === "baixa" ? "text-atencao" : "text-texto-3"}`}>confiança {s.confianca}</span>
                </div>
                {s.item && <div className="mt-1 text-xs text-texto-3">{NIVEL[s.item.nivel]}: {s.item.nome}</div>}
                <p className="mt-1 text-sm leading-relaxed text-texto-2">{s.motivo}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {painel ? (
                    <span className="rounded-md bg-bom-bg px-2 py-1 text-xs text-bom">
                      ✓ {FEITO[painel.acao] ?? painel.acao}{painel.depois && painel.acao === "orcamento" ? ` para ${painel.depois}` : ""} pelo painel em {quando(painel.criado_em)}
                    </span>
                  ) : (
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-texto-2">
                      <input type="checkbox" checked={feita} onChange={(e) => marcar(i, e.target.checked)} className="accent-[var(--destaque)]" />
                      {feita ? "Feito" : "Marcar como feito"}
                    </label>
                  )}
                </div>
                {!painel && s.item && (
                  <div className="mt-2"><Botoes s={s} voltar={voltar} /></div>
                )}
              </li>
              );
            })}
          </ol>
          {res.faltando && <p className="text-xs text-texto-3">Faltou para decidir melhor: {res.faltando}</p>}
          <p className="text-[11px] text-texto-3">Sugestões geradas por IA a partir dos seus números e do seu manual. Revise antes de aplicar.</p>
        </div>
      )}
    </section>
  );
}
