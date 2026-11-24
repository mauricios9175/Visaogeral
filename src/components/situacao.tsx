import type { Situacao } from "@/lib/consultas";

/**
 * Embaixo de um número de leads: quantos ainda estão abertos no CRM e quantos já foram perdidos.
 * Só aparece com o botão "Abertos e perdidos" da tabela ligado (classe so-situacao).
 * A célula precisa de data-valor com o número principal, para a ordenação não somar este texto.
 */
export function SituacaoLeads({ s }: { s: Situacao | null | undefined }) {
  if (!s) return null;
  return (
    <span className="so-situacao whitespace-nowrap text-[11px] font-normal text-texto-3" title="Situação hoje no CRM dos leads que entraram no período">
      <span className="text-destaque">{s.abertos.toLocaleString("pt-BR")} abertos</span> · {s.perdidos.toLocaleString("pt-BR")} perdidos
    </span>
  );
}
