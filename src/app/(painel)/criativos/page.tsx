import Link from "next/link";
import { resolverPeriodo } from "@/lib/datas";
import { db, EMPRESA_PADRAO, type Cliente } from "@/lib/db";
import { listarCriativos, type Criativo, type Selo } from "@/lib/criativos";
import { decimal, dinheiro, inteiro, pct } from "@/lib/formato";
import { Aviso, SeletorPeriodo, SeloStatus } from "@/components/ui";
import { Miniatura } from "@/components/miniatura";

const ATIVOS = ["ACTIVE", "IN_PROCESS", "PENDING_REVIEW", "PREAPPROVED"];
const LIMITE = 60;

const ORDENS = [
  { chave: "gasto", rotulo: "Mais investimento", f: (c: Criativo) => -c.gasto },
  { chave: "resultados", rotulo: "Mais resultados", f: (c: Criativo) => -c.resultados },
  { chave: "cpr", rotulo: "Menor custo/result.", f: (c: Criativo) => c.cpr ?? Infinity },
  { chave: "ctr", rotulo: "Maior CTR", f: (c: Criativo) => -(c.ctr ?? 0) },
  { chave: "gancho", rotulo: "Melhor gancho (vídeo)", f: (c: Criativo) => -(c.video?.gancho ?? -1) },
] as const;

const SELOS: Record<Selo, { rotulo: string; icone: string; classe: string; dica: string }> = {
  vencedor: { rotulo: "Vencedor", icone: "★", classe: "bg-bom-bg text-bom", dica: "custo por resultado 40% abaixo da média do cliente" },
  saturando: { rotulo: "Saturando", icone: "▼", classe: "bg-atencao-bg text-atencao", dica: "CTR caiu 30% nos últimos 3 dias e frequência alta" },
  sem_resultado: { rotulo: "Sem resultado", icone: "■", classe: "bg-critico-bg text-critico", dica: "gastou o dobro do custo médio sem nenhum resultado" },
};

type Busca = {
  p?: string; de?: string; ate?: string; empresa?: string; cliente?: string;
  ordem?: string; formato?: string; status?: string; selo?: string;
};

