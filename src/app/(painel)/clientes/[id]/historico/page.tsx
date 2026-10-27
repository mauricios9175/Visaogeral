import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { dinheiro, inteiro, pct, quandoFoi } from "@/lib/formato";
import { lerHistorico, mesDe, nomeMes, rotulosDoCliente, somarMeses, type CampoAjustavel, type MesConsolidado } from "@/lib/historico";
import { configRelatorio, linkApresentacao } from "@/lib/relatorio-slides";
import { DIMENSOES_UTM } from "@/lib/consultas";
import { hojeISO } from "@/lib/datas";
import { Aviso } from "@/components/ui";
import { BotaoEnviar } from "@/components/botao";
import { atualizarMesesRecentes, buscarHistorico, criarModeloRelatorio, gerarRelatorioSlides, salvarAjusteMes } from "../../../../acoes-historico";

export const maxDuration = 300;

const campo = "rounded-lg border border-borda bg-fundo px-2 py-1.5 text-sm outline-none focus:border-destaque";
const botao = "rounded-lg border border-borda bg-superficie px-3 py-1.5 text-sm hover:border-destaque";
const botaoPrimario = "rounded-lg bg-destaque px-3 py-1.5 text-sm font-medium text-white";

const taxa = (v: number | null) => pct(v == null ? null : v * 100);

export default async function Historico({ params, searchParams }: PageProps<"/clientes/[id]/historico">) {
  const { id } = await params;
  const { msg, ano } = (await searchParams) as { msg?: string; ano?: string };
  const [{ data: cliente }, { meses, erro }, rotulos, { data: ultima }, config, { data: logins }, { data: gerados }] = await Promise.all([
    db().from("clientes").select("id, nome").eq("id", id).maybeSingle(),
    lerHistorico(id),
    rotulosDoCliente(id),
    db().from("historico_mensal").select("atualizado_em").eq("cliente_id", id).order("atualizado_em", { ascending: false }).limit(1),
    configRelatorio().catch(() => null),
    db().from("tokens_google").select("id, email").order("email"),
    db().from("relatorios_gerados").select("periodo, link, criado_em").eq("cliente_id", id).order("criado_em", { ascending: false }).limit(5),
  ]);
  if (!cliente) notFound();

  const anos = [...new Set(meses.map((m) => m.mes.slice(0, 4)))];
  const anoSel = ano && anos.includes(ano) ? ano : null;
  // padrão: últimos 12 meses; ?ano=2025 mostra o ano inteiro
  const visiveis = anoSel ? meses.filter((m) => m.mes.startsWith(anoSel)) : meses.slice(0, 12);
  const total = somarMeses(visiveis);
  const temPropostas = meses.some((m) => m.propostas != null);
  const temGoogle = meses.some((m) => m.gastoGoogle > 0);
  // relatório: até o dia 10 o padrão é o mês passado; depois, o mês atual
  const hoje = hojeISO();
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
        <form action={buscarHistorico} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="cliente_id" value={id} />
          <label className="flex flex-col gap-1 text-sm">
            Buscar o passado
            <select name="meses" defaultValue={meses.length ? "3" : "12"} className={campo}>
              <option value="3">últimos 3 meses</option>
              <option value="6">últimos 6 meses</option>
              <option value="12">últimos 12 meses</option>
              <option value="24">últimos 24 meses</option>
              <option value="37">tudo que o Meta guarda (37 meses)</option>
            </select>
          </label>
          <BotaoEnviar className={botaoPrimario} aguardando="Buscando…" aviso="Pode levar 1 a 3 minutos (traz o CRM do período).">
            Buscar e gravar
          </BotaoEnviar>
        </form>
        {meses.length > 0 && (
          <form action={atualizarMesesRecentes}>
            <input type="hidden" name="cliente_id" value={id} />
            <BotaoEnviar className={botao} aguardando="Atualizando…">Atualizar mês atual e anterior</BotaoEnviar>
          </form>
        )}
        <p className="basis-full text-xs text-texto-3">
          Só precisa buscar o passado uma vez. Os nomes das etapas ({rotulos.interessados}, {rotulos.propostas}) e qual etapa
          conta como cada uma ficam na <Link href={`/clientes/${id}/crm`} className="underline">configuração do CRM</Link>.
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
              Últimos 12 meses
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
                  <th className="px-3 py-2 text-right font-normal">{rotulos.leads}</th>
                  <th className="px-3 py-2 text-right font-normal">{rotulos.interessados}</th>
                  {temPropostas && <th className="px-3 py-2 text-right font-normal">{rotulos.propostas}</th>}
                  <th className="px-3 py-2 text-right font-normal">{rotulos.vendas}</th>
                  <th className="px-3 py-2 text-right font-normal">Valor das vendas</th>
                  <th className="px-3 py-2 text-right font-normal">Tx. qualificação</th>
                  {temPropostas && <th className="px-3 py-2 text-right font-normal">Tx. {rotulos.propostas.toLowerCase()}</th>}
                  <th className="px-3 py-2 text-right font-normal">Conv. em vendas</th>
                  <th className="px-3 py-2 text-right font-normal">ROAS</th>
                  <th className="px-3 py-2 text-right font-normal">CPL</th>
                  <th className="px-3 py-2 text-right font-normal">CPL qualificado</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((m) => <LinhaMes key={m.mes} m={m} temPropostas={temPropostas} temGoogle={temGoogle} />)}
              </tbody>
              {total && visiveis.length > 1 && (
                <tfoot className="border-t border-borda font-medium">
                  <LinhaMes m={{ ...total, mes: anoSel ? `Total ${anoSel}` : "Total 12 meses" }} temPropostas={temPropostas} temGoogle={temGoogle} total />
                </tfoot>
              )}
            </table>
          </div>

          <section className="space-y-2">
            <h2 className="font-medium">Corrigir um mês</h2>
            <p className="text-sm text-texto-2">
              Deixe em branco para usar o número automático. Valores corrigidos aparecem com * na tabela e não são
              sobrescritos pela atualização automática.
            </p>
            <div className="space-y-2">
              {visiveis.map((m) => <EditarMes key={m.mes} clienteId={id} m={m} temPropostas={temPropostas} rotulos={rotulos} />)}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function LinhaMes({ m, temPropostas, temGoogle, total }: { m: MesConsolidado; temPropostas: boolean; temGoogle: boolean; total?: boolean }) {
  const celula = "px-3 py-2 text-right tabular-nums";
  const marca = (c: CampoAjustavel) => (m.ajustado.includes(c) ? <span className="text-destaque" title="corrigido à mão">*</span> : null);
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
      <td className={celula}>{inteiro(m.interessados)}{marca("interessados")}</td>
      {temPropostas && <td className={celula}>{inteiro(m.propostas)}{marca("propostas")}</td>}
      <td className={celula}>{inteiro(m.vendas)}{marca("vendas")}</td>
      <td className={celula}>{dinheiro(m.faturamento)}{marca("faturamento")}</td>
      <td className={celula}>{taxa(m.taxaQualificacao)}</td>
      {temPropostas && <td className={celula}>{taxa(m.taxaPropostas)}</td>}
      <td className={celula}>{taxa(m.conversaoVendas)}</td>
      <td className={celula}>{m.roas == null ? "—" : `${m.roas.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}x`}</td>
      <td className={celula}>{dinheiro(m.cpl)}</td>
      <td className={celula}>{dinheiro(m.cplQualificado)}</td>
    </tr>
  );
}

