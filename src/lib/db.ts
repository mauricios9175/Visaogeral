import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Cliente Supabase com a chave service_role. Só usar no servidor. */
export function db(): SupabaseClient {
  if (!client) {
    // Aceita tanto https://x.supabase.co quanto a URL da Data API (…/rest/v1/)
    const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) {
      throw new Error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env");
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

export type Cliente = {
  id: string;
  nome: string;
  nicho: string | null;
  cpl_meta: number | null;
  orcamento_mensal: number | null;
  roas_meta: number | null;
  ativo: boolean;
};

export type ContaAnuncio = {
  id: string;
  cliente_id: string | null;
  nome: string;
  moeda: string | null;
  fuso: string | null;
  status: number | null;
  bm_nome: string | null;
  origem: "bm" | "usuario";
  token_id: string | null;
  ativa_sync: boolean;
  ultima_sync: string | null;
  ultimo_erro: string | null;
};

export type TokenMeta = {
  id: string;
  fb_user_id: string;
  nome: string | null;
  token: string;
  expira_em: string | null;
};

export type Metricas = {
  gasto: number;
  impressoes: number;
  alcance: number;
  cliques: number;
  cliques_link: number;
  leads: number;
  conversas: number;
  compras: number;
  valor_compras: number;
};
