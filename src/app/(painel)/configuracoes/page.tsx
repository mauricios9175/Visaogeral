import { db, EMPRESA_PADRAO, type Cliente, type ContaAnuncio, type TokenMeta } from "@/lib/db";
import { diasAte, dinheiro, quandoFoi } from "@/lib/formato";
import { Aviso } from "@/components/ui";
import { BotaoChurn, BotaoEnviar } from "@/components/botao";
import {
  alternarSyncConta, alternarSyncContaGoogle, desconectarGoogle, importar, importarGoogle, reativarCliente,
  salvarCliente, sincronizarGoogleAgora, vincularConta, vincularContaGoogle,
} from "../../acoes";
import { formatarIdGoogle, googleConfigurado } from "@/lib/google";
import type { ContaGoogle } from "@/lib/sync-google";
import { PainelSincronizacao } from "@/components/sincronizacao";

export const maxDuration = 300;

const campo = "rounded-lg border border-borda bg-fundo px-2 py-1.5 text-sm outline-none focus:border-destaque";
const campoGrade = `${campo} w-full min-w-0`;
const botao = "rounded-lg border border-borda bg-superficie px-3 py-1.5 text-sm hover:border-destaque";
const botaoPrimario = "rounded-lg bg-destaque px-3 py-1.5 text-sm font-medium text-white";

