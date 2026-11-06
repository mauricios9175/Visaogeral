import Link from "next/link";
import { Aviso, Voltar } from "@/components/ui";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { normalizarConfig, OBJETIVO_FORMULARIO, type Modelo } from "@/lib/modelos";
import { Montagem, type DestinoMontagem, type Padroes } from "@/components/montagem";
import { lerDestinoMeta } from "@/lib/meta-montar";
import { tokenDaConta } from "@/lib/sync";
import type { ContaAnuncio } from "@/lib/db";

export const maxDuration = 300;

export default async function Montar({ params, searchParams }: PageProps<"/clientes/[id]/montar">) {
  const { id } = await params;
  const { pedido, campanha, conjunto } = (await searchParams) as { pedido?: string; campanha?: string; conjunto?: string };
  const banco = db();
  const [{ data: cliente }, { data: contas }, { data: modelos }] = await Promise.all([
    banco.from("clientes").select("*").eq("id", id).maybeSingle(),
    banco.from("contas_anuncio").select("id, nome").eq("cliente_id", id).order("nome"),
    banco.from("modelos").select("*").eq("plataforma", "meta").order("nome"),
  ]);
  if (!cliente) notFound();

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
  const titulo = destino?.conjunto ? "Novo anúncio no conjunto" : destino ? "Novo conjunto na campanha" : "Montar campanha no Meta";

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
      />
    </div>
  );
}
