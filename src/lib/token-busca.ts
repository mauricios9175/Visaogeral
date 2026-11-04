import "server-only";
import { db, type ContaAnuncio } from "./db";
import { tokenDaConta } from "./sync";

/**
 * Token (e conta) para as buscas de segmentação: a conta informada; senão a primeira conta com token conectado.
 * A busca completa de segmentação detalhada é feita pela conta de anúncio.
 */
export async function tokenParaBusca(contaId: string | null): Promise<{ token?: string; conta: string | null }> {
  const banco = db();
  const { data } = contaId
    ? await banco.from("contas_anuncio").select("*").eq("id", contaId).limit(1)
    : await banco.from("contas_anuncio").select("*").not("cliente_id", "is", null).eq("status", 1).limit(5);
  for (const c of (data ?? []) as ContaAnuncio[]) {
    const t = await tokenDaConta(c);
    if (t) return { token: t, conta: c.id };
  }
  if (process.env.META_SYSTEM_USER_TOKEN) return { token: process.env.META_SYSTEM_USER_TOKEN, conta: null };
  const { data: t } = await banco.from("tokens_meta").select("token").limit(1).maybeSingle();
  return { token: t?.token as string | undefined, conta: null };
}