export default async function Configuracoes({ searchParams }: PageProps<"/configuracoes">) {
  const { msg, mbusca, gbusca, gacesso, gcanceladas: canceladasParam } =
    (await searchParams) as { msg?: string; mbusca?: string; gbusca?: string; gacesso?: string; gcanceladas?: string };
  const gcanceladas = canceladasParam === "1";
  const banco = db();
  const [{ data: clientes }, { data: contas }, { data: tokens }, { data: execucoes }, { data: tokensGoogle }, { data: contasGoogle }] = await Promise.all([
    banco.from("clientes").select("*").order("nome"),
    banco.from("contas_anuncio").select("*")
      .order("cliente_id", { nullsFirst: false }).order("status").order("nome"),
    banco.from("tokens_meta").select("id, fb_user_id, nome, expira_em"),
    banco.from("sync_execucoes").select("*").order("id", { ascending: false }).limit(3),
    // tabelas do Google podem não existir ainda (SQL 0009 não rodado): o erro vira lista vazia
    banco.from("tokens_google").select("id, email, atualizado_em").order("email"),
    banco.from("contas_google").select("*").order("cliente_id", { nullsFirst: false }).order("nome"),
  ]);
  const listaClientes = (clientes ?? []) as Cliente[];
  const ativos = listaClientes.filter((c) => c.ativo);
  const encerrados = listaClientes.filter((c) => !c.ativo);
  const empresas = [...new Set([EMPRESA_PADRAO, ...listaClientes.map((c) => c.empresa).filter((e): e is string => !!e)])].sort();
  const listaContas = (contas ?? []) as ContaAnuncio[];
  // Configurações mostra só as contas vinculadas; as outras ficam atrás da busca.
  const metaVinculadas = listaContas.filter((c) => c.cliente_id);
  const metaLivres = listaContas.filter((c) => !c.cliente_id)
    .sort((a, b) => Number(b.status === 1) - Number(a.status === 1) || a.nome.localeCompare(b.nome));
  const termoMeta = (mbusca ?? "").trim().toLowerCase();
  const metaTodasFiltradas = metaLivres.filter((c) =>
    !termoMeta || [c.nome, c.id, c.bm_nome ?? ""].some((x) => x.toLowerCase().includes(termoMeta)));
  const metaFiltradas = metaTodasFiltradas.slice(0, 30);
  const metaFiltradasTotal = metaTodasFiltradas.length;
  const temTokenBm = Boolean(process.env.META_SYSTEM_USER_TOKEN);
  const temApp = Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Configurações</h1>
      {msg && <Aviso>{msg}</Aviso>}

      {!!execucoes?.length && (
        <section className="rounded-xl border border-borda bg-superficie p-4 text-sm">
          <div className="font-medium">Últimas sincronizações</div>
          <ul className="mt-2 space-y-2">
            {execucoes.map((e) => (
              <li key={e.id}>
                <span className="text-texto-2">
                  {new Date(e.iniciado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {e.modo} ·{" "}
                </span>
                <span className={e.status === "ok" ? "text-bom" : e.status === "rodando" ? "text-atencao" : "text-critico"}>
                  {e.status === "rodando" ? (e.finalizado_em ? "" : "não terminou (provável tempo esgotado)") : e.status}
                </span>
                <span className="text-texto-2"> · {e.contas ?? 0} contas · {e.linhas ?? 0} linhas</span>
                {e.erros && <pre className="mt-1 whitespace-pre-wrap text-xs text-critico">{e.erros}</pre>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------- Conexões ---------- */}
      <section className="space-y-3">
        <h2 className="font-medium">1. Conexões com o Meta</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-borda bg-superficie p-4 text-sm">
            <div className="font-medium">
              Seu Business Manager (Usuário do Sistema){" "}
              <span className="text-xs font-normal text-texto-3">· opcional</span>
            </div>
            <p className="mt-1 text-texto-2">
              {temTokenBm
                ? "Token configurado. Puxa todas as contas atribuídas ao usuário do sistema, sem precisar reconectar."
                : "Não usado. Só é necessário se os clientes compartilharem as contas com um BM seu como parceiro; aí o acesso não expira. Suas contas já entram pelo Login com Facebook ao lado."}
            </p>
          </div>
          <div className="rounded-xl border border-borda bg-superficie p-4 text-sm">
            <div className="font-medium">Contas no BM do cliente (Login com Facebook)</div>
            <ul className="mt-1 space-y-1 text-texto-2">
              {((tokens ?? []) as TokenMeta[]).map((t) => {
                const dias = t.expira_em ? diasAte(t.expira_em) : null;
                return (
                  <li key={t.id}>
                    {t.nome} · {dias === null ? "sem validade informada" : dias <= 7
                      ? <span className="text-critico">expira em {dias} dia(s), reconecte</span>
                      : `expira em ${dias} dias`}
                  </li>
                );
              })}
            </ul>
            {temApp ? (
              <a href="/api/meta/conectar" className={`${botao} mt-2 inline-block`}>Conectar / reconectar perfil</a>
            ) : (
              <p className="mt-1 text-texto-3">Configure META_APP_ID e META_APP_SECRET para habilitar.</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <form action={importar}>
            <BotaoEnviar className={botaoPrimario} aguardando="Buscando contas…">Buscar contas no Meta</BotaoEnviar>
          </form>
        </div>
        <PainelSincronizacao />
      </section>

      {/* ---------- Clientes ---------- */}
      <section className="space-y-3">
        <h2 className="font-medium">2. Clientes, empresas e metas</h2>
        <p className="text-xs text-texto-3">
          Empresa = para quem você atende o cliente (ex.: Propulsão, Viccon, Clientes próprios). Para criar uma empresa
          nova, é só digitar o nome dela no cliente.
        </p>
        <datalist id="empresas">
          {empresas.map((e) => <option key={e} value={e} />)}
        </datalist>
        <div className="overflow-x-auto rounded-xl border border-borda bg-superficie">
          <div className="grid min-w-[980px] grid-cols-[1.5fr_1.2fr_1.1fr_0.9fr_0.9fr_0.7fr_auto] gap-2 px-4 py-2 text-xs text-texto-3">
            <span>Nome</span><span>Empresa</span><span>Nicho</span><span>Custo/result. meta (R$)</span>
            <span>Orçamento mensal (R$)</span><span>ROAS meta</span><span className="w-[190px]" />
          </div>
          {[...ativos, null].map((c) => (
            <form
              key={c?.id ?? "novo"} action={salvarCliente}
              className="grid min-w-[980px] grid-cols-[1.5fr_1.2fr_1.1fr_0.9fr_0.9fr_0.7fr_auto] items-center gap-2 border-t border-borda px-4 py-2"
            >
              <input type="hidden" name="id" value={c?.id ?? ""} />
              <input name="nome" defaultValue={c?.nome} placeholder="Novo cliente" className={campoGrade} required />
              <input name="empresa" list="empresas" defaultValue={c?.empresa ?? ""} placeholder="Clientes próprios" className={campoGrade} />
              <input name="nicho" defaultValue={c?.nicho ?? ""} placeholder="ex.: odontologia" className={campoGrade} />
              <input name="cpl_meta" defaultValue={c?.cpl_meta ?? ""} inputMode="decimal" className={campoGrade} />
              <input name="orcamento_mensal" defaultValue={c?.orcamento_mensal ?? ""} inputMode="decimal" className={campoGrade} />
              <input name="roas_meta" defaultValue={c?.roas_meta ?? ""} inputMode="decimal" className={campoGrade} />
              <span className="flex w-[190px] gap-2">
                <BotaoEnviar className={c ? botao : botaoPrimario}>{c ? "Salvar" : "Adicionar"}</BotaoEnviar>
                {c && <BotaoChurn />}
              </span>
            </form>
          ))}
        </div>

        {encerrados.length > 0 && (
          <details className="rounded-xl border border-borda bg-superficie">
            <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
              Clientes encerrados / churn ({encerrados.length})
            </summary>
            <ul className="divide-y divide-borda text-sm">
              {encerrados.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                  <span className="font-medium">{c.nome}</span>
                  <span className="text-texto-3">
                    {c.empresa ?? "—"} · encerrado em {c.churn_em ? c.churn_em.split("-").reverse().join("/") : "—"}
                  </span>
                  <form action={reativarCliente} className="ml-auto">
                    <input type="hidden" name="id" value={c.id} />
                    <BotaoEnviar className={botao} aguardando="Reativando…">Reativar</BotaoEnviar>
                  </form>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* ---------- Contas ---------- */}
      <section id="contas-meta" className="space-y-3">
        <h2 className="font-medium">3. Contas do Meta → cliente <span className="font-normal text-texto-3">· {metaVinculadas.length} vinculada(s)</span></h2>
        {listaContas.length === 0 ? (
          <Aviso>Nenhuma conta ainda. Clique em “Buscar contas no Meta”.</Aviso>
        ) : !metaVinculadas.length ? (
          <Aviso>Nenhuma conta vinculada ainda. Abra “Vincular outra conta do Meta” abaixo e escolha o cliente.</Aviso>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-borda bg-superficie">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="text-left text-xs text-texto-3">
                <tr>
                  <th className="px-4 py-2 font-normal">Conta</th>
                  <th className="px-3 py-2 font-normal">Acesso</th>
                  <th className="px-3 py-2 font-normal">Última sync</th>
                  <th className="px-3 py-2 font-normal">Saldo / limite</th>
                  <th className="px-3 py-2 font-normal">Cliente</th>
                  <th className="px-3 py-2 font-normal">Sincronizar</th>
                </tr>
              </thead>
              <tbody>
                {metaVinculadas.map((conta) => (
                  <tr key={conta.id} className="border-t border-borda align-top">
                    <td className="px-4 py-2">
                      <div>{conta.nome}</div>
                      <div className="text-xs text-texto-3">
                        {conta.id} · {conta.bm_nome ?? "sem BM"}{conta.status !== 1 && " · conta inativa"}
                      </div>
                      {conta.ultimo_erro && <div className="text-xs text-critico">Erro: {conta.ultimo_erro}</div>}
                    </td>
                    <td className="px-3 py-2 text-texto-2">{conta.origem === "bm" ? "Seu BM" : "Login FB"}</td>
                    <td className="px-3 py-2 text-texto-2">{quandoFoi(conta.ultima_sync)}</td>
                    <td className="num px-3 py-2 text-texto-2">
                      {conta.pre_paga
                        ? <span title={conta.saldo_texto ?? ""}>Pré-paga: {dinheiro(conta.saldo)}</span>
                        : conta.pre_paga === false ? "Pós-paga (cartão)" : "—"}
                      {conta.limite_gasto != null && conta.total_gasto != null && (
                        <div className="text-xs text-texto-3">
                          Limite: resta {dinheiro(conta.limite_gasto - conta.total_gasto)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <form action={vincularConta} className="flex gap-2">
                        <input type="hidden" name="conta_id" value={conta.id} />
                        <select name="cliente_id" defaultValue={conta.cliente_id ?? ""} className={campo}>
                          <option value="">— sem cliente —</option>
                          {listaClientes.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.ativo ? "" : " (encerrado)"}</option>)}
                        </select>
                        <BotaoEnviar className={botao} aguardando="…">OK</BotaoEnviar>
                      </form>
                    </td>
                    <td className="px-3 py-2">
                      <form action={alternarSyncConta}>
                        <input type="hidden" name="conta_id" value={conta.id} />
                        <input type="hidden" name="ativa" value={conta.ativa_sync ? "0" : "1"} />
                        <BotaoEnviar className={botao} aguardando="…">{conta.ativa_sync ? "Ativa · pausar" : "Pausada · ativar"}</BotaoEnviar>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {metaLivres.length > 0 && (
          <details open={!!mbusca} className="rounded-xl border border-borda bg-superficie">
            <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
              Vincular outra conta do Meta <span className="font-normal text-texto-3">({metaLivres.length} sem cliente)</span>
            </summary>
            <div className="space-y-2 border-t border-borda p-3">
              <form method="get" action="/configuracoes#contas-meta" className="flex flex-wrap gap-2 text-sm">
                <input name="mbusca" defaultValue={mbusca ?? ""} placeholder="Buscar por nome, ID ou BM" className={`${campo} w-64`} />
                <button className={botao}>Buscar</button>
              </form>
              <ListaVincular
                contas={metaFiltradas.map((c) => ({ id: c.id, nome: c.nome, detalhe: `${c.id} · ${c.bm_nome ?? "sem BM"}${c.status !== 1 ? " · inativa" : ""}` }))}
                total={metaFiltradasTotal} clientes={listaClientes} acao={vincularConta}
              />
            </div>
          </details>
        )}
      </section>

      {/* ---------- Google Ads ---------- */}
      <section id="google" className="space-y-3">
        <h2 className="font-medium">4. Google Ads</h2>
        <div className="rounded-xl border border-borda bg-superficie p-4 text-sm">
          <div className="font-medium">Login com Google</div>
          <p className="mt-1 text-texto-2">
            Puxa as contas em que seu e-mail é administrador e as que estão nos MCCs das agências (Propulsão, Viccon…).
            Só leitura: o painel não altera nada nas campanhas.
          </p>
          <ul className="mt-2 space-y-1">
            {((tokensGoogle ?? []) as { id: string; email: string; atualizado_em: string }[]).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2">
                <span>{t.email}</span>
                <span className="text-texto-3">· conectado {quandoFoi(t.atualizado_em)}</span>
                <form action={desconectarGoogle}>
                  <input type="hidden" name="id" value={t.id} />
                  <BotaoEnviar className="text-xs text-texto-3 underline hover:text-critico" aguardando="…">desconectar</BotaoEnviar>
                </form>
              </li>
            ))}
          </ul>
          {googleConfigurado() ? (
            <a href="/api/google/conectar" className={`${botao} mt-2 inline-block`}>Conectar / reconectar Google</a>
          ) : (
            <p className="mt-1 text-texto-3">Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET na Vercel para habilitar.</p>
          )}
        </div>
        {!!tokensGoogle?.length && (
          <div className="flex flex-wrap items-start gap-2">
            <form action={importarGoogle}>
              <BotaoEnviar className={botaoPrimario} aguardando="Buscando contas…">Buscar contas no Google</BotaoEnviar>
            </form>
            <form action={sincronizarGoogleAgora}>
              <input type="hidden" name="dias" value="30" />
              <BotaoEnviar className={botao} aguardando="Sincronizando o Google… (pode levar alguns minutos)">
                Sincronizar Google (últimos 30 dias)
              </BotaoEnviar>
            </form>
          </div>
        )}
        {!!contasGoogle?.length && (() => {
          const todas = contasGoogle as ContaGoogle[];
          const vinculadas = todas.filter((c) => c.cliente_id);
          const livres = todas.filter((c) => !c.cliente_id);
          const acessos = [...new Set(livres.map((c) => c.gerente_nome ?? "—"))].sort();
          const termo = (gbusca ?? "").trim().toLowerCase();
          const filtradas = livres
            .filter((c) => gcanceladas || c.status === "ENABLED" || !c.status)
            .filter((c) => !gacesso || (c.gerente_nome ?? "—") === gacesso)
            .filter((c) => !termo || c.nome.toLowerCase().includes(termo) || c.id.includes(termo.replace(/\D/g, "") || "§"));
          const mostradas = filtradas.slice(0, 30);
          const tabela = (lista: ContaGoogle[], comSync: boolean) => (
            <div className="overflow-x-auto rounded-xl border border-borda bg-superficie">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="text-left text-xs text-texto-3">
                  <tr>
                    <th className="px-4 py-2 font-normal">Conta</th>
                    <th className="px-3 py-2 font-normal">Acesso</th>
                    {comSync && <th className="px-3 py-2 font-normal">Última sync</th>}
                    <th className="px-3 py-2 font-normal">Cliente</th>
                    {comSync && <th className="px-3 py-2 font-normal">Sincronizar</th>}
                  </tr>
                </thead>
                <tbody>
                  {lista.map((conta) => (
                    <tr key={conta.id} className="border-t border-borda align-top">
                      <td className="px-4 py-2">
                        <div>{conta.nome}</div>
                        <div className="text-xs text-texto-3">
                          {formatarIdGoogle(conta.id)}{conta.status && conta.status !== "ENABLED" && ` · ${conta.status === "CANCELED" ? "cancelada" : conta.status === "SUSPENDED" ? "suspensa" : conta.status.toLowerCase()}`}
                        </div>
                        {comSync && conta.ultimo_erro && <div className="text-xs text-critico">Erro: {conta.ultimo_erro}</div>}
                      </td>
                      <td className="px-3 py-2 text-texto-2">{conta.gerente_nome ?? "—"}</td>
                      {comSync && <td className="px-3 py-2 text-texto-2">{quandoFoi(conta.ultima_sync)}</td>}
                      <td className="px-3 py-2">
                        <form action={vincularContaGoogle} className="flex gap-2">
                          <input type="hidden" name="conta_id" value={conta.id} />
                          <select name="cliente_id" defaultValue={conta.cliente_id ?? ""} className={campo}>
                            <option value="">— sem cliente —</option>
                            {listaClientes.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.ativo ? "" : " (encerrado)"}</option>)}
                          </select>
                          <BotaoEnviar className={botao} aguardando="…">OK</BotaoEnviar>
                        </form>
                      </td>
                      {comSync && (
                        <td className="px-3 py-2">
                          <form action={alternarSyncContaGoogle}>
                            <input type="hidden" name="conta_id" value={conta.id} />
                            <input type="hidden" name="ativa" value={conta.ativa_sync ? "0" : "1"} />
                            <BotaoEnviar className={botao} aguardando="…">{conta.ativa_sync ? "Ativa · pausar" : "Pausada · ativar"}</BotaoEnviar>
                          </form>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
          return (
            <>
              <h3 className="text-sm font-medium">Suas contas (vinculadas a clientes) · {vinculadas.length}</h3>
              {vinculadas.length
                ? tabela(vinculadas, true)
                : <Aviso>Nenhuma conta vinculada ainda. Procure abaixo as contas dos seus clientes e escolha o cliente.</Aviso>}
              <p className="text-xs text-texto-3">
                Só as contas vinculadas a um cliente são sincronizadas. As outras ficam só nesta lista e não gastam cota do Google.
              </p>

              <details open={!!(gbusca || gacesso || gcanceladas)} className="rounded-xl border border-borda bg-superficie">
              <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
                Vincular outra conta do Google <span className="font-normal text-texto-3">({livres.length} sem cliente)</span>
              </summary>
              <div className="space-y-2 border-t border-borda p-3">
              <form method="get" action="/configuracoes#google" className="flex flex-wrap items-center gap-2 text-sm">
                <input name="gbusca" defaultValue={gbusca ?? ""} placeholder="Buscar por nome ou ID" className={`${campo} w-64`} />
                <select name="gacesso" defaultValue={gacesso ?? ""} className={campo}>
                  <option value="">Todos os acessos</option>
                  {acessos.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <label className="flex items-center gap-1 text-texto-2">
                  <input type="checkbox" name="gcanceladas" value="1" defaultChecked={gcanceladas} /> mostrar canceladas
                </label>
                <button className={botao}>Filtrar</button>
              </form>
              <ListaVincular
                contas={mostradas.map((c) => ({ id: c.id, nome: c.nome, detalhe: `${formatarIdGoogle(c.id)} · ${c.gerente_nome ?? "—"}${c.status && c.status !== "ENABLED" ? " · cancelada/suspensa" : ""}` }))}
                total={filtradas.length} clientes={listaClientes} acao={vincularContaGoogle}
              />
              </div>
              </details>
            </>
          );
        })()}
      </section>
    </div>
  );
}

/** Lista compacta de contas sem cliente, com o seletor para vincular. */
function ListaVincular({ contas, total, clientes, acao }: {
  contas: { id: string; nome: string; detalhe: string }[];
  total: number;
  clientes: Cliente[];
  acao: (form: FormData) => Promise<void>;
}) {
  if (!contas.length) return <p className="text-sm text-texto-3">Nenhuma conta com essa busca.</p>;
  return (
    <>
      <ul className="divide-y divide-borda text-sm">
        {contas.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate">{c.nome}</span>
              <span className="block truncate text-xs text-texto-3">{c.detalhe}</span>
            </span>
            <form action={acao} className="flex gap-2">
              <input type="hidden" name="conta_id" value={c.id} />
              <select name="cliente_id" defaultValue="" className={campo}>
                <option value="">— escolher cliente —</option>
                {clientes.filter((x) => x.ativo).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
              </select>
              <BotaoEnviar className={botao} aguardando="…">Vincular</BotaoEnviar>
            </form>
          </li>
        ))}
      </ul>
      {total > contas.length && (
        <p className="text-xs text-texto-3">Mostrando {contas.length} de {total}. Use a busca para achar a conta do seu cliente.</p>
      )}
    </>
  );
}
