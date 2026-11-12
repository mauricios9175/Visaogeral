import "server-only";
import { db, EMPRESA_PADRAO } from "./db";
import { hojeISO, somarDias } from "./datas";
import { lerFicha } from "./ficha";
import { configEmpresa } from "./empresas";
import { linkDoCliente } from "./portal";

// Checklist de implantação de cada cliente. A maior parte o painel confere sozinho (conta vinculada, CRM,
// UTMs, metas, briefing…); o resto (reunião, grupo, acessos recebidos) você marca. Itens podem ser "não se aplica".
// Estado em configuracoes ("implantacao:<cliente>"); os itens manuais são um modelo único ("implantacao_modelo").

export type ItemImplantacao = {
  id: string;
  texto: string;
  auto: boolean;            // conferido pelo painel
  ok: boolean;
  detalhe?: string;
  link?: string;            // onde resolver
  ignorado?: boolean;       // "não se aplica" para este cliente
  feitoEm?: string;         // manual: quando marcou
};

type Estado = { feitos: Record<string, string>; ignorados: string[] };

export const MODELO_PADRAO = [
  "Reunião de alinhamento (kickoff) feita",
  "Grupo de WhatsApp com o cliente criado",
  "Acesso à conta de anúncio / BM recebido",
  "Acesso ao Instagram e à página recebido",
  "Materiais e criativos recebidos",
  "Destino testado (formulário, WhatsApp ou site recebendo o lead)",
];

const chave = (id: string) => `implantacao:${id}`;
const idManual = (texto: string) => `m:${texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`;

export async function lerModelo(): Promise<string[]> {
  const { data } = await db().from("configuracoes").select("valor").eq("chave", "implantacao_modelo").maybeSingle();
  return Array.isArray(data?.valor) ? (data.valor as string[]) : MODELO_PADRAO;
}

