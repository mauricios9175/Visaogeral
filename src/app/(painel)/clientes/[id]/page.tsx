import Link from "next/link";
import { Ordenavel } from "@/components/ordenavel";
import { notFound } from "next/navigation";
import { resolverPeriodo } from "@/lib/datas";
import { detalheCliente, detalheCrm, DIMENSOES_UTM, somarGeral, type DimensaoUtm, type LinhaTabela } from "@/lib/consultas";
import { detalheGoogle } from "@/lib/consultas-google";
import { formatarIdGoogle } from "@/lib/google";
import { decimal, dinheiro, inteiro, pct, quandoFoi } from "@/lib/formato";
import { Aviso, Kpi, SeletorPeriodo, SeloStatus, TiposResultado, Variacao, Voltar } from "@/components/ui";
import { BarrasDiarias } from "@/components/graficos";
import { AnaliseIA } from "@/components/analise-ia";
import { SugestoesIA, type AcaoPainel } from "@/components/sugestoes-ia";
import { LinkCliente } from "@/components/link-cliente";
import { ListaRascunhos } from "@/components/lista-rascunhos";
import { listarRascunhos } from "@/lib/rascunhos";
import { TabelaGoogle, type LinhaTabelaGoogle } from "@/components/google-niveis";
import { NIVEIS_GOOGLE } from "@/lib/niveis-google";
import { AdicionarPalavras, NovoAnuncioGoogle } from "@/components/criar-google";
import { nivelGoogle, type LinhaNivelGoogle } from "@/lib/google";
import { acessoGoogle } from "@/lib/acesso-google";
import { linkDoCliente } from "@/lib/portal";
import { lerHistoricoSugestoes, lerParams } from "@/lib/sugestoes";
import { PARAMS_PADRAO } from "@/lib/manual-ia";
import { AcoesRapidas, type DestinosDuplicar } from "@/components/acoes-rapidas";
import { db } from "@/lib/db";
import { PuxarHistoricoMeta } from "@/components/puxar-historico";
import { chaveDe, gastoPorNome, NIVEL_DA_UTM } from "@/lib/agrupar";


// publicar rascunhos (com vídeo) pode levar alguns minutos
export const maxDuration = 300;

const NIVEIS = [
  { chave: "campanhas", rotulo: "Campanhas" },
  { chave: "conjuntos", rotulo: "Conjuntos" },
  { chave: "anuncios", rotulo: "Anúncios" },
] as const;

const ATIVOS = ["ACTIVE", "IN_PROCESS", "PENDING_REVIEW", "PREAPPROVED"];

const FILTROS = [
  { chave: "todos", rotulo: "Todos", aceita: () => true },
  { chave: "ativos", rotulo: "Ativos", aceita: (s: string | null) => !!s && ATIVOS.includes(s) },
  { chave: "pausados", rotulo: "Pausados", aceita: (s: string | null) => !s || !ATIVOS.includes(s) },
] as const;

