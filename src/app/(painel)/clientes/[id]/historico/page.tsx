import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { dinheiro, inteiro, pct, quandoFoi } from "@/lib/formato";
import { chavePasso, chaveValorPasso, conferirMes, passosComValor, funilDoCliente, lerHistorico, mesDe, nomeMes, nomesDosPassos, somarMeses, type MesConsolidado } from "@/lib/historico";
import type { FunilCliente } from "@/lib/funil";
import { configRelatorio, linkApresentacao } from "@/lib/relatorio-slides";
import { DIMENSOES_UTM } from "@/lib/consultas";
import { hojeISO } from "@/lib/datas";
import { Aviso } from "@/components/ui";
import { BotaoEnviar } from "@/components/botao";
import { EscolherPasta } from "@/components/escolher-pasta";
import { BuscarHistorico } from "@/components/buscar-historico";
import { atualizarMesesRecentes, criarModeloRelatorio, gerarRelatorioSlides, salvarAjusteMes } from "../../../../acoes-historico";

export const maxDuration = 300;

const campo = "rounded-lg border border-borda bg-fundo px-2 py-1.5 text-sm outline-none focus:border-destaque";
const botao = "rounded-lg border border-borda bg-superficie px-3 py-1.5 text-sm hover:border-destaque";
const botaoPrimario = "rounded-lg bg-destaque px-3 py-1.5 text-sm font-medium text-white";

const taxa = (v: number | null) => pct(v == null ? null : v * 100);

