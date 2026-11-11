"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Tarefa } from "@/lib/tarefas";
import type { SugestaoTarefa } from "@/lib/tarefas-auto";
import { dataDoTexto, rotuloData } from "@/lib/tarefas-texto";
import { somarDias } from "@/lib/datas";
import { BotaoMicrofone, useMicrofone } from "./analise-ia";

export type ClienteTarefa = { id: string; nome: string; empresa: string };

const DESCOBRIR = "__texto__";
const diaEmBrasilia = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));

async function chamar(corpo: object): Promise<Tarefa[]> {
  const r = await fetch("/api/tarefas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({ erro: `Erro ${r.status}` }));
  if (!r.ok || j.erro) throw new Error(j.erro ?? `Erro ${r.status}`);
  return j.tarefas as Tarefa[];
}

/** Escolha de cliente agrupada por empresa (Viccon, Propulsão, Clientes próprios…). */
function OpcoesClientes({ clientes }: { clientes: ClienteTarefa[] }) {
  const empresas = [...new Set(clientes.map((c) => c.empresa))];
  return (
    <>
      {empresas.map((e) => (
        <optgroup key={e} label={e}>
          {clientes.filter((c) => c.empresa === e).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </optgroup>
      ))}
    </>
  );
}

/**
 * Tarefas do gestor. Na tela "Tarefas": todas, por seção (atrasadas, hoje, aguardando, próximas, feitas).
 * Na tela do cliente (`clienteFixo`): só as dele, e a nova tarefa já nasce dele.
 */
export function Tarefas({ inicial, clientes, hoje, clienteFixo, sugestoes: sugestoesIniciais = [] }: {
  inicial: Tarefa[]; clientes: ClienteTarefa[]; hoje: string; clienteFixo?: string; sugestoes?: SugestaoTarefa[];
}) {
  const router = useRouter();
  const [tarefas, setTarefas] = useState(inicial);
  // a lista do servidor mudou (ex.: o assistente criou uma tarefa e a tela recarregou): usa a nova
  const [base, setBase] = useState(inicial);
  if (inicial !== base) {
    setBase(inicial);
    setTarefas(inicial);
  }
  const [texto, setTexto] = useState("");
  const [clienteEscolhido, setClienteEscolhido] = useState(clienteFixo ?? DESCOBRIR);
  const [dataEscolhida, setDataEscolhida] = useState("");
  const [aguardandoNova, setAguardandoNova] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [empresa, setEmpresa] = useState<string | null>(null);
  const [sugestoes, setSugestoes] = useState(sugestoesIniciais);
  const mic = useMicrofone(setTexto, (e) => setErro(e));

  const porId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);
  const previa = texto.trim() ? dataDoTexto(texto, hoje) : null;

  async function enviar(corpo: object, otimista?: (xs: Tarefa[]) => Tarefa[]) {
    setErro(null);
    const antes = tarefas;
    if (otimista) setTarefas(otimista(tarefas));
    try {
      setTarefas(await chamar(corpo));
      router.refresh(); // atualiza o contador do menu
      return true;
    } catch (e) {
      setTarefas(antes);
      setErro(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function adicionar(e?: React.FormEvent) {
    e?.preventDefault();
    if (!texto.trim() || salvando) return;
    mic.parar();
    setSalvando(true);
    const ok = await enviar({
      op: "criar", texto,
      ...(clienteEscolhido === DESCOBRIR ? {} : { clienteId: clienteEscolhido }),
      ...(dataEscolhida ? { data: dataEscolhida } : {}),
      aguardando: aguardandoNova,
    });
    setSalvando(false);
    if (ok) {
      setTexto("");
      setDataEscolhida("");
      setAguardandoNova(false);
      if (!clienteFixo) setClienteEscolhido(DESCOBRIR);
    }
  }

  const mudar = (t: Tarefa, mudanca: Partial<Tarefa>) =>
    enviar({ op: "mudar", id: t.id, mudanca }, (xs) => xs.map((x) => (x.id === t.id ? { ...x, ...mudanca, ...(mudanca.feita ? { feitaEm: new Date().toISOString() } : {}) } : x)));
  const excluir = (t: Tarefa) => {
    if (!confirm(`Apagar a tarefa “${t.titulo}”?`)) return;
    enviar({ op: "excluir", id: t.id }, (xs) => xs.filter((x) => x.id !== t.id));
  };

  // filtro: o cliente da tela, ou a empresa escolhida nos botões
  const visiveis = tarefas.filter((t) => {
    if (clienteFixo) return t.clienteId === clienteFixo;
    if (!empresa) return true;
    const c = t.clienteId ? porId.get(t.clienteId) : null;
    return empresa === "__geral__" ? !c : c?.empresa === empresa;
  });
  const abertas = visiveis.filter((t) => !t.feita).sort((a, b) => a.data.localeCompare(b.data) || a.criadaEm.localeCompare(b.criadaEm));
  const atrasadas = abertas.filter((t) => !t.aguardando && t.data < hoje);
  const deHoje = abertas.filter((t) => !t.aguardando && t.data === hoje);
  const aguardando = abertas.filter((t) => t.aguardando);
  const proximas = abertas.filter((t) => !t.aguardando && t.data > hoje);
  const feitas = visiveis.filter((t) => t.feita).sort((a, b) => (b.feitaEm ?? "").localeCompare(a.feitaEm ?? ""));
  const feitasHoje = feitas.filter((t) => t.feitaEm && diaEmBrasilia(t.feitaEm) === hoje);

  const empresas = [...new Set(clientes.map((c) => c.empresa))];
  const sugestoesVisiveis = sugestoes.filter((x) => !empresa || (empresa === "__geral__" ? false : porId.get(x.clienteId)?.empresa === empresa));
  async function aceitar(x: SugestaoTarefa) {
    setSugestoes((xs) => xs.filter((y) => y.chave !== x.chave));
    const ok = await enviar({ op: "criar", texto: x.titulo, clienteId: x.clienteId, data: hoje, origem: x.chave, link: x.link });
    if (!ok) setSugestoes((xs) => [x, ...xs]);
  }
  async function descartar(x: SugestaoTarefa) {
    setSugestoes((xs) => xs.filter((y) => y.chave !== x.chave));
    const ok = await enviar({ op: "descartar", chave: x.chave });
    if (!ok) setSugestoes((xs) => [x, ...xs]);
  }
  const contaEmpresa = (e: string | null) => tarefas.filter((t) => !t.feita && (e === null || (e === "__geral__" ? !t.clienteId || !porId.has(t.clienteId) : porId.get(t.clienteId ?? "")?.empresa === e))).length;
  const chip = (sel: boolean) => `rounded-full border px-3 py-1.5 text-sm ${sel ? "border-destaque bg-destaque-bg font-semibold text-texto" : "border-borda text-texto-2 hover:text-texto"}`;

  const linha = (t: Tarefa) => (
    <LinhaTarefa key={t.id} t={t} hoje={hoje} cliente={t.clienteId ? porId.get(t.clienteId) ?? null : null}
      clientes={clientes} mostrarCliente={!clienteFixo} mudar={mudar} excluir={excluir} />
  );

  return (
    <div className="space-y-5">
      <form onSubmit={adicionar} className="space-y-2 rounded-2xl border border-borda bg-superficie p-3">
        <div className="flex gap-2">
          <input
            value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus={!clienteFixo}
            placeholder={clienteFixo ? "Nova tarefa (ex.: trocar criativo sexta)" : "Nova tarefa (ex.: trocar criativo do Kiko amanhã)"}
            className="min-h-11 min-w-0 flex-1 rounded-[10px] border border-borda bg-fundo px-3 text-[15px] outline-none focus:border-destaque"
          />
          <BotaoMicrofone ouvindo={mic.ouvindo} falar={() => mic.falar(texto)} />
          <button disabled={!texto.trim() || salvando} className="min-h-11 shrink-0 rounded-[10px] bg-destaque px-4 text-sm font-semibold text-white disabled:opacity-50">
            {salvando ? "…" : "Adicionar"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-texto-3">
          {!clienteFixo && (
            <select value={clienteEscolhido} onChange={(e) => setClienteEscolhido(e.target.value)} className="max-w-[55vw] rounded-lg border border-borda bg-fundo px-2 py-1.5 text-texto-2">
              <option value={DESCOBRIR}>Cliente: pelo texto</option>
              <option value="">Sem cliente (geral)</option>
              <OpcoesClientes clientes={clientes} />
            </select>
          )}
          <label className="flex items-center gap-1.5">
            Data
            <input type="date" value={dataEscolhida} onChange={(e) => setDataEscolhida(e.target.value)} className="rounded-lg border border-borda bg-fundo px-2 py-1 text-texto-2" />
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={aguardandoNova} onChange={(e) => setAguardandoNova(e.target.checked)} />
            Aguardando o cliente
          </label>
          {previa && (
            <span className="ml-auto">
              → {dataEscolhida ? rotuloData(dataEscolhida, hoje) : previa.data ? rotuloData(previa.data, hoje) : "Hoje"}
              {clienteEscolhido !== DESCOBRIR && clienteEscolhido && ` · ${porId.get(clienteEscolhido)?.nome ?? ""}`}
            </span>
          )}
        </div>
        {erro && <p className="text-sm text-critico">{erro}</p>}
      </form>

      {!clienteFixo && (
        <div className="flex flex-wrap gap-2">
          {[null, ...empresas, "__geral__"].map((e) => (
            <button key={e ?? "todas"} type="button" onClick={() => setEmpresa(e)} className={chip(e === empresa)}>
              {e === null ? "Todas" : e === "__geral__" ? "Sem cliente" : e} <span className="text-texto-3">{contaEmpresa(e)}</span>
            </button>
          ))}
        </div>
      )}

      {!clienteFixo && sugestoesVisiveis.length > 0 && (
        <details open className="rounded-2xl border border-destaque/40 bg-destaque-bg/20 p-3">
          <summary className="cursor-pointer text-sm font-bold">
            Sugestões do Dash <span className="font-normal text-texto-3">({sugestoesVisiveis.length}) · alertas de conta, sugestões da IA, relatório do mês e clientes parados</span>
          </summary>
          <ul className="mt-2 space-y-1.5">
            {sugestoesVisiveis.map((x) => (
              <li key={x.chave} className="flex flex-wrap items-center gap-2 rounded-xl border border-borda bg-superficie px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div>{x.titulo}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-texto-3">
                    <Link href={`/clientes/${x.clienteId}`} className="font-medium text-destaque">{porId.get(x.clienteId)?.nome ?? "Cliente"}</Link>
                    <span>{x.motivo}</span>
                    <Link href={x.link} className="underline">ver</Link>
                  </div>
                </div>
                <button type="button" onClick={() => aceitar(x)} className="rounded-lg bg-destaque px-3 py-1.5 text-xs font-semibold text-white">+ Tarefa de hoje</button>
                <button type="button" onClick={() => descartar(x)} className="rounded-lg border border-borda px-3 py-1.5 text-xs text-texto-2 hover:text-texto">Descartar</button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {clienteFixo ? (
        <div className="space-y-1">
          {abertas.length === 0 && <p className="py-3 text-sm text-texto-3">Nenhuma tarefa aberta para este cliente.</p>}
          {abertas.map(linha)}
        </div>
      ) : (
        <>
          {atrasadas.length > 0 && <Secao titulo="Atrasadas" cor="text-critico" n={atrasadas.length}>{atrasadas.map(linha)}</Secao>}
          <Secao titulo="Hoje" n={deHoje.length}>
            {deHoje.length ? deHoje.map(linha) : (
              <p className="py-3 text-sm text-texto-3">{atrasadas.length ? "Nada novo para hoje: zere as atrasadas acima." : feitasHoje.length ? "Tudo feito por hoje. ✓" : "Nada para hoje."}</p>
            )}
          </Secao>
          {aguardando.length > 0 && <Secao titulo="Aguardando o cliente" cor="text-atencao" n={aguardando.length} dica="Falta informação ou retorno. A data é quando cobrar.">{aguardando.map(linha)}</Secao>}
          {proximas.length > 0 && <Proximas tarefas={proximas} hoje={hoje} linha={linha} />}
        </>
      )}

      {feitas.length > 0 && (
        <details className="rounded-2xl border border-borda bg-superficie p-3">
          <summary className="cursor-pointer text-sm text-texto-2">Feitas <span className="text-texto-3">({feitasHoje.length} hoje · {feitas.length} nos últimos 30 dias)</span></summary>
          <div className="mt-2 space-y-1">{feitas.slice(0, 60).map(linha)}</div>
        </details>
      )}
    </div>
  );
}

function Secao({ titulo, n, cor, dica, children }: { titulo: string; n: number; cor?: string; dica?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h2 className={`flex items-baseline gap-2 text-sm font-bold uppercase tracking-wide ${cor ?? "text-texto"}`}>
        {titulo} <span className="text-xs font-medium text-texto-3">{n}</span>
        {dica && <span className="text-xs font-normal normal-case tracking-normal text-texto-3">· {dica}</span>}
      </h2>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

/** Próximas: agrupadas por dia (amanhã, quinta, 20/11…). */
function Proximas({ tarefas, hoje, linha }: { tarefas: Tarefa[]; hoje: string; linha: (t: Tarefa) => React.ReactNode }) {
  const dias = [...new Set(tarefas.map((t) => t.data))];
  const semana = somarDias(hoje, 7);
  return (
    <Secao titulo="Próximas" n={tarefas.length}>
      {dias.map((d) => (
        <div key={d} className="space-y-1 pt-1">
          <div className={`text-xs font-semibold ${d <= semana ? "text-texto-2" : "text-texto-3"}`}>{rotuloData(d, hoje)}</div>
          {tarefas.filter((t) => t.data === d).map(linha)}
        </div>
      ))}
    </Secao>
  );
}

function LinhaTarefa({ t, hoje, cliente, clientes, mostrarCliente, mudar, excluir }: {
  t: Tarefa; hoje: string; cliente: ClienteTarefa | null; clientes: ClienteTarefa[]; mostrarCliente: boolean;
  mudar: (t: Tarefa, m: Partial<Tarefa>) => void; excluir: (t: Tarefa) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(t.titulo);
  const [aberta, setAberta] = useState(false);
  const atrasada = !t.feita && t.data < hoje;
  const salvarTitulo = () => {
    setEditando(false);
    if (titulo.trim() && titulo.trim() !== t.titulo) mudar(t, { titulo: titulo.trim() });
    else setTitulo(t.titulo);
  };
  const botao = "rounded-lg border border-borda px-2 py-1 text-xs text-texto-2 hover:border-destaque hover:text-texto";

  return (
    <div className={`rounded-xl border border-borda bg-superficie px-3 py-2 ${t.feita ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <button type="button" onClick={() => mudar(t, { feita: !t.feita })} aria-label={t.feita ? "Desmarcar" : "Marcar como feita"}
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${t.feita ? "border-bom bg-bom text-white" : "border-borda hover:border-bom"}`}>
          {t.feita && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>}
        </button>
        <div className="min-w-0 flex-1">
          {editando ? (
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} autoFocus onBlur={salvarTitulo}
              onKeyDown={(e) => { if (e.key === "Enter") salvarTitulo(); if (e.key === "Escape") { setTitulo(t.titulo); setEditando(false); } }}
              className="w-full rounded-lg border border-destaque bg-fundo px-2 py-1 text-[15px] outline-none" />
          ) : (
            <button type="button" onClick={() => setAberta((x) => !x)} className={`block w-full text-left text-[15px] leading-snug ${t.feita ? "line-through" : ""}`}>
              {t.titulo}
            </button>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {mostrarCliente && (cliente
              ? <Link href={`/clientes/${cliente.id}`} className="rounded-md bg-destaque-bg px-1.5 py-0.5 font-medium text-destaque">{cliente.nome}</Link>
              : <span className="text-texto-3">Geral</span>)}
            {!t.feita && <span className={atrasada ? "font-semibold text-critico" : "text-texto-3"}>{t.aguardando ? "cobrar " : ""}{rotuloData(t.data, hoje).toLowerCase()}</span>}
            {t.aguardando && !t.feita && <span className="rounded-md bg-atencao-bg px-1.5 py-0.5 text-atencao">aguardando cliente</span>}
            {t.nota && <span className="text-texto-3" title={t.nota}>📝</span>}
            {t.link && !t.feita && <Link href={t.link} className="text-destaque underline">abrir</Link>}
            {t.origem && <span className="text-texto-3">· sugerida pelo Dash</span>}
          </div>
        </div>
        {!t.feita && t.data <= hoje && !aberta && (
          <button type="button" onClick={() => mudar(t, { data: somarDias(hoje, 1) })} className={`${botao} shrink-0`} title="Passar para amanhã">Amanhã →</button>
        )}
      </div>

      {aberta && (
        <div className="mt-2 space-y-2 border-t border-borda pt-2 pl-9">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setEditando(true)} className={botao}>Editar</button>
            {!t.feita && <>
              <button type="button" onClick={() => mudar(t, { data: somarDias(hoje, 1) })} className={botao}>Amanhã</button>
              <button type="button" onClick={() => mudar(t, { data: somarDias(hoje, 7) })} className={botao}>+1 semana</button>
              <input type="date" value={t.data} onChange={(e) => e.target.value && mudar(t, { data: e.target.value })} className="rounded-lg border border-borda bg-fundo px-2 py-1 text-xs text-texto-2" aria-label="Data" />
              <button type="button" onClick={() => mudar(t, { aguardando: !t.aguardando })} className={botao}>{t.aguardando ? "Não está mais aguardando" : "Aguardando o cliente"}</button>
            </>}
            <select value={t.clienteId ?? ""} onChange={(e) => mudar(t, { clienteId: e.target.value || null })} className="max-w-[60vw] rounded-lg border border-borda bg-fundo px-2 py-1 text-xs text-texto-2" aria-label="Cliente">
              <option value="">Sem cliente (geral)</option>
              <OpcoesClientes clientes={clientes} />
            </select>
            <button type="button" onClick={() => excluir(t)} className={`${botao} text-critico`}>Apagar</button>
          </div>
          <Nota t={t} mudar={mudar} />
        </div>
      )}
    </div>
  );
}

function Nota({ t, mudar }: { t: Tarefa; mudar: (t: Tarefa, m: Partial<Tarefa>) => void }) {
  const [nota, setNota] = useState(t.nota ?? "");
  return (
    <textarea value={nota} onChange={(e) => setNota(e.target.value)} onBlur={() => nota !== (t.nota ?? "") && mudar(t, { nota })}
      rows={2} placeholder="Anotação (detalhes, links…)" className="w-full rounded-lg border border-borda bg-fundo px-2 py-1.5 text-sm outline-none focus:border-destaque" />
  );
}