export default async function PaginaCliente({ params, searchParams }: PageProps<"/clientes/[id]">) {
  const { id } = await params;
  const busca = (await searchParams) as {
    p?: string; de?: string; ate?: string; nivel?: string; status?: string; utm?: string; msg?: string;
    campanha?: string; conjunto?: string;
    gnivel?: string; gcampanha?: string; ggrupo?: string; // navegação no Google
  };
  const dimensao = (DIMENSOES_UTM.find((x) => x.chave === busca.utm) ?? DIMENSOES_UTM[0]).chave;
  const { nivel } = busca;
  const filtro = FILTROS.find((f) => f.chave === busca.status) ?? FILTROS[0];
  const { atual, anterior } = resolverPeriodo(busca);
  // O CRM não pode derrubar a tela do cliente: se falhar, mostra o erro só na seção dele.
  const [d, crm, google, { data: historico }] = await Promise.all([
    detalheCliente(id, atual, anterior, { recentes: true }).catch((e: unknown) => ({ erroGeral: e instanceof Error ? e.message : String(e) })),
    detalheCrm(id, atual, anterior).catch((e: unknown) => ({ erro: e instanceof Error ? e.message : String(e) })),
    detalheGoogle(id, atual, anterior).catch((e: unknown) => ({ erro: e instanceof Error ? e.message : String(e) })),
    db().from("acoes_log").select("*").eq("cliente_id", id).order("criado_em", { ascending: false }).limit(30),
  ]);
  const [paramsIA, historicoIA, tokenPortal, rascunhos] = await Promise.all([
    lerParams(id).catch(() => PARAMS_PADRAO),
    lerHistoricoSugestoes(id).catch(() => []),
    linkDoCliente(id).catch(() => null),
    listarRascunhos(id).catch(() => []),
  ]);
  // ações feitas pelo painel depois da sugestão mais antiga guardada (para marcar "✓ feito")
  const desdeIA = historicoIA.at(-1)?.criado_em;
  const { data: acoesIA } = desdeIA
    ? await db().from("acoes_log").select("objeto_id, acao, depois, criado_em").eq("cliente_id", id).eq("ok", true).gte("criado_em", desdeIA)
    : { data: [] };
  if (!d) notFound();
  // Em produção o Next esconde a mensagem do erro; mostramos aqui para facilitar o diagnóstico.
  if ("erroGeral" in d) {
    return (
      <div className="space-y-3">
        <Voltar href={`/?${atual.qs}`}>Visão geral</Voltar>
        <Aviso>Erro ao carregar o cliente: {d.erroGeral}</Aviso>
      </div>
    );
  }
  const { cliente: c, atual: a, anterior: b } = d;
  // desde quando o painel tem os dados de cada conta (1º dia guardado ou até onde o histórico já foi puxado);
  // vale a conta mais "atrasada"
  const contasSync = d.contas.filter((x) => x.ativa_sync !== false);
  const inicioDasContas = await Promise.all(contasSync.map(async (x): Promise<string | null> => {
    const [{ data: primeira }, { data: marca }] = await Promise.all([
      db().from("metricas_diarias").select("data").eq("conta_id", x.id).order("data").limit(1).maybeSingle(),
      db().from("configuracoes").select("valor").eq("chave", `historico_meta:${x.id}`).maybeSingle(),
    ]);
    const datas = [primeira?.data as string | undefined, typeof marca?.valor === "string" ? marca.valor : undefined].filter(Boolean) as string[];
    return datas.sort()[0] ?? null;
  })).catch((): (string | null)[] => []);
  const primeiroDia = inicioDasContas.includes(null) ? null : (inicioDasContas as string[]).sort().at(-1) ?? null;
  const nivelAtual = NIVEIS.find((n) => n.chave === nivel) ?? NIVEIS[0];
  // navegação igual ao Gerenciador: escolher uma campanha filtra conjuntos e anúncios; um conjunto filtra os anúncios
  const campanhaSel = d.campanhas.find((x) => x.id === busca.campanha) ?? null;
  const conjuntoSel = d.conjuntos.find((x) => x.id === busca.conjunto) ?? null;
  const doRecorte = (n: (typeof NIVEIS)[number]["chave"]) => d[n].filter((l) =>
    filtro.aceita(l.status) &&
    (n === "campanhas" || !campanhaSel || l.campanhaId === campanhaSel.id) &&
    (n !== "anuncios" || !conjuntoSel || l.conjuntoId === conjuntoSel.id));
  const linhas = doRecorte(nivelAtual.chave);
  const recorte = `${campanhaSel ? `&campanha=${campanhaSel.id}` : ""}${conjuntoSel ? `&conjunto=${conjuntoSel.id}` : ""}`;
  const base = `/clientes/${id}`;
  // depois de uma ação rápida, volta para a mesma tela (mesmo período, nível e filtro)
  const voltar = `${base}?${atual.qs}&nivel=${nivelAtual.chave}&status=${filtro.chave}${recorte}${busca.utm ? `&utm=${busca.utm}` : ""}`;
  // O CRM compara com o investimento total em anúncios (Meta + Google)
  const g = google && !("erro" in google) ? google : null;
  const gastoTotal = a.gasto + (g?.atual.gasto ?? 0);
  const gastoTotalAnterior = b.gasto + (g?.anterior.gasto ?? 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2.5">
          <Voltar href={`/?${atual.qs}`}>Visão geral</Voltar>
          <div className="flex flex-wrap items-center gap-3.5">
            <span aria-hidden className="flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-destaque-bg text-lg font-extrabold text-destaque">
              {c.nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase()}
            </span>
            <div>
              <h1 className="text-[26px] font-extrabold tracking-tight lg:text-[28px]">{c.nome}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-texto-3">
                <span className="rounded-md bg-superficie-2 px-2 py-1 text-texto-2">{[c.empresa, c.nicho].filter(Boolean).join(" · ") || "Cliente"}</span>
                <span>
                  {d.contas.map((x) => x.nome + (x.pre_paga && x.saldo != null ? ` (saldo ${dinheiro(x.saldo)})` : "")).join(", ") || "Nenhuma conta vinculada"}
                  {d.contas[0] && <> · atualizado {quandoFoi(d.contas[0].ultima_sync)}</>}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <LinkCliente clienteId={id} token={tokenPortal} />
          <Link href={`${base}/historico#relatorio`} className="inline-flex min-h-[42px] items-center rounded-[10px] border border-borda bg-superficie px-4 text-sm font-semibold hover:border-destaque">
            Gerar relatório
          </Link>
          <Link href={`${base}/montar`} className="inline-flex min-h-[42px] items-center rounded-[10px] bg-destaque px-4 text-sm font-semibold text-white">
            + Campanha Meta
          </Link>
          <Link href={`${base}/montar-google`} className="inline-flex min-h-[42px] items-center rounded-[10px] border border-destaque px-4 text-sm font-semibold text-destaque hover:bg-destaque-bg">
            + Campanha Google
          </Link>
        </div>
      </header>

      <nav aria-label="Seções do cliente" className="-mt-2 flex flex-wrap gap-1 border-b border-borda text-sm">
        <span className="border-b-2 border-destaque px-3.5 py-3 font-bold" aria-current="page">Resultados</span>
        <Link href={`/criativos?cliente=${id}&${atual.qs}`} className="px-3.5 py-3 text-texto-2 hover:text-texto">Criativos</Link>
        <Link href={`${base}/historico`} className="px-3.5 py-3 text-texto-2 hover:text-texto">Histórico e relatório</Link>
        <Link href={`${base}/diagnostico`} className="px-3.5 py-3 text-texto-2 hover:text-texto">Diagnóstico</Link>
        <Link href={`${base}/crm`} className="px-3.5 py-3 text-texto-2 hover:text-texto">{crm && !("erro" in crm) ? "Configurar CRM" : "Conectar CRM"}</Link>
      </nav>

      <div className="flex justify-end">
        <SeletorPeriodo atual={atual} base={base} />
      </div>
      {busca.msg && <Aviso>{busca.msg}</Aviso>}

      <AnaliseIA clienteId={id} periodo={{ p: atual.chave, ...(atual.chave === "livre" ? { de: atual.desde, ate: atual.ate } : {}) }} rotuloPeriodo={atual.rotulo} />
      <SugestoesIA
        clienteId={id} params={paramsIA} cplMeta={c.cpl_meta} voltar={`${voltar}#sugestoes`} rotuloPeriodo={atual.rotulo}
        historico={historicoIA} acoesPainel={(acoesIA ?? []) as AcaoPainel[]}
        temMeta={d.contas.length > 0} temGoogle={!!g}
        periodo={{ p: atual.chave, ...(atual.chave === "livre" ? { de: atual.desde, ate: atual.ate } : {}) }}
      />

      {g && <ResumoGeral meta={a} metaAnt={b} g={g} metaCpl={c.cpl_meta} />}

      <ListaRascunhos clienteId={id} itens={rascunhos.map((r) => ({
        id: r.id, titulo: r.titulo, origem: r.origem, atualizadoEm: r.atualizadoEm, anuncios: r.criativos.length,
        conjuntos: r.destino?.conjunto ? 0 : r.config.conjuntos.length,
        onde: r.destino?.conjunto ? `no conjunto “${r.destino.conjunto.nome}”` : r.destino ? `na campanha “${r.destino.campanhaNome}”` : "campanha nova",
      }))} />

      <h2 className="text-lg font-bold">Meta Ads</h2>
      <PuxarHistoricoMeta contas={contasSync.map((x) => ({ id: x.id, nome: x.nome }))} desde={atual.desde} ate={atual.ate} primeiroDia={primeiroDia} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi rotulo="Investido" valor={dinheiro(a.gasto)} serie={d.serie.map((x) => x.gasto)}><Variacao atual={a.gasto} anterior={b.gasto} neutro /></Kpi>
        <Kpi rotulo="Resultados" valor={inteiro(a.resultados)} serie={d.serie.map((x) => x.resultados)}>
          <TiposResultado m={a} />
        </Kpi>
        <Kpi rotulo={`Custo/resultado${c.cpl_meta ? ` (alvo ${dinheiro(c.cpl_meta)})` : ""}`} valor={dinheiro(a.cpr)} serie={d.serie.map((x) => x.cpr ?? 0)} cor="var(--serie-2)">
          <Variacao atual={a.cpr} anterior={b.cpr} menorMelhor />
        </Kpi>
        <Kpi rotulo="CTR (link)" valor={pct(a.ctr)}><Variacao atual={a.ctr} anterior={b.ctr} /></Kpi>
        <Kpi rotulo="CPM" valor={dinheiro(a.cpm)}><Variacao atual={a.cpm} anterior={b.cpm} menorMelhor /></Kpi>
        {a.compras > 0 ? (
          <Kpi rotulo="ROAS" valor={decimal(a.roas)}>
            <span className="text-xs text-texto-3">{inteiro(a.compras)} compras · {dinheiro(a.valor_compras)}</span>
          </Kpi>
        ) : (
          <Kpi rotulo="Frequência média" valor={decimal(a.frequencia)}>
            <span className="text-xs text-texto-3">aproximada</span>
          </Kpi>
        )}
      </div>

      {crm && !("erro" in crm) && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <FunilDoPeriodo crm={crm} gasto={gastoTotal} />
          <AnunciosQueVendem linhas={crm.porUtm.utm_content} gastos={gastoPorNome(d.anuncios)} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <BarrasDiarias dados={d.serie} campo="gasto" titulo="Investido por dia" formato="dinheiro" />
        <BarrasDiarias dados={d.serie} campo="resultados" titulo="Resultados por dia" formato="inteiro" />
        <BarrasDiarias dados={d.serie} campo="cpr" titulo="Custo por resultado por dia" formato="dinheiro" />
      </div>

      <div id="tabela" className="scroll-mt-4 overflow-hidden rounded-2xl border border-borda bg-superficie">
        {(campanhaSel || conjuntoSel) && (
          <div className="flex flex-wrap items-center gap-1 border-b border-borda px-3 py-2 text-sm">
            <Link href={`${base}?${atual.qs}&nivel=campanhas&status=${filtro.chave}#tabela`} className="text-destaque underline">
              Todas as campanhas
            </Link>
            {campanhaSel && (
              <>
                <span className="text-texto-3">›</span>
                <Link
                  href={`${base}?${atual.qs}&nivel=conjuntos&status=${filtro.chave}&campanha=${campanhaSel.id}#tabela`}
                  className={conjuntoSel ? "text-destaque underline" : "font-medium"}
                >
                  {campanhaSel.nome}
                </Link>
              </>
            )}
            {conjuntoSel && (
              <>
                <span className="text-texto-3">›</span>
                <span className="font-medium">{conjuntoSel.nome}</span>
              </>
            )}
            <span className="ml-auto flex flex-wrap gap-1.5">
              {campanhaSel && !conjuntoSel && (
                <Link href={`${base}/montar?campanha=${campanhaSel.id}`} className="rounded-lg border border-destaque px-2.5 py-1 text-xs font-semibold text-destaque hover:bg-destaque-bg">
                  + Novo conjunto nesta campanha
                </Link>
              )}
              {conjuntoSel && (
                <Link href={`${base}/montar?conjunto=${conjuntoSel.id}`} className="rounded-lg border border-destaque px-2.5 py-1 text-xs font-semibold text-destaque hover:bg-destaque-bg">
                  + Novo anúncio neste conjunto
                </Link>
              )}
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1 border-b border-borda p-2 text-sm">
          {NIVEIS.map((n) => (
            <Link
              key={n.chave}
              href={`${base}?${atual.qs}&nivel=${n.chave}&status=${filtro.chave}${recorte}#tabela`}
              className={`rounded-[8px] px-3 py-1.5 ${n.chave === nivelAtual.chave ? "bg-destaque-bg font-semibold text-texto" : "text-texto-2 hover:text-texto"}`}
            >
              {n.rotulo} <span className="text-texto-3">({doRecorte(n.chave).length})</span>
            </Link>
          ))}
          <span className="ml-auto flex gap-1">
            {FILTROS.map((f) => (
              <Link
                key={f.chave}
                href={`${base}?${atual.qs}&nivel=${nivelAtual.chave}&status=${f.chave}${recorte}#tabela`}
                className={`rounded-[8px] px-3 py-1.5 ${f.chave === filtro.chave ? "bg-destaque-bg font-semibold text-texto" : "text-texto-2 hover:text-texto"}`}
              >
                {f.rotulo}
              </Link>
            ))}
          </span>
        </div>
        <Tabela
          linhas={linhas} meta={c.cpl_meta} nivel={nivelAtual.chave} voltar={voltar}
          abrir={(l) =>
            nivelAtual.chave === "campanhas" ? `${base}?${atual.qs}&nivel=conjuntos&status=${filtro.chave}&campanha=${l.id}#tabela`
            : nivelAtual.chave === "conjuntos" ? `${base}?${atual.qs}&nivel=anuncios&status=${filtro.chave}&campanha=${l.campanhaId}&conjunto=${l.id}#tabela`
            : null}
          destinos={{ campanhas: d.campanhas.map((x) => ({ id: x.id, nome: x.nome, conta: x.conta })), conjuntos: d.conjuntos.map((x) => ({ id: x.id, nome: x.nome, conta: x.conta, pai: x.pai ?? "" })) }}
        />
      </div>

      {google && ("erro" in google ? <Aviso>Erro ao carregar o Google Ads: {google.erro}</Aviso> : <SecaoGoogle g={google} nav={{
        clienteId: id, base, qs: atual.qs, desde: atual.desde, ate: atual.ate, nivel: busca.gnivel, campanha: busca.gcampanha, grupo: busca.ggrupo,
      }} />)}

      <SecaoCrm crm={crm} gasto={gastoTotal} gastoAnterior={gastoTotalAnterior} base={base} comGoogle={!!g}
        dimensao={dimensao} qs={atual.qs} periodo={atual}
        gastos={{
          // gasto do período por nome, para a coluna "Investido" das UTMs
          campanha: gastoPorNome([...d.campanhas, ...(g?.campanhas ?? [])]),
          conjunto: gastoPorNome(d.conjuntos),
          anuncio: gastoPorNome(d.anuncios),
        }} />

      {!!historico?.length && <Historico itens={historico as ItemHistorico[]} />}
    </div>
  );
}

/** Números principais com Meta + Google somados, e de onde veio cada parte. */
function ResumoGeral({ meta, metaAnt, g, metaCpl }: {
  meta: { gasto: number; resultados: number; cpr: number | null };
  metaAnt: { gasto: number; resultados: number };
  g: NonNullable<Awaited<ReturnType<typeof detalheGoogle>>>;
  metaCpl: number | null;
}) {
  const at = somarGeral(meta, g.atual);
  const an = somarGeral(metaAnt, g.anterior);
  const parte = (m: string, gg: string) => (
    <span className="block text-xs text-texto-3">Meta {m} · Google {gg}</span>
  );
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Resumo geral <span className="font-normal text-texto-3">· Meta + Google</span></h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Kpi rotulo="Investido" valor={dinheiro(at.gasto)}>
          {parte(dinheiro(meta.gasto), dinheiro(g.atual.gasto))}
          <Variacao atual={at.gasto} anterior={an.gasto} neutro />
        </Kpi>
        <Kpi rotulo="Resultados" valor={inteiro(at.resultados)}>
          {parte(inteiro(meta.resultados), inteiro(g.atual.conversoes))}
          <Variacao atual={at.resultados} anterior={an.resultados} />
        </Kpi>
        <Kpi rotulo={`Custo/resultado${metaCpl ? ` (alvo ${dinheiro(metaCpl)})` : ""}`} valor={dinheiro(at.cpr)}>
          {parte(dinheiro(meta.cpr), dinheiro(g.atual.cpa))}
          <Variacao atual={at.cpr} anterior={an.cpr} menorMelhor />
        </Kpi>
      </div>
    </section>
  );
}

const CANAL: Record<string, string> = {
  SEARCH: "Pesquisa", PERFORMANCE_MAX: "Performance Max", DISPLAY: "Display", VIDEO: "YouTube",
  DEMAND_GEN: "Demand Gen", DISCOVERY: "Demand Gen", SHOPPING: "Shopping", LOCAL: "Local", SMART: "Inteligente",
  MULTI_CHANNEL: "App",
};


type NavGoogle = { clienteId: string; base: string; qs: string; desde: string; ate: string; nivel?: string; campanha?: string; grupo?: string };

async function SecaoGoogle({ g, nav }: { g: NonNullable<Awaited<ReturnType<typeof detalheGoogle>>>; nav: NavGoogle }) {
  const { atual: x, anterior: y } = g;
  // navegação igual à do Google Ads: campanha → grupos → anúncios / palavras-chave / termos (lido na hora na API)
  const nivel = (NIVEIS_GOOGLE.find((n) => n.chave === nav.nivel) ?? NIVEIS_GOOGLE[0]).chave;
  const campSel = g.campanhas.find((c) => c.id === nav.campanha) ?? null;
  const grupoSel = nav.grupo && /^\d+$/.test(nav.grupo) ? nav.grupo : null;
  const url = (n: string, camp?: string | null, grupo?: string | null) =>
    `${nav.base}?${nav.qs}&gnivel=${n}${camp ? `&gcampanha=${camp}` : ""}${grupo ? `&ggrupo=${grupo}` : ""}#google`;
  const aqui = url(nivel, campSel?.id, grupoSel);
  let linhas: LinhaNivelGoogle[] = [];
  const errosNivel: string[] = [];
  if (nivel !== "campanhas") {
    const contas = campSel ? [campSel.contaId] : g.contas.map((c) => c.id);
    const partes = await Promise.all(contas.map(async (id) => {
      try {
        const { acesso, conta } = await acessoGoogle(id);
        return await nivelGoogle(acesso, id, conta?.login_customer_id ?? null, nivel, nav.desde, nav.ate, { campanhaId: campSel?.id, grupoId: grupoSel });
      } catch (e) {
        errosNivel.push(e instanceof Error ? e.message : String(e));
        return [];
      }
    }));
    linhas = partes.flat().sort((a, b) => b.gasto - a.gasto);
  }
  const contaDaCampanha = new Map(g.campanhas.map((c) => [c.id, c.contaId]));
  const nomeGrupo = grupoSel ? linhas.find((l) => l.grupoId === grupoSel)?.grupo ?? null : null;
  // linhas prontas para a tabela (link para descer um nível e a conta de cada uma, para as ações)
  const linhasTabela: LinhaTabelaGoogle[] = nivel === "campanhas"
    ? g.campanhas.map((c) => ({
        id: c.id, nome: c.nome, status: c.status ?? "", campanhaId: c.id, campanha: c.nome, grupoId: null, grupo: null,
        gasto: c.gasto, cliques: c.cliques, impressoes: c.impressoes, conversoes: c.conversoes, valor: c.valor,
        href: url("grupos", c.id), conta: c.contaId, orcamento: c.orcamento, compartilhado: c.compartilhado,
        info: [c.canal ? CANAL[c.canal] ?? c.canal : null, g.contas.length > 1 ? c.conta : null].filter(Boolean).join(" · "),
      }))
    : linhas.map((l) => ({
        ...l, conta: contaDaCampanha.get(l.campanhaId),
        href: nivel === "grupos" && l.grupoId ? url("anuncios", l.campanhaId, l.grupoId) : null,
      }));
  // grupo aberto: conta e campanha dele (para criar palavras-chave e anúncios)
  const campanhaDoGrupo = grupoSel ? linhas.find((l) => l.grupoId === grupoSel)?.campanhaId ?? campSel?.id ?? null : null;
  const contaDoGrupo = campanhaDoGrupo ? contaDaCampanha.get(campanhaDoGrupo) ?? null : null;
  // anúncio novo: as palavras-chave do grupo vão para a IA
  let palavrasDoGrupo: string[] = [];
  if (nivel === "anuncios" && grupoSel && contaDoGrupo) {
    try {
      const { acesso, conta } = await acessoGoogle(contaDoGrupo);
      palavrasDoGrupo = (await nivelGoogle(acesso, contaDoGrupo, conta?.login_customer_id ?? null, "palavras", nav.desde, nav.ate, { grupoId: grupoSel }))
        .map((l) => l.nome).filter(Boolean);
    } catch { /* sem as palavras, a IA escreve pelo nome do grupo */ }
  }
  const erros = g.contas.filter((c) => c.ultimo_erro);
  return (
    <section id="google" className="space-y-3">
      <h2 className="text-sm font-medium">
        Google Ads <span className="font-normal text-texto-3">
          · {g.contas.map((c) => `${c.nome} (${formatarIdGoogle(c.id)})`).join(", ")} · atualizado {quandoFoi(g.contas[0]?.ultima_sync ?? null)}
        </span>
      </h2>
      {erros.map((c) => <Aviso key={c.id}>Erro no Google Ads ({c.nome}): {c.ultimo_erro}</Aviso>)}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi rotulo="Investido" valor={dinheiro(x.gasto)}><Variacao atual={x.gasto} anterior={y.gasto} neutro /></Kpi>
        <Kpi rotulo="Conversões" valor={decimal(x.conversoes).replace(/,00$/, "")}>
          <Variacao atual={x.conversoes} anterior={y.conversoes} />
        </Kpi>
        <Kpi rotulo="Custo/conversão" valor={dinheiro(x.cpa)}><Variacao atual={x.cpa} anterior={y.cpa} menorMelhor /></Kpi>
        <Kpi rotulo="Cliques" valor={inteiro(x.cliques)}><Variacao atual={x.cliques} anterior={y.cliques} /></Kpi>
        <Kpi rotulo="CTR" valor={pct(x.ctr)}><Variacao atual={x.ctr} anterior={y.ctr} /></Kpi>
        {x.roas != null ? (
          <Kpi rotulo="ROAS" valor={decimal(x.roas)}>
            <span className="text-xs text-texto-3">{dinheiro(x.valor)} em valor de conversão</span>
          </Kpi>
        ) : (
          <Kpi rotulo="CPC" valor={dinheiro(x.cpc)}><Variacao atual={x.cpc} anterior={y.cpc} menorMelhor /></Kpi>
        )}
      </div>

      {g.porAcao.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {g.porAcao.map(([nome, qtd]) => (
            <span key={nome} className="rounded-full bg-superficie px-2 py-1 text-texto-2 ring-1 ring-borda">
              {nome}: <span className="num font-medium text-texto">{decimal(qtd).replace(/,00$/, "")}</span>
            </span>
          ))}
        </div>
      )}

      {g.serie.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <BarrasDiarias dados={g.serie} campo="gasto" titulo="Google · investido por dia" formato="dinheiro" />
          <BarrasDiarias dados={g.serie} campo="resultados" titulo="Google · conversões por dia" formato="inteiro" />
          <BarrasDiarias dados={g.serie} campo="cpr" titulo="Google · custo por conversão por dia" formato="dinheiro" />
        </div>
      )}

      <nav aria-label="Níveis do Google" className="flex flex-wrap gap-1 border-b border-borda text-sm">
        {NIVEIS_GOOGLE.map((n) => (
          <Link key={n.chave} href={url(n.chave, campSel?.id, n.chave === "campanhas" || n.chave === "grupos" ? null : grupoSel)}
            aria-current={n.chave === nivel ? "page" : undefined}
            className={`px-3 py-2 ${n.chave === nivel ? "border-b-2 border-destaque font-semibold" : "text-texto-2 hover:text-texto"}`}>
            {n.rotulo}
          </Link>
        ))}
      </nav>
      {(campSel || grupoSel) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-texto-2">
          <span>Filtrando:</span>
          {campSel && (
            <span className="inline-flex items-center gap-1 rounded-full bg-superficie-2 px-2.5 py-1">
              Campanha <b className="text-texto">{campSel.nome}</b>
              <Link href={url(nivel === "campanhas" ? "campanhas" : nivel)} className="text-texto-3 hover:text-critico" aria-label="Tirar filtro da campanha">✕</Link>
            </span>
          )}
          {grupoSel && (
            <span className="inline-flex items-center gap-1 rounded-full bg-superficie-2 px-2.5 py-1">
              Grupo <b className="text-texto">{nomeGrupo ?? grupoSel}</b>
              <Link href={url(nivel, campSel?.id)} className="text-texto-3 hover:text-critico" aria-label="Tirar filtro do grupo">✕</Link>
            </span>
          )}
        </div>
      )}
      {errosNivel.map((e, i) => <Aviso key={i}>Erro ao ler o Google Ads: {e}</Aviso>)}

      <div className="rounded-2xl border border-borda bg-superficie">
        <TabelaGoogle nivel={nivel} voltar={aqui} cpaMedio={x.cpa} linhas={linhasTabela} />
      </div>
      <p className="text-xs text-texto-3">
        Conversões = coluna “Conversões” do Google Ads (só as ações marcadas como principais). Em vermelho: custo por
        conversão 30% acima da média do cliente no Google, ou gasto sem conversão. Clique na campanha para ver os grupos e no
        grupo para ver anúncios, palavras-chave e termos (lidos na hora no Google).
      </p>
      {nivel === "palavras" && grupoSel && contaDoGrupo && (
        <AdicionarPalavras tipo="palavras" contaId={contaDoGrupo} objetoId={grupoSel} nome={nomeGrupo ?? grupoSel} voltar={aqui} />
      )}
      {(nivel === "palavras" || nivel === "termos") && campSel && (
        <AdicionarPalavras tipo="negativas" contaId={campSel.contaId} objetoId={campSel.id} nome={campSel.nome} voltar={aqui} />
      )}
      {nivel === "anuncios" && grupoSel && contaDoGrupo && (
        <NovoAnuncioGoogle
          clienteId={nav.clienteId} contaId={contaDoGrupo} grupoId={grupoSel} grupo={nomeGrupo ?? grupoSel} voltar={aqui}
          palavras={palavrasDoGrupo} atuais={linhas.flatMap((l) => l.nome.split(" | "))} urlPadrao={linhas.find((l) => l.extra?.url)?.extra?.url ?? ""}
        />
      )}
      {(nivel === "palavras" || nivel === "anuncios") && !grupoSel && (
        <p className="text-xs text-texto-3">Para adicionar palavras-chave ou criar um anúncio, abra um grupo (aba Grupos de anúncios → clique no grupo).</p>
      )}
    </section>
  );
}