function EditarMes({ clienteId, m, temPropostas, rotulos }: {
  clienteId: string; m: MesConsolidado; temPropostas: boolean; rotulos: Awaited<ReturnType<typeof rotulosDoCliente>>;
}) {
  const campos: { nome: CampoAjustavel; rotulo: string; valor: number | null }[] = [
    { nome: "investimento", rotulo: "Investimento (R$)", valor: m.investimento },
    { nome: "leads", rotulo: rotulos.leads, valor: m.leads },
    { nome: "interessados", rotulo: rotulos.interessados, valor: m.interessados },
    ...(temPropostas ? [{ nome: "propostas" as const, rotulo: rotulos.propostas, valor: m.propostas }] : []),
    { nome: "vendas", rotulo: rotulos.vendas, valor: m.vendas },
    { nome: "faturamento", rotulo: "Valor das vendas (R$)", valor: m.faturamento },
  ];
  return (
    <details className="rounded-xl border border-borda bg-superficie">
      <summary className="cursor-pointer px-4 py-2 text-sm capitalize">
        {nomeMes(m.mes)}{m.ajustado.length > 0 && <span className="normal-case text-texto-3"> · {m.ajustado.length} valor(es) corrigido(s)</span>}
      </summary>
      <form action={salvarAjusteMes} className="space-y-3 border-t border-borda p-4">
        <input type="hidden" name="cliente_id" value={clienteId} />
        <input type="hidden" name="mes" value={m.mes} />
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {campos.map((c) => (
            <label key={c.nome} className="flex flex-col gap-1 text-sm">
              {c.rotulo}
              <input
                name={c.nome} inputMode="decimal" className={campo}
                defaultValue={m.ajustado.includes(c.nome) ? String(c.valor ?? "") : ""}
                placeholder={c.valor == null ? "—" : `auto: ${c.valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`}
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