export default async function Historico({ params, searchParams }: PageProps<"/clientes/[id]/historico">) {
  const { id } = await params;
  const { msg, ano, conferir } = (await searchParams) as { msg?: string; ano?: string; conferir?: string };
  const [{ data: cliente }, { meses, erro }, funil, { data: ultima }, config, { data: logins }, { data: gerados }] = await Promise.all([
    // pasta_drive vem do SQL 0017
    db().from("clientes").select("id, nome, pasta_drive").eq("id", id).maybeSingle()
      .then((r) => (r.error ? db().from("clientes").select("id, nome").eq("id", id).maybeSingle() : r)),
    lerHistorico(id),
    funilDoCliente(id),
    db().from("historico_mensal").select("atualizado_em").eq("cliente_id", id).order("atualizado_em", { ascending: false }).limit(1),
    configRelatorio().catch(() => null),
    db().from("tokens_google").select("id, email").order("email"),
    db().from("relatorios_gerados").select("periodo, link, criado_em").eq("cliente_id", id).order("criado_em", { ascending: false }).limit(5),
  ]);
  if (!cliente) notFound();

  const hoje = hojeISO();
  const anos = [...new Set(meses.map((m) => m.mes.slice(0, 4)))];
  const anoSel = ano && anos.includes(ano) ? ano : null;
  // padrão: últimos 12 meses; ?ano=2025 mostra o ano inteiro
  // do mais antigo (em cima) para o mais recente (embaixo)
  const visiveis = (anoSel ? meses.filter((m) => m.mes.startsWith(anoSel)) : meses.slice(0, 12)).reverse();
  const total = somarMeses(visiveis);
  // colunas dos passos: as do funil atual do cliente e as que aparecem nos meses já gravados
  const passos = [...new Set([...funil.passos.map((p) => p.nome), ...nomesDosPassos(visiveis)])];
  // passos que somam o valor das oportunidades (ex.: valor das propostas)
  const comValor = [...new Set([...funil.passos.filter((p) => p.somarValor).map((p) => p.nome), ...passosComValor(visiveis)])];
  const temGoogle = meses.some((m) => m.gastoGoogle > 0);
  // relatório: até o dia 10 o padrão é o mês passado; depois, o mês atual
  const opcoesMes = Array.from({ length: 13 }, (_, i) => mesDe(hoje, -i));
  const mesPadrao = Number(hoje.slice(8, 10)) <= 10 ? mesDe(hoje, -1) : mesDe(hoje);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/clientes/${id}`} className="text-sm text-texto-3 hover:text-texto">← {cliente.nome}</Link>
        <h1 className="text-xl font-semibold">Histórico de {cliente.nome}</h1>
        <p className="text-sm text-texto-2">
          Um registro por mês, como a planilha: investimento (Meta + Google), funil do CRM e vendas. Cada mês fica salvo;
          o painel atualiza sozinho só o mês atual (e o anterior até o dia 10). Clique num mês para corrigir algum número.
          {ultima?.[0] && <> Última atualização {quandoFoi(ultima[0].atualizado_em)}.</>}
        </p>
      </div>
      {msg && <Aviso>{msg}</Aviso>}
      {erro && <Aviso>Rode o SQL 0015 no Supabase para usar o histórico ({erro}).</Aviso>}

      <section className="flex flex-wrap items-end gap-3 rounded-xl border border-borda bg-superficie p-4">
        <BuscarHistorico clienteId={id} opcoes={Array.from({ length: 37 }, (_, i) => mesDe(hoje, -i))} gravados={meses.map((m) => m.mes)} />
        {meses.length > 0 && (
          <form action={atualizarMesesRecentes}>
            <input type="hidden" name="cliente_id" value={id} />
            <BotaoEnviar className={botao} aguardando="Atualizando…">Atualizar mês atual e anterior</BotaoEnviar>
          </form>
        )}
        <p className="basis-full text-xs text-texto-3">
          Só precisa buscar o passado uma vez. O funil ({[funil.leads, ...funil.passos.map((p) => p.nome), funil.vendas].join(" → ")})
          {funil.soAnuncio ? ", contando só os leads de anúncio," : ""} é montado na{" "}
          <Link href={`/clientes/${id}/crm#funil`} className="underline">configuração do CRM</Link>. Mudou o funil? Clique em
          “Buscar e gravar” de novo para recalcular os meses.
        </p>
      </section>

      <section id="relatorio" className="space-y-3 rounded-xl border border-borda bg-superficie p-4">
        <h2 className="font-medium">Relatório no Google Slides</h2>
        {!config ? (
          <>
            <p className="text-sm text-texto-2">
              Primeiro passo (uma vez só): o painel coloca o modelo da Propulsão no seu Google Drive. Depois, cada relatório
              é uma cópia dele já preenchida, que você edita à vontade. Mudanças de design feitas no modelo valem para os
              próximos relatórios (só não apague os textos entre {"{{ }}"}).
            </p>
            {(logins ?? []).length === 0 ? (
              <p className="text-sm text-texto-3">Conecte um login do Google em <Link href="/configuracoes#google" className="underline">Configurações</Link>.</p>
            ) : (
              <form action={criarModeloRelatorio} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="cliente_id" value={id} />
                <label className="flex flex-col gap-1 text-sm">
                  Em qual Google Drive?
                  <select name="token_id" className={campo}>
                    {(logins ?? []).map((l) => <option key={l.id} value={l.id}>{l.email}</option>)}
                  </select>
                </label>
                <BotaoEnviar className={botaoPrimario} aguardando="Criando…">Criar modelo no meu Drive</BotaoEnviar>
              </form>
            )}
          </>
        ) : (
          <>
            <EscolherPasta clienteId={id} atual={(cliente as { pasta_drive?: { id: string; nome: string } | null }).pasta_drive ?? null} />
            <form action={gerarRelatorioSlides} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="cliente_id" value={id} />
              <label className="flex flex-col gap-1 text-sm">
                Período
                <select name="mes" defaultValue={mesPadrao.slice(0, 7)} className={`${campo} capitalize`}>
                  {opcoesMes.map((m) => <option key={m} value={m.slice(0, 7)}>{nomeMes(m)}{m === mesDe(hoje) ? " (até hoje)" : ""}</option>)}
                  <option value="livre">Outro período (datas ao lado)</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">De<input type="date" name="de" className={campo} /></label>
              <label className="flex flex-col gap-1 text-sm">Até<input type="date" name="ate" className={campo} /></label>
              <label className="flex flex-col gap-1 text-sm">
                Qualificação por
                <select name="dimensao" defaultValue="utm_medium" className={campo}>
                  {DIMENSOES_UTM.map((d) => <option key={d.chave} value={d.chave}>{d.rotulo}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 self-center text-sm">
                <input type="checkbox" name="agrupar" defaultChecked />
                Juntar públicos e anúncios de mesmo nome
              </label>
              <BotaoEnviar className={botaoPrimario} aguardando="Gerando…" aviso="Leva uns 20 segundos.">Gerar relatório</BotaoEnviar>
            </form>
            <p className="text-xs text-texto-3">
              Para um período que não é um mês, escolha “Outro período” e preencha as datas. Os gráficos mostram até 6 meses do
              histórico. Slides sem dados (ex.: Google, para quem não tem) saem do relatório. Modelo no Drive de {config.email}:{" "}
              <a href={linkApresentacao(config.modeloId)} target="_blank" rel="noreferrer" className="underline">editar o modelo ↗</a>
            </p>
            {(gerados ?? []).length > 0 && (
              <ul className="space-y-1 text-sm">
                {(gerados ?? []).map((g) => (
                  <li key={g.link}>
                    <a href={g.link} target="_blank" rel="noreferrer" className="text-destaque underline">{g.periodo}</a>
                    <span className="text-texto-3"> · gerado {quandoFoi(g.criado_em)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {meses.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <Link href={`/clientes/${id}/historico`} className={`rounded-md px-3 py-1 ${!anoSel ? "bg-superficie font-medium" : "text-texto-2 hover:text-texto"}`}>
              {meses.length < 12 ? "Todos os meses" : "Últimos 12 meses"}
            </Link>
            {anos.map((a) => (
              <Link key={a} href={`/clientes/${id}/historico?ano=${a}`} className={`rounded-md px-3 py-1 ${anoSel === a ? "bg-superficie font-medium" : "text-texto-2 hover:text-texto"}`}>
                {a}
              </Link>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-borda bg-superficie">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="text-left text-xs text-texto-3">
                <tr className="border-b border-borda">
                  <th className="px-3 py-2 font-normal">Mês</th>
                  <th className="px-3 py-2 text-right font-normal">Investimento</th>
                  <th className="px-3 py-2 text-right font-normal">{funil.leads}</th>
                  {passos.map((p) => <th key={p} className="px-3 py-2 text-right font-normal">{p}</th>)}
                  <th className="px-3 py-2 text-right font-normal">{funil.vendas}</th>
                  <th className="px-3 py-2 text-right font-normal">Valor das vendas</th>
                  {comValor.map((p) => <th key={p} className="px-3 py-2 text-right font-normal">Valor em {p.toLowerCase()}</th>)}
                  {passos.map((p) => <th key={p} className="px-3 py-2 text-right font-normal">Tx. {p.toLowerCase()}</th>)}
                  <th className="px-3 py-2 text-right font-normal">Conv. em {funil.vendas.toLowerCase()}</th>
                  <th className="px-3 py-2 text-right font-normal">ROAS</th>
                  <th className="px-3 py-2 text-right font-normal">CPL</th>
                  <th className="px-3 py-2 text-right font-normal">CPL qualificado</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((m) => <LinhaMes key={m.mes} m={m} passos={passos} comValor={comValor} temGoogle={temGoogle} />)}
              </tbody>
              {total && visiveis.length > 1 && (
                <tfoot className="border-t border-borda font-medium">
                  <LinhaMes m={{ ...total, mes: anoSel ? `Total ${anoSel}` : visiveis.length < 12 ? `Total (${visiveis.length} meses)` : "Total 12 meses" }} passos={passos} comValor={comValor} temGoogle={temGoogle} total />
                </tfoot>
              )}
            </table>
          </div>

          <Conferir clienteId={id} meses={visiveis.map((m) => m.mes)} mes={conferir && /^\d{4}-\d{2}-01$/.test(conferir) ? conferir : null} />

          <section className="space-y-2">
            <h2 className="font-medium">Corrigir um mês</h2>
            <p className="text-sm text-texto-2">
              Deixe em branco para usar o número automático. Valores corrigidos aparecem com * na tabela e não são
              sobrescritos pela atualização automática.
            </p>
            <div className="space-y-2">
              {visiveis.map((m) => <EditarMes key={m.mes} clienteId={id} m={m} passos={passos} comValor={comValor} funil={funil} />)}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function LinhaMes({ m, passos, comValor, temGoogle, total }: { m: MesConsolidado; passos: string[]; comValor: string[]; temGoogle: boolean; total?: boolean }) {
  const celula = "px-3 py-2 text-right tabular-nums";
  const passo = (nome: string) => m.passos.find((p) => p.nome === nome);
  const marca = (c: string) => (m.ajustado.includes(c) ? <span className="text-destaque" title="corrigido à mão">*</span> : null);
  return (
    <tr className={total ? "" : "border-b border-borda/60 last:border-0"}>
      <td className="px-3 py-2 capitalize">
        {total ? m.mes : nomeMes(m.mes)}
        {m.observacao && <span className="block text-xs normal-case text-texto-3">{m.observacao}</span>}
      </td>
      <td className={celula}>
        {dinheiro(m.investimento)}{marca("investimento")}
        {temGoogle && !m.ajustado.includes("investimento") && (
          <span className="block text-xs text-texto-3">Meta {dinheiro(m.gastoMeta)} · Google {dinheiro(m.gastoGoogle)}</span>
        )}
      </td>
      <td className={celula}>{inteiro(m.leads)}{marca("leads")}</td>
      {passos.map((p) => <td key={p} className={celula}>{inteiro(passo(p)?.valor)}{marca(chavePasso(p))}</td>)}
      <td className={celula}>{inteiro(m.vendas)}{marca("vendas")}</td>
      <td className={celula}>{dinheiro(m.faturamento)}{marca("faturamento")}</td>
      {comValor.map((p) => <td key={p} className={celula}>{dinheiro(passo(p)?.soma ?? null)}{marca(chaveValorPasso(p))}</td>)}
      {passos.map((p) => <td key={p} className={celula}>{taxa(passo(p)?.taxa ?? null)}</td>)}
      <td className={celula}>{taxa(m.conversaoVendas)}</td>
      <td className={celula}>{m.roas == null ? "—" : `${m.roas.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}x`}</td>
      <td className={celula}>{dinheiro(m.cpl)}</td>
      <td className={celula}>{dinheiro(m.cplQualificado)}</td>
    </tr>
  );
}

function EditarMes({ clienteId, m, passos, comValor, funil }: { clienteId: string; m: MesConsolidado; passos: string[]; comValor: string[]; funil: FunilCliente }) {
  const campos: { nome: string; rotulo: string; valor: number | null }[] = [
    { nome: "investimento", rotulo: "Investimento (R$)", valor: m.investimento },
    { nome: "leads", rotulo: funil.leads, valor: m.leads },
    ...passos.map((p) => ({ nome: chavePasso(p), rotulo: p, valor: m.passos.find((x) => x.nome === p)?.valor ?? null })),
    { nome: "vendas", rotulo: funil.vendas, valor: m.vendas },
    { nome: "faturamento", rotulo: "Valor das vendas (R$)", valor: m.faturamento },
    ...comValor.map((p) => ({ nome: chaveValorPasso(p), rotulo: `Valor em ${p.toLowerCase()} (R$)`, valor: m.passos.find((x) => x.nome === p)?.soma ?? null })),
  ];
  return (
    <details className="rounded-xl border border-borda bg-superficie">
      <summary className="cursor-pointer px-4 py-2 text-sm capitalize">
        {nomeMes(m.mes)}{m.ajustado.length > 0 && <span className="normal-case text-texto-3"> · {m.ajustado.length} valor(es) corrigido(s)</span>}
      </summary>
      <form action={salvarAjusteMes} className="space-y-3 border-t border-borda p-4">
        <input type="hidden" name="cliente_id" value={clienteId} />
        <input type="hidden" name="mes" value={m.mes} />
        <input type="hidden" name="campos" value={campos.map((c) => c.nome).join("|")} />
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {campos.map((c) => (
            <label key={c.nome} className="flex flex-col gap-1 text-sm">
              {c.rotulo}
              <input
                name={c.nome} inputMode="decimal" className={campo}
                defaultValue={m.ajustado.includes(c.nome) ? String(c.valor ?? "") : ""}
                placeholder={c.valor == null || m.ajustado.includes(c.nome) ? "automático" : `auto: ${c.valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`}
              />
            </label>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Observação do mês <span className="text-xs text-texto-3">(opcional; aparece na tabela)</span>
          <input name="observacao" defaultValue={m.observacao ?? ""} className={campo} placeholder="Ex.: feirão, campanha pausada 10 dias…" />
        </label>
        <BotaoEnviar className={botaoPrimario}>Salvar {nomeMes(m.mes)}</BotaoEnviar>
      </form>
    </details>
  );
}

/** Lista o que entrou na conta de um mês (vendas uma a uma, leads por funil e por fonte) para comparar com o CRM. */
async function Conferir({ clienteId, meses, mes }: { clienteId: string; meses: string[]; mes: string | null }) {
  const c = mes ? await conferirMes(clienteId, mes).catch((e: unknown) => ({ erro: e instanceof Error ? e.message : String(e) })) : null;
  const dia = (iso: string | null) => (iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(iso)) : "—");
  const tabela = "w-full text-sm";
  const th = "px-3 py-1.5 text-left text-xs font-normal text-texto-3";
  const td = "px-3 py-1.5";
  return (
    <section id="conferir" className="space-y-3 rounded-xl border border-borda bg-superficie p-4">
      <h2 className="font-medium">Conferir um mês com o CRM</h2>
      <form action={`/clientes/${clienteId}/historico#conferir`} className="flex flex-wrap items-end gap-2">
        <select name="conferir" defaultValue={mes ?? meses.at(-1)} className={`${campo} capitalize`}>
          {[...meses].reverse().map((m) => <option key={m} value={m}>{nomeMes(m)}</option>)}
        </select>
        <button className={botao}>Conferir</button>
        <span className="text-xs text-texto-3">Mostra cada venda contada e o que ficou de fora, com o motivo.</span>
      </form>
      {c && "erro" in c && <Aviso>Erro: {c.erro}</Aviso>}
      {c === null && mes && <p className="text-sm text-texto-3">Este cliente não tem CRM conectado.</p>}
      {c && !("erro" in c) && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium">
              Vendas fechadas em {nomeMes(mes!)}: {c.vendas.filter((v) => !v.motivo).length} contada(s)
              ({dinheiro(c.vendas.filter((v) => !v.motivo).reduce((t, v) => t + v.valor, 0))})
              {c.vendas.some((v) => v.motivo) && <>, {c.vendas.filter((v) => v.motivo).length} de fora</>}
            </h3>
            <p className="text-xs text-texto-3">Venda = oportunidade com status <b>ganho</b>, no mês em que foi marcada como ganha.</p>
            <div className="mt-1 overflow-x-auto">
              <table className={tabela}>
                <thead><tr><th className={th}>Nome</th><th className={th}>Funil · etapa</th><th className={th}>Fonte</th><th className={`${th} text-right`}>Valor</th><th className={th}>Entrou</th><th className={th}>Ganha em</th><th className={th}>Na conta?</th></tr></thead>
                <tbody>
                  {c.vendas.map((v, i) => (
                    <tr key={i} className={`border-t border-borda/60 ${v.motivo ? "text-texto-3" : ""}`}>
                      <td className={td}>{v.nome}</td>
                      <td className={td}>{v.funil ?? "—"}{v.etapa ? ` · ${v.etapa}` : ""}</td>
                      <td className={td}>{v.fonte || "—"}</td>
                      <td className={`${td} text-right tabular-nums`}>{dinheiro(v.valor)}</td>
                      <td className={td}>{dia(v.criado)}</td>
                      <td className={td}>{dia(v.fechado)}</td>
                      <td className={td}>{v.motivo ? `não: ${v.motivo}` : "sim"}</td>
                    </tr>
                  ))}
                  {!c.vendas.length && <tr><td className={td} colSpan={7}>Nenhuma oportunidade marcada como ganha neste mês.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {([["Leads que entraram, por funil", c.leadsPorFunil], ["Leads que entraram, por fonte", c.leadsPorFonte]] as const).map(([titulo, linhas]) => (
              <div key={titulo}>
                <h3 className="text-sm font-medium">{titulo} <span className="font-normal text-texto-3">({c.totalLeads} no total)</span></h3>
                <table className={tabela}>
                  <thead><tr><th className={th}></th><th className={`${th} text-right`}>Criados</th><th className={`${th} text-right`}>Na conta</th></tr></thead>
                  <tbody>
                    {linhas.slice(0, 15).map((l) => (
                      <tr key={l.nome} className={`border-t border-borda/60 ${l.contados ? "" : "text-texto-3"}`}>
                        <td className={td}>{l.nome}</td>
                        <td className={`${td} text-right tabular-nums`}>{inteiro(l.total)}</td>
                        <td className={`${td} text-right tabular-nums`}>{inteiro(l.contados)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