const NIVEL_ACAO = { campanhas: "campanha", conjuntos: "conjunto", anuncios: "anuncio" } as const;

function Tabela({ linhas, meta, nivel, voltar, abrir, destinos }: {
  linhas: LinhaTabela[]; meta: number | null; nivel: keyof typeof NIVEL_ACAO; voltar: string;
  abrir: (l: LinhaTabela) => string | null;
  destinos: DestinosDuplicar;
}) {
  if (!linhas.length) return <p className="p-4 text-sm text-texto-3">Sem dados no período.</p>;
  const media = (() => {
    const g = linhas.reduce((s, l) => s + l.gasto, 0);
    const r = linhas.reduce((s, l) => s + l.resultados, 0);
    return r ? g / r : null;
  })();
  return (
    <div className="overflow-x-auto">
      <Ordenavel><table className="w-full text-sm">
        <thead className="text-left text-xs text-texto-3">
          <tr>
            <th className="px-4 py-2 font-normal">Nome</th>
            {["Investido", "Resultados", "Custo/result.", "CTR", "CPC", "CPM", "Freq."].map((h) => (
              <th key={h} className="px-3 py-2 text-right font-normal">{h}</th>
            ))}
            {nivel !== "anuncios" && <th className="px-3 py-2 text-right font-normal">Orçamento</th>}
            <th data-sem-ordem className="px-3 py-2 text-right font-normal">Ações</th>
          </tr>
        </thead>
        <tbody className="num">
          {linhas.map((l) => {
            const ref = meta ?? media;
            const caro = ref !== null && l.cpr !== null && l.cpr > ref * 1.3;
            const semResultado = l.gasto > 0 && l.resultados === 0;
            return (
              <tr key={l.id} className="border-t border-borda">
                <td className="max-w-80 px-4 py-2">
                  <div className="flex items-center gap-2">
                    <SeloStatus status={l.status} />
                    {abrir(l) ? (
                      <Link href={abrir(l)!} className="truncate text-destaque hover:underline" title={`Ver ${nivel === "campanhas" ? "conjuntos" : "anúncios"} de “${l.nome}”`}>
                        {l.nome}
                      </Link>
                    ) : (
                      <span className="truncate" title={l.nome}>{l.nome}</span>
                    )}
                  </div>
                  <div className="truncate text-xs text-texto-3">
                    {[l.tipo, l.pai].filter(Boolean).join(" · ")}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">{dinheiro(l.gasto)}</td>
                <td className="px-3 py-2 text-right">{inteiro(l.resultados)}</td>
                <td className={`px-3 py-2 text-right ${caro || semResultado ? "text-critico" : ""}`}>
                  {semResultado ? "sem resultado" : dinheiro(l.cpr)}
                </td>
                <td className="px-3 py-2 text-right">{pct(l.ctr)}</td>
                <td className="px-3 py-2 text-right">{dinheiro(l.cpc)}</td>
                <td className="px-3 py-2 text-right">{dinheiro(l.cpm)}</td>
                <td className="px-3 py-2 text-right">{decimal(l.frequencia)}</td>
                {nivel !== "anuncios" && (
                  <td className="px-3 py-2 text-right text-texto-2">
                    {l.orcamento ? `${dinheiro(l.orcamento.valor)}${l.orcamento.tipo === "dia" ? "/dia" : " total"}`
                      : nivel === "conjuntos" ? <span className="text-xs text-texto-3">na campanha</span> : "—"}
                  </td>
                )}
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1.5">
                  <Link href={`${voltar.split("?")[0]}/editar?nivel=${NIVEL_ACAO[nivel]}&id=${l.id}&voltar=${encodeURIComponent(voltar)}`}
                    className="rounded-md border border-borda bg-superficie px-2 py-0.5 text-xs hover:border-destaque" title="Editar nome, orçamento, público ou textos">
                    Editar
                  </Link>
                  <AcoesRapidas
                    plataforma="meta" contaId={l.conta} objetoId={l.id} nivel={NIVEL_ACAO[nivel]} nome={l.nome}
                    ativo={l.status === "ACTIVE" ? true : l.status === "PAUSED" ? false : null}
                    orcamento={l.orcamento} mostrarOrcamento={nivel !== "anuncios" && (!!l.orcamento || nivel === "conjuntos")}
                    voltar={voltar}
                    duplicar={{ destinos, campanhaAtual: l.campanhaId, conjuntoAtual: l.conjuntoId }}
                  />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></Ordenavel>
      <p className="px-4 py-2 text-xs text-texto-3">
        Em vermelho: custo por resultado 30% acima {meta ? "da meta" : "da média do cliente"}, ou gasto sem resultado.
      </p>
    </div>
  );
}

type GastosPorNivel = Record<"campanha" | "conjunto" | "anuncio", Map<string, number>>;

function SecaoCrm({ crm, gasto, gastoAnterior, base, comGoogle, dimensao, qs, periodo, gastos }: {
  crm: Awaited<ReturnType<typeof detalheCrm>> | { erro: string };
  gasto: number;
  gastoAnterior: number;
  base: string;
  comGoogle: boolean;
  dimensao: DimensaoUtm;
  qs: string;
  periodo: { desde: string; ate: string };
  gastos: GastosPorNivel;
}) {
  if (!crm) return null;
  if ("erro" in crm) return <Aviso>Erro ao carregar o CRM: {crm.erro}</Aviso>;
  const { atual: x, anterior: y, conexao } = crm;
  const div = (a: number, b: number | null) => (b ? a / b : null);
  if (conexao.ultimo_erro) {
    return (
      <Aviso>
        Erro no CRM: {conexao.ultimo_erro} · <Link href={`${base}/crm`} className="text-destaque underline">ver configuração</Link>
      </Aviso>
    );
  }
  const statusNegocio = (g: boolean | null) =>
    g === true ? <span className="text-bom">● Ganho</span>
    : g === false ? <span className="text-critico">■ Perdido</span>
    : <span className="text-texto-2">◐ Em aberto</span>;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">
        CRM <span className="font-normal text-texto-3">
          · atualizado {quandoFoi(conexao.ultima_sync)} · fontes de anúncio {crm.fontesManuais ? "escolhidas por você" : "detectadas automaticamente"}
          {" · "}<Link href={`${base}/crm`} className="text-destaque underline">ajustar</Link>
        </span>
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi rotulo="Leads no CRM" valor={inteiro(x.leads)}>
          <span className="block text-xs text-texto-3">{inteiro(x.leadsAnuncio)} de anúncio · {inteiro(x.leads - x.leadsAnuncio)} outras fontes</span>
          <span className="block text-xs text-texto-3">{dinheiro(div(gasto, x.leadsAnuncio))} por lead de anúncio</span>
          <Variacao atual={x.leadsAnuncio} anterior={y.leadsAnuncio} />
        </Kpi>
        <Kpi rotulo="Qualificados" valor={x.qualificados == null ? "—" : inteiro(x.qualificados)}>
          {x.qualificados == null || x.qualificadosAnuncio == null ? (
            <Link href={`${base}/crm`} className="text-xs text-destaque underline">definir etapa</Link>
          ) : (
            <span className="block text-xs text-texto-3">
              {inteiro(x.qualificadosAnuncio)} de anúncio · {dinheiro(div(gasto, x.qualificadosAnuncio))} cada
              {x.leadsAnuncio > 0 && ` · ${pct((x.qualificadosAnuncio / x.leadsAnuncio) * 100)} dos leads de anúncio`}
            </span>
          )}
        </Kpi>
        <Kpi rotulo="Vendas" valor={inteiro(x.vendas)}>
          <span className="block text-xs text-texto-3">
            {inteiro(x.vendasAnuncio)} de anúncio · {dinheiro(div(gasto, x.vendasAnuncio))} por venda
          </span>
        </Kpi>
        <Kpi rotulo="Faturamento" valor={dinheiro(x.faturamento)}>
          <span className="block text-xs text-texto-3">
            {dinheiro(x.faturamentoAnuncio)} de anúncio · ROAS real {decimal(div(x.faturamentoAnuncio, gasto))}
          </span>
          <Variacao atual={div(x.faturamentoAnuncio, gasto)} anterior={div(y.faturamentoAnuncio, gastoAnterior)} />
        </Kpi>
        <Kpi rotulo="Em negociação" valor={dinheiro(x.emNegociacao)}>
          <span className="block text-xs text-texto-3">valor dos negócios em aberto criados no período</span>
        </Kpi>
      </div>

      {crm.porFonte.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-borda bg-superficie">
          <Ordenavel><table className="w-full text-sm">
            <thead className="text-left text-xs text-texto-3">
              <tr>
                <th className="px-4 py-2 font-normal">Fonte no CRM</th>
                {["Leads", "Qualificados", "Vendas", "Faturamento", "Em negociação"].map((h) => (
                  <th key={h} className="px-3 py-2 text-right font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="num">
              {crm.porFonte.map((o) => (
                <tr key={o.nome} className="border-t border-borda">
                  <td className="px-4 py-2">
                    {o.nome}{" "}
                    {o.anuncio && <span className="rounded-full bg-fundo px-2 py-0.5 text-[11px] text-destaque">anúncio</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{inteiro(o.leads)}</td>
                  <td className="px-3 py-2 text-right">{o.qualificados == null ? "—" : inteiro(o.qualificados)}</td>
                  <td className="px-3 py-2 text-right">{inteiro(o.vendas)}</td>
                  <td className="px-3 py-2 text-right">{dinheiro(o.faturamento)}</td>
                  <td className="px-3 py-2 text-right">{dinheiro(o.emNegociacao)}</td>
                </tr>
              ))}
            </tbody>
          </table></Ordenavel>
        </div>
      )}

      <TabelaUtm crm={crm} dimensao={dimensao} base={base} qs={qs} periodo={periodo} gastos={gastos} />

      <MotivosPerda m={crm.motivosPerda} />

      {crm.negocios.length > 0 && (
        <details className="rounded-2xl border border-borda bg-superficie">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
            Negócios do período ({crm.negocios.length})
          </summary>
          <div className="overflow-x-auto">
            <Ordenavel><table className="w-full min-w-[1080px] text-sm">
              <thead className="text-left text-xs text-texto-3">
                <tr>
                  {["Negócio", "Criado", "Fonte", "UTM", "Funil · etapa", "Status", "Valor", "Orçamento / campos"].map((h) => (
                    <th key={h} className="px-3 py-2 font-normal first:px-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="align-top">
                {crm.negocios.map((n) => (
                  <tr key={n.id} className="border-t border-borda">
                    <td className="px-4 py-2">
                      <div>{n.nome ?? "—"}</div>
                      {n.responsavel && <div className="text-xs text-texto-3">{n.responsavel}</div>}
                    </td>
                    <td className="num px-3 py-2 text-texto-2">{new Date(n.criado_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                    <td className="px-3 py-2">
                      {n.origem ?? <span className="text-texto-3">sem fonte</span>}
                      {n.anuncio && <span className="ml-1 text-[11px] text-destaque">anúncio</span>}
                    </td>
                    <td className="max-w-56 px-3 py-2 text-xs text-texto-2">
                      {n.utm_source || n.utm_campaign || n.utm_content ? (
                        <>
                          <div>{[n.utm_source, n.utm_medium].filter(Boolean).join(" / ")}</div>
                          {n.utm_campaign && <div className="truncate" title={n.utm_campaign}>{n.utm_campaign}</div>}
                          {n.utm_content && <div className="truncate text-texto-3" title={n.utm_content}>{n.utm_content}</div>}
                        </>
                      ) : <span className="text-texto-3">—</span>}
                    </td>
                    <td className="px-3 py-2 text-texto-2">{[n.pipeline_nome, n.etapa_nome].filter(Boolean).join(" · ")}</td>
                    <td className="px-3 py-2">{statusNegocio(n.ganho)}</td>
                    <td className="num px-3 py-2">{n.valor ? dinheiro(n.valor) : "—"}</td>
                    <td className="px-3 py-2 text-xs text-texto-2">
                      {n.destaques.map(([k, v]) => <div key={k}><span className="text-texto-3">{k}:</span> {v}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></Ordenavel>
          </div>
        </details>
      )}
      <p className="text-xs text-texto-3">
        Leads e qualificados: negócios criados no período, em todos os funis. Vendas: negócios ganhos com fechamento no período.
        Custos e ROAS usam só os negócios de fontes de anúncio{comGoogle ? ", divididos pelo investimento somado do Meta e do Google" : ""}.
      </p>
    </section>
  );
}

/** Leads, qualificados e vendas por UTM, com abas para cada parâmetro. */
function TabelaUtm({ crm, dimensao, base, qs, periodo, gastos }: {
  crm: NonNullable<Awaited<ReturnType<typeof detalheCrm>>>;
  dimensao: DimensaoUtm;
  base: string;
  qs: string;
  periodo: { desde: string; ate: string };
  gastos: GastosPorNivel;
}) {
  const linhas = crm.porUtm[dimensao];
  // investido: gasto do anúncio/conjunto/campanha com o mesmo nome da UTM (utm_source não tem como cruzar)
  const nivel = NIVEL_DA_UTM[dimensao];
  const investido = (nome: string) => (nivel && nome !== "(sem UTM)" ? gastos[nivel].get(chaveDe(nome)) ?? null : null);
  const csv = `/api/crm/exportar?cliente=${crm.conexao.cliente_id}&de=${periodo.desde}&ate=${periodo.ate}`;
  return (
    <div id="utm" className="rounded-2xl border border-borda bg-superficie">
      <div className="flex flex-wrap items-center gap-1 border-b border-borda p-2 text-sm">
        <span className="px-2 font-medium">Origem por UTM</span>
        {DIMENSOES_UTM.map((d) => (
          <Link
            key={d.chave} href={`${base}?${qs}&utm=${d.chave}#utm`} title={d.dica}
            className={`rounded-md px-3 py-1 ${d.chave === dimensao ? "bg-fundo font-medium" : "text-texto-2 hover:text-texto"}`}
          >
            {d.rotulo}
          </Link>
        ))}
        <a href={csv} className="ml-auto rounded-md border border-borda px-3 py-1 text-texto-2 hover:border-destaque hover:text-texto">
          Baixar planilha (CSV)
        </a>
      </div>
      {!crm.temUtm ? (
        <p className="p-4 text-sm text-texto-3">
          Nenhum negócio com UTM ainda. No Ávora, as UTMs vêm da atribuição do contato (clique em “Sincronizar agora” na
          tela do CRM). No RD, crie campos personalizados no negócio com “utm_source”, “utm_campaign” etc. no nome.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Ordenavel><table className="w-full text-sm">
            <thead className="text-left text-xs text-texto-3">
              <tr>
                <th className="px-4 py-2 font-normal">{DIMENSOES_UTM.find((d) => d.chave === dimensao)!.rotulo}</th>
                {["Leads", "Qualificados", "Vendas", "Lead → venda", "Faturamento", ...(nivel ? ["Investido", "ROAS"] : []), "Em negociação"].map((h) => (
                  <th key={h} className="px-3 py-2 text-right font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="num">
              {linhas.map((l) => (
                <tr key={l.nome} className="border-t border-borda">
                  <td className={`max-w-96 truncate px-4 py-2 ${l.nome === "(sem UTM)" ? "text-texto-3" : ""}`} title={l.nome}>{l.nome}</td>
                  <td className="px-3 py-2 text-right">{inteiro(l.leads)}</td>
                  <td className="px-3 py-2 text-right">{l.qualificados == null ? "—" : inteiro(l.qualificados)}</td>
                  <td className="px-3 py-2 text-right">{inteiro(l.vendas)}</td>
                  <td className="px-3 py-2 text-right">{l.leads ? pct((l.vendas / l.leads) * 100) : "—"}</td>
                  <td className="px-3 py-2 text-right">{dinheiro(l.faturamento)}</td>
                  {nivel && (() => {
                    const inv = investido(l.nome);
                    return (
                      <>
                        <td className="px-3 py-2 text-right">{dinheiro(inv)}</td>
                        <td className="px-3 py-2 text-right">{inv && l.faturamento ? `${(l.faturamento / inv).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}x` : "—"}</td>
                      </>
                    );
                  })()}
                  <td className="px-3 py-2 text-right">{dinheiro(l.emNegociacao)}</td>
                </tr>
              ))}
            </tbody>
          </table></Ordenavel>
          <p className="px-4 py-2 text-xs text-texto-3">
            UTMs do primeiro acesso do lead. Leads: criados no período. Vendas: ganhas no período (o lead pode ter entrado antes).
            {nivel && <> Investido: gasto no período do {nivel === "anuncio" ? "anúncio" : nivel} com o mesmo nome da UTM (— quando nenhum nome bate).</>}
          </p>
        </div>
      )}
    </div>
  );
}

type ItemHistorico = {
  id: number; criado_em: string; plataforma: "meta" | "google"; nivel: string | null; objeto_nome: string | null;
  acao: string; antes: string | null; depois: string | null; ok: boolean; erro: string | null;
};

const ACAO: Record<string, string> = { pausar: "Pausou", ativar: "Ativou", orcamento: "Mudou o orçamento de" };
const ACAO_FALHA: Record<string, string> = { pausar: "pausar", ativar: "ativar", orcamento: "mudar o orçamento de" };

/** Tudo o que foi feito pelo painel neste cliente: o histórico de otimizações, sem anotar à mão. */
function Historico({ itens }: { itens: ItemHistorico[] }) {
  return (
    <details className="rounded-2xl border border-borda bg-superficie" open>
      <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
        Histórico de ações pelo painel <span className="font-normal text-texto-3">({itens.length} mais recentes)</span>
      </summary>
      <ul className="divide-y divide-borda text-sm">
        {itens.map((h) => (
          <li key={h.id} className="flex flex-wrap gap-x-3 px-4 py-2">
            <span className="num text-texto-3">
              {new Date(h.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="text-texto-3">{h.plataforma === "meta" ? "Meta" : "Google"}</span>
            <span className={h.ok ? "" : "text-critico"}>
              {h.ok ? ACAO[h.acao] ?? h.acao : `✕ Não deu para ${ACAO_FALHA[h.acao] ?? h.acao}`} {h.nivel === "anuncio" ? "anúncio" : h.nivel} “{h.objeto_nome ?? "—"}”
              {h.antes && h.depois && <span className="text-texto-2"> · {h.antes} → {h.depois}</span>}
              {h.erro && <span className="block text-xs">{h.erro}</span>}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

type DetalheCrm = NonNullable<Awaited<ReturnType<typeof detalheCrm>>>;

/** Funil do período com o funil do relatório do cliente: barras que afunilam e a taxa entre os passos. */
function FunilDoPeriodo({ crm, gasto }: { crm: DetalheCrm; gasto: number }) {
  const f = crm.atual.funil;
  const n = crm.nomesFunil;
  const etapas = [
    { nome: n.leads, valor: f.leads },
    ...n.passos.map((nome) => ({ nome, valor: f.passos.find((x) => x.nome === nome)?.valor ?? 0 })),
    { nome: n.vendas, valor: f.vendas },
  ];
  const cores = ["bg-destaque", "bg-[#9f7aea]", "bg-[var(--serie-2)]", "bg-[#a5b4fc]", "bg-bom"];
  return (
    <section aria-labelledby="funil" className="flex flex-col gap-4 rounded-2xl border border-borda bg-superficie p-4 lg:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="funil" className="text-[15px] font-bold">Funil do período</h2>
        <span className="text-xs text-texto-3">só leads de anúncio · vendas pela data de fechamento</span>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fit,minmax(120px,1fr))]">
        {etapas.map((e, i) => {
          const anterior = i > 0 ? etapas[i - 1].valor : null;
          const largura = f.leads ? Math.max((e.valor / f.leads) * 100, e.valor ? 3 : 0) : 0;
          return (
            <div key={e.nome} className="flex flex-col gap-2">
              <div className="h-2.5 overflow-hidden rounded-full bg-superficie-2">
                <div className={`h-full rounded-full ${cores[i % cores.length]}`} style={{ width: `${largura}%` }} />
              </div>
              <div className="text-[13px] text-texto-2">{e.nome}</div>
              <div className="num text-2xl font-extrabold">{inteiro(e.valor)}</div>
              <div className="text-xs font-semibold text-destaque">
                {anterior == null ? "\u00a0" : anterior ? `${pct((e.valor / anterior) * 100)} de ${etapas[i - 1].nome.toLowerCase()}` : "—"}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2 text-[13px] text-texto-2">
        {f.valorPropostas > 0 && <span className="rounded-[10px] bg-superficie-2 px-3 py-2">Valor das propostas <b className="text-texto">{dinheiro(f.valorPropostas)}</b></span>}
        <span className="rounded-[10px] bg-superficie-2 px-3 py-2">Valor das vendas <b className="text-texto">{dinheiro(f.faturamento)}</b></span>
        {f.vendas > 0 && <span className="rounded-[10px] bg-superficie-2 px-3 py-2">Custo por venda <b className="text-texto">{dinheiro(gasto / f.vendas)}</b></span>}
        {gasto > 0 && f.faturamento > 0 && <span className="rounded-[10px] bg-superficie-2 px-3 py-2">ROAS <b className="text-texto">{(f.faturamento / gasto).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}x</b></span>}
      </div>
    </section>
  );
}

/** Anúncios (pela utm_content) que mais venderam, com custo por venda e ROAS cruzando com o gasto do mesmo nome. */
function AnunciosQueVendem({ linhas, gastos }: { linhas: DetalheCrm["porUtm"]["utm_content"]; gastos: Map<string, number> }) {
  const top = linhas
    .filter((l) => l.nome !== "(sem UTM)" && l.funil.vendas > 0)
    .sort((a, b) => b.funil.vendas - a.funil.vendas || b.funil.faturamento - a.funil.faturamento)
    .slice(0, 5)
    .map((l) => ({ ...l, gasto: gastos.get(chaveDe(l.nome)) ?? null }));
  return (
    <section aria-labelledby="vendem" className="flex flex-col gap-3 rounded-2xl border border-borda bg-superficie p-4 lg:p-5">
      <h2 id="vendem" className="text-[15px] font-bold">Anúncios que mais vendem</h2>
      {!top.length ? (
        <p className="text-sm text-texto-3">Nenhuma venda com o anúncio na UTM (utm_content) neste período.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {top.map((a) => (
            <li key={a.nome} className="flex items-center gap-3">
              <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-destaque-bg text-sm font-bold text-destaque">{a.funil.vendas}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold" title={a.nome}>{a.nome}</div>
                <div className="text-xs text-texto-3">
                  {a.funil.vendas} venda(s) · {dinheiro(a.funil.faturamento)}
                  {a.gasto ? <> · custo por venda {dinheiro(a.gasto / a.funil.vendas)}</> : null}
                </div>
              </div>
              {a.gasto && a.funil.faturamento > 0 ? (
                <span className="num text-[13px] font-bold text-bom">{(a.funil.faturamento / a.gasto).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}x</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Por que os leads foram perdidos no período (motivo de perda do CRM). */
function MotivosPerda({ m }: { m: DetalheCrm["motivosPerda"] }) {
  const max = Math.max(...m.lista.map((x) => x.total), 1);
  return (
    <section aria-labelledby="motivos" className="rounded-2xl border border-borda bg-superficie">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-borda px-4 py-3">
        <h3 id="motivos" className="text-[15px] font-bold">Motivos de perda <span className="text-sm font-medium text-texto-3">· {inteiro(m.total)} perdido(s)</span></h3>
        <span className="text-xs text-texto-3">perdidos no período · só leads de anúncio dos funis do relatório</span>
      </div>
      {!m.temColuna ? (
        <p className="p-4 text-sm text-texto-3">Rode o SQL 0020 no Supabase e sincronize o CRM para ver os motivos de perda.</p>
      ) : !m.total ? (
        <p className="p-4 text-sm text-texto-3">Nenhum negócio perdido neste período.</p>
      ) : (
        <ul className="divide-y divide-borda">
          {m.lista.map((x) => (
            <li key={x.motivo} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-sm sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
              <span className={x.motivo === "(sem motivo)" ? "text-texto-3" : ""}>{x.motivo}</span>
              <span className="order-3 col-span-2 h-2 overflow-hidden rounded-full bg-superficie-2 sm:order-none sm:col-span-1">
                <span className="block h-full rounded-full bg-[var(--serie-2)]" style={{ width: `${(x.total / max) * 100}%` }} />
              </span>
              <span className="num text-right">
                <b>{inteiro(x.total)}</b> <span className="text-texto-3">· {pct((x.total / m.total) * 100)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
