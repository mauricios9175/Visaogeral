// Funil do relatório de cada cliente. Arquivo sem "server-only": também é usado no editor do funil (navegador).

/** Um passo do funil (ex.: Interessados) e as etapas do CRM que contam nele. */
export type PassoFunil = { nome: string; etapas: string[] };

export type FunilCliente = {
  soAnuncio: boolean; // conta só os leads das fontes de anúncio (o resto do CRM fica de fora do relatório)
  leads: string;      // nome do primeiro passo (todos os leads)
  vendas: string;     // nome do último passo (negócios ganhos)
  passos: PassoFunil[];
};

export const FUNIL_PADRAO: FunilCliente = { soAnuncio: true, leads: "Leads", vendas: "Vendas", passos: [] };

/** Números do funil num período: leads, cada passo do meio e vendas. */
export type NumerosFunil = {
  leads: number;
  passos: { nome: string; valor: number }[];
  vendas: number;
  faturamento: number;
};

export function normalizarFunil(f: Partial<FunilCliente> | null | undefined): FunilCliente {
  return {
    soAnuncio: f?.soAnuncio ?? true,
    leads: f?.leads?.trim() || "Leads",
    vendas: f?.vendas?.trim() || "Vendas",
    passos: (f?.passos ?? []).filter((p) => p.nome?.trim()).map((p) => ({ nome: p.nome.trim(), etapas: p.etapas ?? [] })),
  };
}