export default async function Criativos({ searchParams }: PageProps<"/criativos">) {
  const busca = (await searchParams) as Busca;
  const { atual } = resolverPeriodo(busca);
  const { data: clientesRaw } = await db().from("clientes").select("id, nome, empresa").eq("ativo", true).order("nome");
  const clientes = (clientesRaw ?? []) as Pick<Cliente, "id" | "nome" | "empresa">[];
  const empresas = [...new Set(clientes.map((c) => c.empresa || EMPRESA_PADRAO))].sort();
  const empresa = busca.empresa && empresas.includes(busca.empresa) ? busca.empresa : undefined;
  const cliente = clientes.find((c) => c.id === busca.cliente);

  let todos: Criativo[] = [];
  let erro: string | null = null;
  try {
    todos = await listarCriativos(atual, { clienteId: cliente?.id, empresa });
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  }

  const ordem = ORDENS.find((o) => o.chave === busca.ordem) ?? ORDENS[0];
  const selo = busca.selo && busca.selo in SELOS ? (busca.selo as Selo) : null;
  const filtrados = todos
    .filter((c) => !busca.formato || c.formato === busca.formato)
    .filter((c) => busca.status !== "ativos" || (c.status && ATIVOS.includes(c.status)))
    .filter((c) => !selo || c.selos.includes(selo))
    .sort((a, b) => ordem.f(a) - ordem.f(b));
  const mostrados = filtrados.slice(0, LIMITE);
  const semVideo = todos.some((c) => c.formato === "video") && !todos.some((c) => c.video);

  // monta o link mantendo os filtros atuais
  const link = (mudar: Partial<Busca>) => {
    const q = new URLSearchParams();
    const tudo = { ...busca, ...mudar };
    for (const [k, v] of Object.entries(tudo)) if (v) q.set(k, v);
    return `/criativos?${q.toString()}`;
  };
  const extra = Object.fromEntries(
    Object.entries({ empresa, cliente: cliente?.id, ordem: busca.ordem, formato: busca.formato, status: busca.status, selo: busca.selo })
      .filter(([, v]) => v),
  ) as Record<string, string>;
  const chip = (ativo: boolean) =>
    `rounded-full border px-3 py-1 ${ativo ? "border-destaque bg-superficie font-medium" : "border-borda text-texto-2 hover:text-texto"}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Criativos{cliente ? ` · ${cliente.nome}` : empresa ? ` · ${empresa}` : ""}</h1>
          <p className="text-sm text-texto-2">
            {inteiro(todos.length)} anúncios do Meta veicularam no período · ordenados por {ordem.rotulo.toLowerCase()}
          </p>
        </div>
        <SeletorPeriodo atual={atual} base="/criativos" extra={extra} />
      </div>

      {/* filtros */}
      <div className="space-y-2 text-sm">
        <form action="/criativos" className="flex flex-wrap items-center gap-2">
          {Object.entries({ p: busca.p, de: busca.de, ate: busca.ate, ordem: busca.ordem, formato: busca.formato, status: busca.status, selo: busca.selo })
            .filter(([, v]) => v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <select name="empresa" defaultValue={empresa ?? ""} className="rounded-lg border border-borda bg-fundo px-2 py-1.5">
            <option value="">Todas as empresas</option>
            {empresas.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          <select name="cliente" defaultValue={cliente?.id ?? ""} className="rounded-lg border border-borda bg-fundo px-2 py-1.5">
            <option value="">Todos os clientes</option>
            {clientes.filter((c) => !empresa || (c.empresa || EMPRESA_PADRAO) === empresa)
              .map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <button className="rounded-lg border border-borda bg-superficie px-3 py-1.5 hover:border-destaque">Filtrar</button>
        </form>
        <div className="flex flex-wrap gap-1">
          <Link href={link({ selo: undefined })} className={chip(!selo)}>Todos ({todos.length})</Link>
          {(Object.keys(SELOS) as Selo[]).map((s) => (
            <Link key={s} href={link({ selo: s })} className={chip(selo === s)} title={SELOS[s].dica}>
              {SELOS[s].icone} {SELOS[s].rotulo} ({todos.filter((c) => c.selos.includes(s)).length})
            </Link>
          ))}
          <span className="mx-1 border-l border-borda" />
          {[{ v: undefined, r: "Todos os formatos" }, { v: "video", r: "Vídeos" }, { v: "imagem", r: "Imagens" }].map((f) => (
            <Link key={f.r} href={link({ formato: f.v })} className={chip(busca.formato === f.v)}>{f.r}</Link>
          ))}
          <span className="mx-1 border-l border-borda" />
          <Link href={link({ status: busca.status === "ativos" ? undefined : "ativos" })} className={chip(busca.status === "ativos")}>
            Só ativos
          </Link>
        </div>
        <div className="flex flex-wrap gap-1">
          {ORDENS.map((o) => (
            <Link key={o.chave} href={link({ ordem: o.chave })} className={chip(o.chave === ordem.chave)}>{o.rotulo}</Link>
          ))}
        </div>
      </div>

      {erro && <Aviso>Erro ao carregar os criativos: {erro}</Aviso>}
      {semVideo && (
        <Aviso>
          As métricas de vídeo (gancho e retenção) aparecem depois de rodar o SQL 0010 no Supabase e clicar em
          “Recarregar últimos 30 dias” em <Link href="/configuracoes" className="text-destaque underline">Configurações</Link>.
        </Aviso>
      )}
      {!erro && !filtrados.length && <Aviso>Nenhum criativo com esses filtros no período.</Aviso>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {mostrados.map((c) => <CardCriativo key={c.id} c={c} mostrarCliente={!cliente} />)}
      </div>
      {filtrados.length > mostrados.length && (
        <p className="text-sm text-texto-3">
          Mostrando {LIMITE} de {filtrados.length}. Use os filtros para ver os outros.
        </p>
      )}
      <p className="text-xs text-texto-3">
        Gancho = reproduções de 3 segundos ÷ impressões. Retenção = ThruPlays (15 s ou o vídeo inteiro) ÷ reproduções de 3 s.
        As barras mostram quantos dos que deram play chegaram a 25%, 50%, 75% e 100% do vídeo. Frequência é aproximada.
      </p>
    </div>
  );
}

function CardCriativo({ c, mostrarCliente }: { c: Criativo; mostrarCliente: boolean }) {
  const corpo = (
    <>
      <div className="relative">
        <Miniatura src={c.miniatura} alt={c.nome} formato={c.formato} />
        {c.selos.length > 0 && (
          <div className="absolute left-2 top-2 flex flex-wrap gap-1">
            {c.selos.map((s) => (
              <span key={s} className={`rounded-full px-2 py-0.5 text-[11px] font-medium shadow-sm ${SELOS[s].classe}`} title={SELOS[s].dica}>
                {SELOS[s].icone} {SELOS[s].rotulo}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-2 p-3">
        <div>
          <div className="flex items-center gap-2">
            <SeloStatus status={c.status} />
            <span className="truncate text-sm font-medium" title={c.nome}>{c.nome}</span>
          </div>
          <div className="truncate text-xs text-texto-3" title={`${c.campanha ?? ""} · ${c.conjunto ?? ""}`}>
            {mostrarCliente && <>{c.cliente.nome} · </>}{c.campanha ?? "—"}
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-x-2 gap-y-1 text-xs">
          <Dado rotulo="Investido" valor={dinheiro(c.gasto)} />
          <Dado rotulo={c.tipoResultado ?? "Resultados"} valor={inteiro(c.resultados)} />
          <Dado rotulo="Custo/result." valor={c.resultados ? dinheiro(c.cpr) : "—"} alerta={c.selos.includes("sem_resultado")} />
          <Dado rotulo="CTR" valor={pct(c.ctr)} alerta={c.selos.includes("saturando")} />
          <Dado rotulo="Frequência" valor={decimal(c.frequencia)} />
          <Dado rotulo="Impressões" valor={inteiro(c.impressoes)} />
        </dl>
        {c.selos.includes("saturando") && c.ctrAntes != null && c.ctrRecente != null && (
          <p className="text-xs text-atencao">CTR caiu de {pct(c.ctrAntes)} para {pct(c.ctrRecente)} nos últimos 3 dias.</p>
        )}
        {c.video && <BlocoVideo v={c.video} />}
        {c.link && (
          <a href={c.link} target="_blank" rel="noreferrer" className="inline-block text-xs text-destaque underline">
            Ver o anúncio ↗
          </a>
        )}
      </div>
    </>
  );
  return <div className="overflow-hidden rounded-xl border border-borda bg-superficie">{corpo}</div>;
}

function Dado({ rotulo, valor, alerta }: { rotulo: string; valor: string; alerta?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-texto-3" title={rotulo}>{rotulo}</dt>
      <dd className={`num font-medium ${alerta ? "text-critico" : ""}`}>{valor}</dd>
    </div>
  );
}

/** Gancho, retenção e curva de quartis (uma série só, mesma cor). */
function BlocoVideo({ v }: { v: NonNullable<Criativo["video"]> }) {
  return (
    <div className="rounded-lg bg-fundo p-2 text-xs">
      <div className="flex justify-between">
        <span>Gancho <span className="num font-medium">{pct(v.gancho)}</span></span>
        <span>Retenção <span className="num font-medium">{pct(v.retencao)}</span></span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1" aria-label="Quanto do vídeo foi assistido por quem deu play">
        {v.quartis.map((q, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            <span className="num text-center text-[11px] font-medium">{q.toFixed(0)}%</span>
            <div className="h-1.5 w-full rounded-full bg-borda">
              <div className="h-full rounded-full bg-destaque" style={{ width: `${q}%` }} />
            </div>
            <span className="text-center text-[10px] text-texto-3">viu {(i + 1) * 25}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
