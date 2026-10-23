import "server-only";
import { db } from "./db";

// Criativos ficam um tempo no Storage do Supabase entre o envio do computador e a subida no Meta.
// O navegador manda o arquivo direto para o Supabase (URL assinada), sem passar pela Vercel (que limita o tamanho).
const BUCKET = "criativos";
let bucketOk = false;

async function garantirBucket() {
  if (bucketOk) return;
  const s = db().storage;
  const { data } = await s.getBucket(BUCKET);
  if (!data) {
    const { error } = await s.createBucket(BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw new Error(`Storage do Supabase: ${error.message}`);
  }
  bucketOk = true;
}

const nomeSeguro = (nome: string) =>
  nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "-").slice(-80) || "arquivo";

/** Caminho novo dentro do bucket para um arquivo da montagem. */
export function novoCaminho(lote: string, nome: string) {
  return `montagens/${lote}/${crypto.randomUUID().slice(0, 8)}-${nomeSeguro(nome)}`;
}

/** URL para o navegador enviar o arquivo direto ao Supabase (vale 2 horas). */
export async function urlDeEnvio(caminho: string) {
  await garantirBucket();
  const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(caminho);
  if (error || !data) throw new Error(`Não foi possível preparar o envio: ${error?.message}`);
  return data.signedUrl;
}

export async function baixar(caminho: string) {
  const { data, error } = await db().storage.from(BUCKET).download(caminho);
  if (error || !data) throw new Error(`Arquivo não encontrado no Storage: ${caminho}`);
  return data;
}

/** Link temporário (para o Meta baixar vídeos direto daqui). */
export async function linkTemporario(caminho: string, segundos = 3600) {
  const { data, error } = await db().storage.from(BUCKET).createSignedUrl(caminho, segundos);
  if (error || !data) throw new Error(`Link do arquivo: ${error?.message}`);
  return data.signedUrl;
}

export async function apagar(caminhos: string[]) {
  if (caminhos.length) await db().storage.from(BUCKET).remove(caminhos).then(() => null, () => null);
}
