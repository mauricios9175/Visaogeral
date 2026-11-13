import Link from "next/link";
import { Aviso, Voltar } from "@/components/ui";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { normalizarConfig, OBJETIVO_FORMULARIO, type Modelo } from "@/lib/modelos";
import { Montagem, type DestinoMontagem, type Padroes } from "@/components/montagem";
import { lerDestinoMeta } from "@/lib/meta-montar";
import { tokenDaConta } from "@/lib/sync";
import { redirect } from "next/navigation";
import { getMeta, montarUrl } from "@/lib/meta";
import { lerRascunho, rascunhoDeMeta, salvarRascunho, type Rascunho } from "@/lib/rascunhos";
import { contaDoItem } from "@/lib/meta-copiar";
import type { ContaAnuncio } from "@/lib/db";

export const maxDuration = 300;

export default async function Montar({ params, searchParams }: PageProps<"/clientes/[id]/montar">) {
  const { id } = await params;
  const { pedido, campanha, conjunto, duplicar, destino: destinoDuplicar, rascunho: rascunhoId, copiar, contaDestino } = (await searchParams) as {
    pedido?: string; campanha?: string; conjunto?: string; duplicar?: string; destino?: string; rascunho?: string;
    copiar?: string; contaDestino?: string;
  };
  const banco = db();
  const [{ data: cliente }, { data: contas }, { data: modelos }] = await Promise.all([
    banco.from("clientes").select("*").eq("id", id).maybeSingle(),
    banco.from("contas_anuncio").select("id, nome").eq("cliente_id", id).order("nome"),
    banco.from("modelos").select("*").eq("plataforma", "meta").order("nome"),
  ]);
  if (!cliente) notFound();

  // "Duplicar" (?duplicar=conjunto:123&destino=…): copia do Meta para um rascunho e abre para editar antes de publicar
  let erroDuplicar: string | null = null;
  const dup = /^(campanha|conjunto|anuncio):(\d+)$/.exec(duplicar ?? "");
  if (dup) {
    let novo: Rascunho | null = null;
    const { data: todas } = await banco.from("contas_anuncio").select("*").eq("cliente_id", id);
    for (const c of (todas ?? []) as ContaAnuncio[]) {
      const token = await tokenDaConta(c);
      if (!token) continue;
      try {
        const { account_id } = await getMeta<{ account_id: string }>(montarUrl(dup[2], token, { fields: "account_id" }));
        if (`act_${account_id}` !== c.id) continue;
        novo = await salvarRascunho(await rascunhoDeMeta(id, c.id, token, dup[1] as "campanha" | "conjunto" | "anuncio", dup[2],
          /^(\d+|nova)$/.test(destinoDuplicar ?? "") ? destinoDuplicar : null));
        break;
      } catch (e) {
        erroDuplicar = e instanceof Error ? e.message : String(e);
      }
    }
    if (novo) redirect(`/clientes/${id}/montar?rascunho=${novo.id}`);
    erroDuplicar ??= "Não achei esse item nas contas deste cliente.";
  }
  // "Copiar para outra conta" (?copiar=act_origem:conjunto:123&contaDestino=act_destino): rascunho neste cliente, na conta escolhida
  const cop = /^(act_\d+):(campanha|conjunto|anuncio):(\d+)$/.exec(copiar ?? "");
  if (cop && /^act_\d+$/.test(contaDestino ?? "") && (contas ?? []).some((c) => c.id === contaDestino)) {
    let novo: Rascunho | null = null;
    try {
      const origem = await contaDoItem(cop[3], cop[1]);
      const { data: dono } = await banco.from("contas_anuncio").select("cliente_id").eq("id", origem.conta).maybeSingle();
      novo = await salvarRascunho(await rascunhoDeMeta(dono?.cliente_id ?? id, origem.conta, origem.token, cop[2] as "campanha" | "conjunto" | "anuncio", cop[3], null,
        { clienteId: id, conta: contaDestino!, mesmoCliente: dono?.cliente_id === id }));
    } catch (e) {
      erroDuplicar = e instanceof Error ? e.message : String(e);
    }
    if (novo) redirect(`/clientes/${id}/montar?rascunho=${novo.id}`);
  }
  const rascunho = rascunhoId ? await lerRascunho(id, rascunhoId).catch(() => null) : null;

  // criar dentro do que já existe (?campanha=… ou ?conjunto=…): lê no Meta com o token de uma conta do cliente
  let destino: DestinoMontagem | null = null;
  let erroDestino: string | null = null;
  const alvo = /^\d+$/.test(conjunto ?? "") ? { conjunto } : /^\d+$/.test(campanha ?? "") ? { campanha } : null;
  if (alvo) {
    const { data: todas } = await banco.from("contas_anuncio").select("*").eq("cliente_id", id);
    for (const c of (todas ?? []) as ContaAnuncio[]) {
      const token = await tokenDaConta(c);
      if (!token) continue;
      try {
        const d = await lerDestinoMeta(token, alvo);
        if (d.contaId !== c.id) continue;
        destino = { conta: c.id, campanhaId: d.campanhaId, campanhaNome: d.campanhaNome, orcamentoNaCampanha: d.orcamentoNaCampanha, objetivo: d.objetivo, conjunto: d.conjunto };
        if (!d.objetivo && d.objetivoMeta !== "OUTCOME_LEADS") erroDestino = `Essa campanha é de outro objetivo (${d.objetivoMeta}); o painel monta só formulário, WhatsApp e site.`;
        break;
      } catch (e) {
        erroDestino = e instanceof Error ? e.message : String(e);
      }
    }
    if (!destino && !erroDestino) erroDestino = "Não achei essa campanha/conjunto nas contas deste cliente.";
  }
  const titulo = rascunho ? `Rascunho: ${rascunho.titulo}` : destino?.conjunto ? "Novo anúncio no conjunto" : destino ? "Novo conjunto na campanha" : "Montar campanha no Meta";

  return (
    <div className="space-y-5">
      <div>
        <Voltar href={`/clientes/${id}`}>Voltar para {cliente.nome}</Voltar>
        <h1 className="text-xl font-semibold">{titulo}</h1>
        <p className="text-sm text-texto-2">
          {destino?.conjunto ? "Escolha a página, os textos e os criativos: o painel cria um anúncio por criativo dentro do conjunto"
            : destino ? "Escolha os públicos, os textos e os criativos: o painel cria os conjuntos (e os anúncios) dentro da campanha"
            : "Escolha o modelo, a página e os criativos. O painel cria a campanha, o conjunto e um anúncio por criativo"},
          tudo <b>pausado</b>. Depois é só revisar e ativar no Gerenciador.{" "}
          <Link href="/modelos" className="text-destaque underline">Editar modelos</Link>
        </p>
      </div>
      {erroDestino && <Aviso>{erroDestino}</Aviso>}
      {erroDuplicar && <Aviso>Não consegui copiar do Meta para o rascunho: {erroDuplicar}</Aviso>}
      {rascunhoId && !rascunho && <Aviso>Esse rascunho não existe mais (já foi publicado ou excluído).</Aviso>}
      <Montagem
        clienteId={id}
        clienteNome={cliente.nome}
        contas={(contas ?? []).map((c) => ({ id: c.id, nome: c.nome }))}
        modelos={((modelos ?? []) as Modelo[]).filter((m) => (m.objetivo as string) !== OBJETIVO_FORMULARIO)
          .map((m) => ({ ...m, config: normalizarConfig(m.config) }))}
        modelosFormulario={(modelos ?? []).filter((m) => m.objetivo === OBJETIVO_FORMULARIO).map((m) => ({ id: m.id, nome: m.nome }))}
        padroes={(cliente.padroes_meta ?? {}) as Padroes}
        pedidoInicial={pedido?.slice(0, 1000)}
        destino={destino}
        rascunho={rascunho}
        key={rascunho?.id ?? "nova"}
      />
    </div>
  );
}
