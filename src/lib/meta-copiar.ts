import "server-only";
import { db, type ContaAnuncio } from "./db";
import { getMeta, montarUrl, postMeta } from "./meta";
import { fonteDoVideo } from "./meta-montar";
import { tokenDaConta } from "./sync";

// Copiar para outra conta do Meta (de outro cliente ou outra conta do mesmo cliente):
// imagem e vídeo pertencem à conta de origem, então são levados para a conta de destino na hora de publicar.

export type CriativoParaCopiar = { nome: string; conta?: string; hash?: string; videoId?: string; deOutraConta?: boolean };

/** Token de qualquer conta de anúncio cadastrada no painel (de qualquer cliente). */
export async function tokenDeQualquerConta(contaId: string) {
  const { data } = await db().from("contas_anuncio").select("*").eq("id", contaId).maybeSingle();
  if (!data) throw new Error(`A conta de origem (${contaId}) não está no painel.`);
  const token = await tokenDaConta(data as ContaAnuncio);
  if (!token) throw new Error("Sem acesso à conta de origem (reconecte o Facebook em Configurações).");
  return token;
}

/**
 * Leva a mídia do criativo da conta de origem para a de destino. Imagem: baixa e envia de novo (hash novo).
 * Vídeo: o Meta baixa do link do vídeo original (id novo; a montagem espera ficar pronto).
 */
export async function copiarMidia<T extends CriativoParaCopiar>(cr: T, contaDestino: string, tokenDestino: string): Promise<T> {
  if (!cr.conta || cr.conta === contaDestino || (!cr.hash && !cr.videoId)) return cr;
  const tokenOrigem = await tokenDeQualquerConta(cr.conta);
  if (cr.videoId) {
    const { fonte } = await fonteDoVideo(cr.videoId, tokenOrigem);
    if (!fonte) throw new Error(`O Meta não liberou o arquivo do vídeo “${cr.nome}” para copiar. Baixe e envie o vídeo de novo.`);
    const r = await postMeta(`${contaDestino}/advideos`, tokenDestino, { file_url: fonte, name: cr.nome });
    return { ...cr, videoId: String(r.id), hash: undefined, conta: contaDestino, deOutraConta: false };
  }
  const img = await getMeta<{ data: { hash: string; url?: string; permalink_url?: string }[] }>(
    montarUrl(`${cr.conta}/adimages`, tokenOrigem, { hashes: JSON.stringify([cr.hash]), fields: "hash,url,permalink_url" }),
  );
  const url = img.data[0]?.url ?? img.data[0]?.permalink_url;
  if (!url) throw new Error(`Não achei a imagem de “${cr.nome}” na conta de origem.`);
  const arq = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!arq.ok) throw new Error(`Não consegui baixar a imagem de “${cr.nome}” (${arq.status}).`);
  const bytes = Buffer.from(await arq.arrayBuffer()).toString("base64");
  const r = await postMeta(`${contaDestino}/adimages`, tokenDestino, { bytes });
  const nova = Object.values((r.images ?? {}) as Record<string, { hash: string }>)[0];
  if (!nova?.hash) throw new Error(`O Meta não aceitou a imagem de “${cr.nome}” na conta de destino.`);
  return { ...cr, hash: nova.hash, videoId: undefined, conta: contaDestino, deOutraConta: false };
}

/** Descobre de qual conta (cadastrada no painel) é o item do Meta. */
export async function contaDoItem(itemId: string, contaSugerida?: string | null) {
  const { data } = await db().from("contas_anuncio").select("*");
  const contas = (data ?? []) as ContaAnuncio[];
  // primeiro a conta indicada; depois as outras
  const ordem = [...contas.filter((c) => c.id === contaSugerida), ...contas.filter((c) => c.id !== contaSugerida)];
  for (const c of ordem) {
    const token = await tokenDaConta(c);
    if (!token) continue;
    try {
      const { account_id } = await getMeta<{ account_id: string }>(montarUrl(itemId, token, { fields: "account_id" }));
      if (`act_${account_id}` === c.id) return { conta: c.id, token };
    } catch { /* tenta a próxima */ }
  }
  throw new Error("Não achei esse item em nenhuma conta do painel.");
}
