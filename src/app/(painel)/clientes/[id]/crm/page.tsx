import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { quandoFoi } from "@/lib/formato";
import type { FunilRd } from "@/lib/crm/rd";
import { listarFunisCrm, NOME_CRM, type ConexaoCrm } from "@/lib/crm/sync";
import { Aviso } from "@/components/ui";
import { BotaoEnviar } from "@/components/botao";
import { removerConexaoCrm, salvarConexaoCrm, salvarFontesCrm, salvarFunilCrm, sincronizarCrmAgora } from "../../../../acoes";
import { ehFonteAnuncio, fontesDoCliente } from "@/lib/consultas";

export const maxDuration = 300;

const campo = "rounded-lg border border-borda bg-fundo px-2 py-1.5 text-sm outline-none focus:border-destaque";
const botao = "rounded-lg border border-borda bg-superficie px-3 py-1.5 text-sm hover:border-destaque";
const botaoPrimario = "rounded-lg bg-destaque px-3 py-1.5 text-sm font-medium text-white";

export default async function ConfigCrm({ params, searchParams }: PageProps<"/clientes/[id]/crm">) {
  const { id } = await params;
  const { msg } = (await searchParams) as { msg?: string };
  const banco = db();
  const [{ data: cliente }, { data: conexao }] = await Promise.all([
    banco.from("clientes").select("id, nome").eq("id", id).maybeSingle(),
    banco.from("crm_conexoes").select("*").eq("cliente_id", id).maybeSingle(),
  ]);
  if (!cliente) notFound();
  const c = conexao as ConexaoCrm | null;

  const fontes = c ? await fontesDoCliente(id).catch(() => []) : [];
  let funis: FunilRd[] = [];
  let erroFunis: string | null = null;
  if (c) {
    try {
      funis = await listarFunisCrm(c);
    } catch (e) {
      erroFunis = e instanceof Error ? e.message : String(e);
    }
  }
  const valorAtual =
    c?.etapa_qualificado
      ? (() => {
          const f = funis.find((x) => x.id === c.pipeline_id);
          const e = f?.etapas.find((x) => x.id === c.etapa_qualificado);
          return f && e ? `${f.id}|${f.nome}|${e.id}|${e.nome}|${e.ordem}` : "";
        })()
      : "";

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/clientes/${id}`} className="text-sm text-texto-3 hover:text-texto">← {cliente.nome}</Link>
        <h1 className="text-xl font-semibold">CRM de {cliente.nome}</h1>
        <p className="text-sm text-texto-2">
          O painel só lê o CRM: traz os negócios, a etapa em que estão, se viraram venda e o valor. Nada é alterado lá.
        </p>
      </div>
      {msg && <Aviso>{msg}</Aviso>}

      {/* 1. Conexão */}
      <section className="space-y-3 rounded-xl border border-borda bg-superficie p-4">
        <h2 className="font-medium">1. Conexão</h2>
        <form action={salvarConexaoCrm} className="space-y-3">
          <input type="hidden" name="cliente_id" value={id} />
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              CRM
              <select name="tipo" defaultValue={c?.tipo ?? "rd_crm"} className={campo}>
                <option value="rd_crm">RD Station CRM</option>
                <option value="highlevel">Ávora (HighLevel)</option>
                <option value="kommo" disabled>Kommo (em breve)</option>
              </select>
            </label>
            <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
              Token
              <input
                type="password" name="token" autoComplete="off" className={campo}
                placeholder={c ? "•••••••• (deixe vazio para manter o atual)" : "Cole aqui o token"}
              />
            </label>
            <label className="flex min-w-56 flex-col gap-1 text-sm">
              ID da subconta <span className="text-xs text-texto-3">(só Ávora)</span>
              <input name="location_id" defaultValue={c?.location_id ?? ""} className={campo} placeholder="ex.: aBcD1234EfGh" />
            </label>
            <BotaoEnviar className={botaoPrimario} aguardando="Testando…">
              {c ? "Atualizar e testar" : "Conectar"}
            </BotaoEnviar>
          </div>
        </form>
        <details className="text-xs text-texto-3">
          <summary className="cursor-pointer">Onde achar o token</summary>
          <p className="mt-2">
            <b>RD Station CRM:</b> clique no seu nome (canto superior direito) → Perfil → copie o Token. Use um usuário
            que veja todas as negociações.
          </p>
          <p className="mt-2">
            <b>Ávora:</b> Configurações → <b>Integrações Privado</b> → Criar nova integração → dê um nome (ex.: Painel) →
            marque as permissões <i>Ver oportunidades</i> (opportunities.readonly), <i>Ver contatos</i>
            (contacts.readonly), <i>Ver locais</i> (locations.readonly) e <i>Ver campos personalizados</i>
            (locations/customFields.readonly) → crie e copie o token. O <b>ID da subconta</b> aparece no endereço do
            navegador, depois de <code>/location/</code> (ex.: app.avoracrm.com.br/v2/location/<b>aBcD1234EfGh</b>/…).
          </p>
        </details>
        {c && (
          <p className="text-sm text-texto-2">
            {NOME_CRM[c.tipo]} conectado · última sincronização {quandoFoi(c.ultima_sync)}
            {c.ultimo_erro && <span className="block text-critico">Erro: {c.ultimo_erro}</span>}
          </p>
        )}
      </section>

      {/* 2. Funil e qualificação */}
      {c && (
        <section className="space-y-3 rounded-xl border border-borda bg-superficie p-4">
          <h2 className="font-medium">2. Funil e etapa de qualificação</h2>
          {erroFunis ? (
            <p className="text-sm text-critico">Não foi possível ler os funis: {erroFunis}</p>
          ) : (
            <form action={salvarFunilCrm} className="space-y-3">
              <input type="hidden" name="cliente_id" value={id} />
              <label className="flex flex-col gap-1 text-sm">
                A partir de qual etapa o lead conta como <b>qualificado</b>?
                <select name="escolha" required defaultValue={valorAtual} className={campo}>
                  <option value="" disabled>Escolha o funil e a etapa…</option>
                  {funis.map((f) => (
                    <optgroup key={f.id} label={`Funil: ${f.nome}`}>
                      {f.etapas.map((e) => (
                        <option key={e.id} value={`${f.id}|${f.nome}|${e.id}|${e.nome}|${e.ordem}`}>
                          {e.ordem}. {e.nome}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <p className="text-xs text-texto-3">
                O painel sempre traz <b>todos os funis</b> (leads = todos os negócios criados). Conta como qualificado
                o negócio que estiver nesse funil, nessa etapa ou depois dela, além dos negócios ganhos. Ex.: funil de
                SDR + funil de consultores → escolha a 1ª etapa do funil de consultores. <b>Venda</b> = negócio ganho,
                com o valor dele.
              </p>
              <BotaoEnviar className={botaoPrimario}>Salvar</BotaoEnviar>
            </form>
          )}
          {c.pipeline_nome && (
            <p className="text-sm text-texto-2">
              Atual: funil <b>{c.pipeline_nome}</b>, qualificado a partir de <b>{c.etapa_qualificado_nome}</b>.
            </p>
          )}
        </section>
      )}

      {/* 3. Fontes de anúncio */}
      {c && (
        <section className="space-y-3 rounded-xl border border-borda bg-superficie p-4">
          <h2 className="font-medium">3. Quais fontes são de anúncio?</h2>
          {fontes.length === 0 ? (
            <p className="text-sm text-texto-3">
              Nenhuma fonte encontrada ainda. Clique em “Sincronizar CRM agora” e volte aqui.
            </p>
          ) : (
            <form action={salvarFontesCrm} className="space-y-3">
              <input type="hidden" name="cliente_id" value={id} />
              <div className="grid gap-1 sm:grid-cols-2">
                {fontes.map((f) => (
                  <label key={f.nome} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox" name="fonte" value={f.nome}
                      defaultChecked={ehFonteAnuncio(f.nome, c.fontes_anuncio)}
                    />
                    {f.nome} <span className="text-xs text-texto-3">({f.total})</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-texto-3">
                {c.fontes_anuncio
                  ? "Seleção salva por você."
                  : "Pré-marcadas automaticamente (Facebook, Meta, Google, Ads…). Confira e salve."}
                {" "}Leads das outras fontes (orgânico, porta, indicação…) continuam aparecendo, mas os custos e o ROAS
                usam só as fontes marcadas.
              </p>
              <BotaoEnviar className={botaoPrimario}>Salvar fontes</BotaoEnviar>
            </form>
          )}
        </section>
      )}

      {/* 4. Sincronizar / remover */}
      {c && (
        <section className="flex flex-wrap items-start gap-3">
          <form action={sincronizarCrmAgora}>
            <input type="hidden" name="cliente_id" value={id} />
            <BotaoEnviar className={botao} aguardando="Sincronizando CRM…" aviso="Pode levar até 1 minuto.">
              Sincronizar CRM agora
            </BotaoEnviar>
          </form>
          <form action={removerConexaoCrm}>
            <input type="hidden" name="cliente_id" value={id} />
            <BotaoEnviar className={`${botao} text-critico`} aguardando="Removendo…">Remover conexão</BotaoEnviar>
          </form>
        </section>
      )}
    </div>
  );
}
