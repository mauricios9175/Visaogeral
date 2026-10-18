import { db, type Cliente, type ContaAnuncio, type TokenMeta } from "@/lib/db";
import { diasAte, quandoFoi } from "@/lib/formato";
import { Aviso } from "@/components/ui";
import { alternarSyncConta, importar, salvarCliente, sincronizarAgora, vincularConta } from "../../acoes";

export const maxDuration = 300;

const campo = "rounded-lg border border-borda bg-fundo px-2 py-1.5 text-sm outline-none focus:border-destaque";
const botao = "rounded-lg border border-borda bg-superficie px-3 py-1.5 text-sm hover:border-destaque";
const botaoPrimario = "rounded-lg bg-destaque px-3 py-1.5 text-sm font-medium text-white";

export default async function Configuracoes({ searchParams }: PageProps<"/configuracoes">) {
  const { msg } = (await searchParams) as { msg?: string };
  const banco = db();
  const [{ data: clientes }, { data: contas }, { data: tokens }] = await Promise.all([
    banco.from("clientes").select("*").order("nome"),
    banco.from("contas_anuncio").select("*").order("nome"),
    banco.from("tokens_meta").select("id, fb_user_id, nome, expira_em"),
  ]);
  const listaClientes = (clientes ?? []) as Cliente[];
  const listaContas = (contas ?? []) as ContaAnuncio[];
  const temTokenBm = Boolean(process.env.META_SYSTEM_USER_TOKEN);
  const temApp = Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Configurações</h1>
      {msg && <Aviso>{msg}</Aviso>}

      {/* ---------- Conexões ---------- */}
      <section className="space-y-3">
        <h2 className="font-medium">1. Conexões com o Meta</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-borda bg-superficie p-4 text-sm">
            <div className="font-medium">Seu Business Manager (Usuário do Sistema)</div>
            <p className="mt-1 text-texto-2">
              {temTokenBm
                ? "Token configurado. Puxa todas as contas atribuídas ao usuário do sistema."
                : "Falta configurar META_SYSTEM_USER_TOKEN nas variáveis de ambiente."}
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
        <div className="flex flex-wrap gap-2">
          <form action={importar}><button className={botaoPrimario}>Buscar contas no Meta</button></form>
          <form action={sincronizarAgora}>
            <input type="hidden" name="modo" value="semana" />
            <button className={botao}>Sincronizar últimos 7 dias</button>
          </form>
          <form action={sincronizarAgora}>
            <input type="hidden" name="modo" value="mes" />
            <button className={botao}>Recarregar últimos 30 dias</button>
          </form>
        </div>
      </section>

      {/* ---------- Clientes ---------- */}
      <section className="space-y-3">
        <h2 className="font-medium">2. Clientes e metas</h2>
        <div className="overflow-x-auto rounded-xl border border-borda bg-superficie">
          <div className="grid min-w-[760px] grid-cols-[2fr_1.5fr_1fr_1fr_1fr_80px_100px] gap-2 px-4 py-2 text-xs text-texto-3">
            <span>Nome</span><span>Nicho</span><span>Custo/result. meta (R$)</span>
            <span>Orçamento mensal (R$)</span><span>ROAS meta</span><span>Ativo</span><span />
          </div>
          {[...listaClientes, null].map((c) => (
            <form
              key={c?.id ?? "novo"} action={salvarCliente}
              className="grid min-w-[760px] grid-cols-[2fr_1.5fr_1fr_1fr_1fr_80px_100px] items-center gap-2 border-t border-borda px-4 py-2"
            >
              <input type="hidden" name="id" value={c?.id ?? ""} />
              <input name="nome" defaultValue={c?.nome} placeholder="Novo cliente" className={campo} required />
              <input name="nicho" defaultValue={c?.nicho ?? ""} placeholder="ex.: odontologia" className={campo} />
              <input name="cpl_meta" defaultValue={c?.cpl_meta ?? ""} inputMode="decimal" className={campo} />
              <input name="orcamento_mensal" defaultValue={c?.orcamento_mensal ?? ""} inputMode="decimal" className={campo} />
              <input name="roas_meta" defaultValue={c?.roas_meta ?? ""} inputMode="decimal" className={campo} />
              <select name="ativo" defaultValue={c?.ativo === false ? "off" : "on"} className={campo}>
                <option value="on">Sim</option><option value="off">Não</option>
              </select>
              <button className={c ? botao : botaoPrimario}>{c ? "Salvar" : "Adicionar"}</button>
            </form>
          ))}
        </div>
      </section>

      {/* ---------- Contas ---------- */}
      <section className="space-y-3">
        <h2 className="font-medium">3. Contas de anúncio → cliente</h2>
        {listaContas.length === 0 ? (
          <Aviso>Nenhuma conta ainda. Clique em “Buscar contas no Meta”.</Aviso>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-borda bg-superficie">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs text-texto-3">
                <tr>
                  <th className="px-4 py-2 font-normal">Conta</th>
                  <th className="px-3 py-2 font-normal">Acesso</th>
                  <th className="px-3 py-2 font-normal">Última sync</th>
                  <th className="px-3 py-2 font-normal">Cliente</th>
                  <th className="px-3 py-2 font-normal">Sincronizar</th>
                </tr>
              </thead>
              <tbody>
                {listaContas.map((conta) => (
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
                    <td className="px-3 py-2">
                      <form action={vincularConta} className="flex gap-2">
                        <input type="hidden" name="conta_id" value={conta.id} />
                        <select name="cliente_id" defaultValue={conta.cliente_id ?? ""} className={campo}>
                          <option value="">— sem cliente —</option>
                          {listaClientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                        </select>
                        <button className={botao}>OK</button>
                      </form>
                    </td>
                    <td className="px-3 py-2">
                      <form action={alternarSyncConta}>
                        <input type="hidden" name="conta_id" value={conta.id} />
                        <input type="hidden" name="ativa" value={conta.ativa_sync ? "0" : "1"} />
                        <button className={botao}>{conta.ativa_sync ? "Ativa · pausar" : "Pausada · ativar"}</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
