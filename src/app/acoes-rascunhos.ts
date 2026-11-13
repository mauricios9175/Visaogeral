"use server";

import { revalidatePath } from "next/cache";
import { montarCampanhaMeta, type ResultadoMontagem } from "@/app/acoes-montagem";
import { excluirRascunho, lerRascunho } from "@/lib/rascunhos";

/**
 * Publica um rascunho no Meta (pausado) sem abrir a tela: as mesmas conferências da montagem.
 * Deu certo: o rascunho sai da lista. Não deu: fica, com o motivo.
 */
export async function publicarRascunho(clienteId: string, id: string): Promise<ResultadoMontagem> {
  const r = await lerRascunho(clienteId, id);
  if (!r) return { ok: false, mensagem: "Esse rascunho não existe mais.", detalhes: [], link: null };
  const c = r.config;
  const soAnuncios = !!r.destino?.conjunto;
  const falta =
    !r.pagina ? "falta escolher a página do Facebook" :
    r.objetivo === "formulario" && !r.formulario ? "falta escolher o formulário" :
    r.objetivo === "formulario" && r.formulario === "novo" && !r.formularioNovo ? "falta configurar o formulário novo" :
    r.objetivo === "site" && !c.url ? "falta o link do site" :
    !soAnuncios && !c.locais.length ? "falta escolher a localização" :
    soAnuncios && !r.criativos.length ? "falta escolher pelo menos um criativo" :
    r.criativos.length && !c.textos.some((t) => t.trim()) ? "falta o texto principal" : null;
  if (falta) return { ok: false, mensagem: `Não publicado: ${falta}. Abra em Editar.`, detalhes: [], link: null };

  const fd = new FormData();
  fd.set("payload", JSON.stringify({
    clienteId, conta: r.conta, modeloId: `zero:${r.objetivo}`, objetivo: r.objetivo, pagina: r.pagina, instagram: r.instagram,
    formulario: r.formulario, pixel: r.pixel, criativos: r.criativos.filter((x) => (!x.videoId && !x.hash) || x.conta === r.conta || x.deOutraConta),
    config: r.destino ? { ...c, orcamentoEm: r.destino.orcamentoNaCampanha ? "campanha" : "conjunto" } : c,
    destino: r.destino ? { campanha: r.destino.campanhaId, conjunto: r.destino.conjunto?.id } : null,
    ...(r.formulario === "novo" && { formularioNovo: r.formularioNovo }),
    salvarModeloComo: "", manterSemAnuncios: true,
  }));
  const res = await montarCampanhaMeta(null, fd);
  if (res.ok) await excluirRascunho(clienteId, id);
  revalidatePath(`/clientes/${clienteId}`);
  return res;
}
