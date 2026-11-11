"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Evento } from "@/lib/agenda";
import { Janela } from "./midia-meta";

const FUSO = "America/Sao_Paulo";
const diaDe = (e: Evento) => (e.diaInteiro ? e.inicio : new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date(e.inicio)));
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });

function rotuloDia(dia: string, hoje: string) {
  const d = (Date.parse(dia) - Date.parse(hoje)) / 86_400_000;
  if (d === 0) return "Hoje";
  if (d === 1) return "Amanhã";
  const nome = new Date(`${dia}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" });
  return `${nome[0].toUpperCase()}${nome.slice(1)}, ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

/** Compromissos do Google Agenda (próximos dias). Com `clienteId`: só os desse cliente. */
export function Agenda({ hoje, dias = 7, clienteId, clientes = [], recarregar = 0 }: {
  hoje: string; dias?: number; clienteId?: string; clientes?: { id: string; nome: string }[]; recarregar?: number;
}) {
  const [estado, setEstado] = useState<{ conectado: boolean; contas?: string[]; eventos: Evento[]; erro?: string } | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch(`/api/agenda?dias=${dias}${clienteId ? `&cliente=${clienteId}` : ""}`)
      .then((r) => r.json())
      .then((j) => vivo && setEstado(j))
      .catch(() => vivo && setEstado({ conectado: true, eventos: [], erro: "Não foi possível ler a agenda." }));
    return () => { vivo = false; };
  }, [dias, clienteId, recarregar]);

  if (!estado) return <p className="text-sm text-texto-3">Carregando a agenda…</p>;
  if (!estado.conectado) {
    return clienteId ? null : (
      <p className="text-sm text-texto-3">
        Google Agenda não conectado. <Link href="/configuracoes#agenda" className="text-destaque underline">Conectar</Link> para ver os compromissos aqui e marcar reuniões pelo cliente.
      </p>
    );
  }
  if (estado.erro) return <p className="text-sm text-critico">{estado.erro}</p>;
  const nomes = new Map(clientes.map((c) => [c.id, c.nome]));
  const porDia = new Map<string, Evento[]>();
  for (const e of estado.eventos) porDia.set(diaDe(e), [...(porDia.get(diaDe(e)) ?? []), e]);
  if (!estado.eventos.length) {
    return <p className="text-sm text-texto-3">{clienteId ? "Nenhuma reunião marcada com este cliente nos próximos dias." : `Nada na agenda nos próximos ${dias} dias.`}</p>;
  }
  return (
    <div className="space-y-2">
      {[...porDia.entries()].map(([dia, evs]) => (
        <div key={dia} className="space-y-1">
          <div className={`text-xs font-semibold ${dia === hoje ? "text-destaque" : "text-texto-3"}`}>{rotuloDia(dia, hoje)}</div>
          {evs.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-borda bg-superficie px-3 py-1.5 text-sm">
              <span className="num w-[86px] shrink-0 text-xs text-texto-3">{e.diaInteiro ? "dia inteiro" : `${hora(e.inicio)}–${hora(e.fim)}`}</span>
              <a href={e.link ?? "#"} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate hover:text-destaque">{e.titulo}</a>
              {!clienteId && e.clienteId && nomes.has(e.clienteId) && (
                <Link href={`/clientes/${e.clienteId}`} className="rounded-md bg-destaque-bg px-1.5 py-0.5 text-xs font-medium text-destaque">{nomes.get(e.clienteId)}</Link>
              )}
              {(estado.contas?.length ?? 0) > 1 && <span className="text-[11px] text-texto-3" title={e.conta}>{e.conta.split("@")[0]}</span>}
              {e.meet && <a href={e.meet} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-bom underline">Meet</a>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Botão "Marcar reunião" do cliente: cria o evento no Google Agenda (com Meet, se quiser). */
export function MarcarReuniao({ clienteId, nomeCliente, hoje, classe, aoMarcar }: {
  clienteId: string; nomeCliente: string; hoje: string; classe?: string; aoMarcar?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [f, setF] = useState({ titulo: `Reunião · ${nomeCliente}`, dia: hoje, hora: "10:00", minutos: 30, meet: true, convidados: "", descricao: "", conta: "" });
  const [contas, setContas] = useState<string[]>([]);
  function abrir() {
    setAberto(true);
    setFeito(null);
    // as agendas conectadas (para escolher onde marcar, se houver mais de uma)
    fetch("/api/agenda?dias=1").then((r) => r.json()).then((j) => setContas(j.contas ?? [])).catch(() => null);
  }
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<Evento | null>(null);

  async function marcar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch("/api/agenda", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clienteId, titulo: f.titulo, inicio: `${f.dia}T${f.hora}`, minutos: f.minutos, meet: f.meet, descricao: f.descricao,
          ...(f.conta ? { conta: f.conta } : {}),
          convidados: f.convidados.split(/[\s,;]+/).filter(Boolean),
        }),
      });
      const j = await r.json().catch(() => ({ erro: `erro ${r.status}` }));
      if (!r.ok || j.erro) throw new Error(j.erro ?? `erro ${r.status}`);
      setFeito(j.evento);
      aoMarcar?.();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  const campo = "min-h-10 w-full rounded-lg border border-borda bg-fundo px-3 text-sm";
  return (
    <>
      <button type="button" onClick={abrir} className={classe ?? "inline-flex min-h-[42px] items-center rounded-[10px] border border-borda bg-superficie px-4 text-sm font-semibold hover:border-destaque"}>
        Marcar reunião
      </button>
      {aberto && (
        <Janela titulo={`Marcar reunião · ${nomeCliente}`} onFechar={() => setAberto(false)} largura="max-w-lg">
          {feito ? (
            <div className="space-y-3 text-sm">
              <p className="text-bom">✓ Marcada no Google Agenda: <b>{feito.titulo}</b>, {new Date(feito.inicio).toLocaleString("pt-BR", { timeZone: FUSO, weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.</p>
              {feito.meet && <p>Link do Meet: <a href={feito.meet} target="_blank" rel="noopener noreferrer" className="text-destaque underline">{feito.meet}</a> <button type="button" onClick={() => navigator.clipboard?.writeText(feito.meet!)} className="ml-1 text-xs underline">copiar</button></p>}
              <div className="flex gap-2">
                {feito.link && <a href={feito.link} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-borda px-3 py-1.5">Abrir na agenda</a>}
                <button type="button" onClick={() => setAberto(false)} className="rounded-lg bg-destaque px-3 py-1.5 font-semibold text-white">Fechar</button>
              </div>
            </div>
          ) : (
            <form onSubmit={marcar} className="space-y-3 text-sm">
              <label className="block space-y-1"><span className="text-xs text-texto-3">Título</span>
                <input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} className={campo} /></label>
              <div className="grid grid-cols-3 gap-2">
                <label className="col-span-3 space-y-1 sm:col-span-1"><span className="text-xs text-texto-3">Dia</span>
                  <input type="date" value={f.dia} min={hoje} onChange={(e) => setF({ ...f, dia: e.target.value })} className={campo} /></label>
                <label className="space-y-1"><span className="text-xs text-texto-3">Horário</span>
                  <input type="time" value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} className={campo} /></label>
                <label className="space-y-1"><span className="text-xs text-texto-3">Duração</span>
                  <select value={f.minutos} onChange={(e) => setF({ ...f, minutos: Number(e.target.value) })} className={campo}>
                    {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60}h${m % 60 ? "30" : ""}`}</option>)}
                  </select></label>
              </div>
              {contas.length > 1 && (
                <label className="block space-y-1"><span className="text-xs text-texto-3">Marcar na agenda</span>
                  <select value={f.conta || contas[0]} onChange={(e) => setF({ ...f, conta: e.target.value })} className={campo}>
                    {contas.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select></label>
              )}
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.meet} onChange={(e) => setF({ ...f, meet: e.target.checked })} /> Criar link do Google Meet</label>
              <label className="block space-y-1"><span className="text-xs text-texto-3">Convidar (e-mails, opcional: o Google manda o convite)</span>
                <input value={f.convidados} onChange={(e) => setF({ ...f, convidados: e.target.value })} placeholder="cliente@empresa.com" className={campo} /></label>
              <label className="block space-y-1"><span className="text-xs text-texto-3">Pauta (opcional)</span>
                <textarea value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} rows={3} className="w-full rounded-lg border border-borda bg-fundo px-3 py-2 text-sm" /></label>
              {erro && <p className="text-critico">{erro}</p>}
              <button disabled={ocupado} className="rounded-[10px] bg-destaque px-4 py-2 font-semibold text-white disabled:opacity-60">{ocupado ? "Marcando…" : "Marcar na agenda"}</button>
            </form>
          )}
        </Janela>
      )}
    </>
  );
}

/** Reuniões do cliente + botão de marcar (na tela do cliente). */
export function ReunioesDoCliente({ clienteId, nomeCliente, hoje }: { clienteId: string; nomeCliente: string; hoje: string }) {
  const [versao, setVersao] = useState(0);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Reuniões (próximos 30 dias)</h3>
        <MarcarReuniao clienteId={clienteId} nomeCliente={nomeCliente} hoje={hoje} aoMarcar={() => setVersao((v) => v + 1)}
          classe="rounded-lg border border-borda px-3 py-1.5 text-xs font-semibold hover:border-destaque" />
      </div>
      <Agenda hoje={hoje} dias={30} clienteId={clienteId} recarregar={versao} />
    </div>
  );
}
