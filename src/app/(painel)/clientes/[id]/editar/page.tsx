import { notFound } from "next/navigation";
import { Aviso, Voltar } from "@/components/ui";
import { db, type ContaAnuncio } from "@/lib/db";
import { getMeta, linkGerenciador, montarUrl } from "@/lib/meta";
import { lerParaEditar, type Edicao } from "@/lib/meta-editar";
import { tokenDaConta } from "@/lib/sync";
import { EditarMeta } from "@/components/editar-meta";
import { AnalisarCriativo } from "@/components/analise-criativo";

const NIVEIS = { campanha: "campanha", conjunto: "conjunto", anuncio: "anúncio" } as const;

/** Editar campanha, conjunto ou anúncio do Meta: ?nivel=conjunto&id=123&voltar=/clientes/… */
export default async function Editar({ params, searchParams }: PageProps<"/clientes/[id]/editar">) {
  const { id } = await params;
  const busca = (await searchParams) as { nivel?: string; id?: string; voltar?: string };
  const nivel = busca.nivel && busca.nivel in NIVEIS ? (busca.nivel as keyof typeof NIVEIS) : null;
  const objeto = /^\d+$/.test(busca.id ?? "") ? busca.id! : null;
  const voltar = busca.voltar?.startsWith(`/clientes/${id}`) ? busca.voltar : `/clientes/${id}`;
  const banco = db();
  const [{ data: cliente }, { data: contas }] = await Promise.all([
    banco.from("clientes").select("id, nome").eq("id", id).maybeSingle(),
    banco.from("contas_anuncio").select("*").eq("cliente_id", id),
  ]);
  if (!cliente || !nivel || !objeto) notFound();

  // acha a conta do item entre as do cliente (e o token que enxerga)
  let edicao: Edicao | null = null;
  let contaId: string | null = null;
  let erro: string | null = null;
  for (const c of (contas ?? []) as ContaAnuncio[]) {
    const token = await tokenDaConta(c);
    if (!token) continue;
    try {
      const { account_id } = await getMeta<{ account_id: string }>(montarUrl(objeto, token, { fields: "account_id" }));
      if (`act_${account_id}` !== c.id) continue;
      edicao = await lerParaEditar(nivel, objeto, token);
      contaId = c.id;
      break;
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <Voltar href={voltar}>Voltar para {cliente.nome}</Voltar>
        <h1 className="text-xl font-semibold">Editar {NIVEIS[nivel]}</h1>
        {edicao && (
          <p className="text-sm text-texto-2">
            {edicao.nivel === "conjunto" ? <>Da campanha “{edicao.campanha}”. </> : edicao.nivel === "anuncio" ? <>Do conjunto “{edicao.conjunto}”. </> : null}
            Lido agora no Meta; ao salvar, muda direto lá.{" "}
            <a href={linkGerenciador(contaId!, nivel, objeto)} target="_blank" rel="noreferrer" className="text-destaque underline">Abrir no Gerenciador ↗</a>
            {edicao.nivel === "anuncio" && <>{" · "}<AnalisarCriativo adId={objeto} clienteId={id} nome={edicao.nome} formato={edicao.criativo.midia.tipo === "video" ? "video" : "imagem"} /></>}
          </p>
        )}
      </div>
      {!edicao ? <Aviso>Não consegui abrir este item no Meta{erro ? `: ${erro}` : " (não é de uma conta deste cliente)"}.</Aviso>
        : <EditarMeta inicial={edicao} contaId={contaId!} voltar={voltar} />}
    </div>
  );
}