export async function salvarModelo(itens: string[]) {
  const limpos = [...new Set(itens.map((x) => String(x).trim()).filter(Boolean))].slice(0, 30).map((x) => x.slice(0, 120));
  const { error } = await db().from("configuracoes").upsert({ chave: "implantacao_modelo", valor: limpos, atualizado_em: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

async function lerEstado(clienteId: string): Promise<Estado> {
  const { data } = await db().from("configuracoes").select("valor").eq("chave", chave(clienteId)).maybeSingle();
  const v = (data?.valor ?? {}) as Partial<Estado>;
  return { feitos: v.feitos ?? {}, ignorados: v.ignorados ?? [] };
}

async function gravarEstado(clienteId: string, e: Estado) {
  const { error } = await db().from("configuracoes").upsert({ chave: chave(clienteId), valor: e, atualizado_em: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export async function marcarItem(clienteId: string, id: string, mudanca: { feito?: boolean; ignorado?: boolean }) {
  const e = await lerEstado(clienteId);
  if (mudanca.feito !== undefined) {
    if (mudanca.feito) e.feitos[id] = hojeISO();
    else delete e.feitos[id];
  }
  if (mudanca.ignorado !== undefined) {
    e.ignorados = e.ignorados.filter((x) => x !== id);
    if (mudanca.ignorado) e.ignorados.push(id);
  }
  await gravarEstado(clienteId, e);
}

/** O checklist do cliente, com os itens automáticos conferidos agora. */
export async function checklistDoCliente(clienteId: string): Promise<{ itens: ItemImplantacao[]; feitos: number; total: number }> {
  const banco = db();
  const hoje = hojeISO();
  const [{ data: cliente }, { data: contas }, { data: google }, { data: crm }, ficha, portal, { count: relatorios }, estado, modelo] = await Promise.all([
    banco.from("clientes").select("nome, nicho, cpl_meta, orcamento_mensal, empresa").eq("id", clienteId).maybeSingle(),
    banco.from("contas_anuncio").select("nome, ultima_sync, ultimo_erro, ativa_sync").eq("cliente_id", clienteId),
    banco.from("contas_google").select("id").eq("cliente_id", clienteId),
    banco.from("crm_conexoes").select("tipo, ultima_sync, ultimo_erro").eq("cliente_id", clienteId).maybeSingle(),
    lerFicha(clienteId).catch(() => null),
    linkDoCliente(clienteId).catch(() => null),
    banco.from("relatorios_gerados").select("id", { count: "exact", head: true }).eq("cliente_id", clienteId),
    lerEstado(clienteId),
    lerModelo(),
  ]);
  if (!cliente) throw new Error("Cliente não encontrado.");
  const base = `/clientes/${clienteId}`;
  const itens: ItemImplantacao[] = [];
  const auto = (id: string, texto: string, ok: boolean, detalhe?: string, link?: string) => itens.push({ id, texto, auto: true, ok, detalhe, link });

  const metas = ((contas ?? []) as { nome: string; ultima_sync: string | null; ultimo_erro: string | null; ativa_sync: boolean | null }[]).filter((c) => c.ativa_sync !== false);
  auto("meta", "Conta de anúncio do Meta vinculada", metas.length > 0, metas.map((c) => c.nome).join(", ") || "Vincule em Configurações", "/configuracoes");
  if (metas.length) {
    const comErro = metas.filter((c) => c.ultimo_erro);
    const parada = metas.filter((c) => !c.ultima_sync || c.ultima_sync.slice(0, 10) < somarDias(hoje, -2));
    auto("sync", "Meta sincronizando sem erro", !comErro.length && !parada.length,
      comErro.length ? `Erro em ${comErro.map((c) => c.nome).join(", ")}` : parada.length ? "Sem sincronizar há mais de 2 dias" : undefined, "/configuracoes");
  }
  auto("google", "Google Ads vinculado (se o cliente anuncia no Google)", (google ?? []).length > 0, undefined, "/configuracoes");

  const c = crm as { tipo: string; ultima_sync: string | null; ultimo_erro: string | null } | null;
  auto("crm", "CRM conectado", !!c && !c.ultimo_erro, c?.ultimo_erro ? `Erro: ${c.ultimo_erro.slice(0, 120)}` : c ? undefined : "Conecte em Conectar CRM", `${base}/crm`);
  if (c) {
    type Neg = { campanha: string | null; utm_campaign?: string | null; utm_content?: string | null; utm_medium?: string | null };
    const buscar = (colunas: string) => banco.from("crm_negocios").select(colunas).eq("cliente_id", clienteId)
      .gte("criado_em", `${somarDias(hoje, -30)}T00:00:00Z`).limit(2000);
    // sem o SQL das colunas de UTM: só a campanha
    let r = await buscar("campanha, utm_campaign, utm_content, utm_medium");
    if (r.error) r = await buscar("campanha");
    const lista = (r.data ?? []) as unknown as Neg[];
    const comUtm = lista.filter((n) => [n.utm_campaign, n.utm_content, n.utm_medium, n.campanha].some((x) => x && x.trim())).length;
    auto("leads", "Leads chegando no CRM (últimos 30 dias)", lista.length > 0, `${lista.length} lead(s)`, `${base}/crm`);
    if (lista.length) {
      const pct = Math.round((comUtm / lista.length) * 100);
      auto("utm", "UTMs chegando nos leads do CRM", pct >= 50, `${pct}% dos leads com UTM`, `${base}/crm`);
    }
  }
  auto("metas", "Metas cadastradas (custo por resultado e orçamento)", !!cliente.cpl_meta && !!cliente.orcamento_mensal,
    [!cliente.cpl_meta && "falta o custo por resultado", !cliente.orcamento_mensal && "falta o orçamento mensal"].filter(Boolean).join(", ") || undefined, "/configuracoes");
  auto("nicho", "Nicho cadastrado", !!cliente.nicho?.trim(), cliente.nicho ?? undefined, "/configuracoes");
  auto("briefing", "Briefing preenchido na ficha", (ficha?.briefing.trim().length ?? 0) >= 40, undefined, `${base}/ficha`);
  auto("links", "Links na ficha (Instagram, site, Drive…)", (ficha?.links.length ?? 0) > 0, ficha?.links.length ? `${ficha.links.length} link(s)` : undefined, `${base}/ficha`);
  auto("portal", "Link do cliente (portal) criado", !!portal, undefined, base);
  if ((await configEmpresa(cliente.empresa || EMPRESA_PADRAO).catch(() => null))?.relatorioMensal !== false) {
    auto("relatorio", "Primeiro relatório gerado", (relatorios ?? 0) > 0, undefined, `${base}/historico#relatorio`);
  }

  for (const texto of modelo) {
    const id = idManual(texto);
    itens.push({ id, texto, auto: false, ok: !!estado.feitos[id], feitoEm: estado.feitos[id] });
  }
  for (const it of itens) if (estado.ignorados.includes(it.id)) it.ignorado = true;
  const contam = itens.filter((x) => !x.ignorado);
  return { itens, feitos: contam.filter((x) => x.ok).length, total: contam.length };
}
