import "server-only";
import { db } from "./db";
import { tokenDeAcesso } from "./google";

/**
 * Acesso à Google Ads API para uma conta (o login que a importou). Sem conta: o primeiro login do Google salvo
 * (serve para buscas que não dependem da conta, como a de locais).
 */
export async function acessoGoogle(contaId?: string | null) {
  const banco = db();
  const { data: conta } = contaId
    ? await banco.from("contas_google").select("id, nome, cliente_id, login_customer_id, token_id").eq("id", contaId).maybeSingle()
    : { data: null };
  const { data: t } = conta?.token_id
    ? await banco.from("tokens_google").select("refresh_token").eq("id", conta.token_id).maybeSingle()
    : await banco.from("tokens_google").select("refresh_token").limit(1).maybeSingle();
  if (!t?.refresh_token) throw new Error("Sem login do Google (conecte em Configurações → Google Ads).");
  return {
    acesso: await tokenDeAcesso(t.refresh_token as string),
    conta: conta as { id: string; nome: string; cliente_id: string | null; login_customer_id: string | null } | null,
  };
}
