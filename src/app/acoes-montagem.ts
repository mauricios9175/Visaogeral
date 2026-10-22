"use server";

import { revalidatePath } from "next/cache";
import { db, type ContaAnuncio } from "@/lib/db";
import { normalizarConfig, type ConfigMeta, type ObjetivoMeta } from "@/lib/modelos";
import { montarNoMeta } from "@/lib/meta-montar";
import { linkGerenciador } from "@/lib/meta";
import { tokenDaConta } from "@/lib/sync";
import { apagar } from "@/lib/armazenamento";

export type ResultadoMontagem = { ok: boolean; mensagem: string; detalhes: string[]; link: string | null };

type Payload = {
  clienteId: string; conta: string; modeloId: string; objetivo: ObjetivoMeta; config: ConfigMeta;
  pagina: string; instagram: string; formulario: string; pixel: string;
  criativos: { caminho: string; nome: string; tipo: string }[];
};

/** Cria campanha, conjunto e anúncios (tudo pausado) a partir do modelo. Se algo falhar no meio, desfaz o que criou. */
export async function montarCampanhaMeta(_: ResultadoMontagem | null, form: FormData): Promise<ResultadoMontagem> {
  let p: Payload;
  try {
    p = JSON.parse(String(form.get("payload")));
  } catch {
    return { ok: false, mensagem: "Dados da montagem inválidos.", detalhes: [], link: null };
  }
  const banco = db();
  const [{ data: cliente }, { data: conta }] = await Promise.all([
    banco.from("clientes").select("id, nome").eq("id", p.clienteId).maybeSingle(),
    banco.from("contas_anuncio").select("*").eq("id", p.conta).eq("cliente_id", p.clienteId).maybeSingle(),
  ]);
  if (!cliente || !conta) return { ok: false, mensagem: "Cliente ou conta não encontrados.", detalhes: [], link: null };
  const token = await tokenDaConta(conta as ContaAnuncio);
  if (!token) return { ok: false, mensagem: "Sem token para esta conta (reconecte o Facebook em Configurações).", detalhes: [], link: null };

  const config = normalizarConfig(p.config);
  const registro = { plataforma: "meta", cliente_id: cliente.id, conta_id: conta.id, nivel: "campanha", acao: "montar" };
  try {
    const r = await montarNoMeta({
      contaId: conta.id, token, clienteNome: cliente.nome, objetivo: p.objetivo, config,
      paginaId: p.pagina, instagramId: p.instagram || null, formularioId: p.formulario || null, pixelId: p.pixel || null,
      criativos: p.criativos,
    });
    // lembra as escolhas deste cliente para a próxima montagem
    await banco.from("clientes").update({
      padroes_meta: { conta: conta.id, pagina: p.pagina, instagram: p.instagram, formulario: p.formulario, pixel: p.pixel, locais: config.locais },
    }).eq("id", cliente.id).then(() => null, () => null);
    await banco.from("acoes_log").insert({
      ...registro, objeto_id: r.campanhaId, objeto_nome: r.campanhaNome, ok: true,
      depois: `${r.anuncios} anúncio(s), ${r.falhas.length ? `${r.falhas.length} criativo(s) com erro` : "pausado"}`,
    }).then(() => null, () => null);
    await apagar(p.criativos.map((c) => c.caminho));
    revalidatePath(`/clientes/${cliente.id}`);
    return {
      ok: true,
      mensagem: `Campanha “${r.campanhaNome}” criada PAUSADA com ${r.anuncios} anúncio(s).`,
      detalhes: r.falhas.map((f) => `⚠ ${f}`),
      link: linkGerenciador(conta.id, "campanha", r.campanhaId),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await banco.from("acoes_log").insert({ ...registro, objeto_id: "-", objeto_nome: config.nomeCampanha, ok: false, erro: msg })
      .then(() => null, () => null);
    return { ok: false, mensagem: "Não foi possível montar a campanha. Nada ficou criado no Meta.", detalhes: [msg], link: null };
  }
}
