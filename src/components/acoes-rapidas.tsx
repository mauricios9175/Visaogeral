"use client";

import { useFormStatus } from "react-dom";
import { acaoGoogle, acaoMeta } from "@/app/acoes-anuncios";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export type PropsAcoes = {
  plataforma: "meta" | "google";
  contaId: string;
  objetoId: string;
  nivel: "campanha" | "conjunto" | "anuncio";
  nome: string;
  /** true = ativo, false = pausado, null = não dá para alternar (ex.: reprovado, pausado no nível de cima) */
  ativo: boolean | null;
  /** orçamento conhecido (em reais), ou null; `mostrarOrcamento` liga os botões mesmo sem o valor (ex.: orçamento na campanha) */
  orcamento: { valor: number; tipo: "dia" | "total" } | null;
  mostrarOrcamento: boolean;
  voltar: string;
  compacto?: boolean;
};

function Botao({ children, className, titulo }: { children: React.ReactNode; className: string; titulo?: string }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} title={titulo} className={`${className} disabled:cursor-wait disabled:opacity-60`}>
      {pending ? "…" : children}
    </button>
  );
}

/** Pausar/ativar e ajustar orçamento (−20%, +20% ou valor), sempre com confirmação. */
export function AcoesRapidas(p: PropsAcoes) {
  const acao = p.plataforma === "meta" ? acaoMeta : acaoGoogle;
  const onde = p.plataforma === "meta" ? "no Meta" : "no Google";
  const ocultos = (
    <>
      <input type="hidden" name="conta_id" value={p.contaId} />
      <input type="hidden" name="objeto_id" value={p.objetoId} />
      <input type="hidden" name="nivel" value={p.nivel} />
      <input type="hidden" name="nome" value={p.nome} />
      <input type="hidden" name="voltar" value={p.voltar} />
    </>
  );
  const confirmar = (msg: string) => (e: React.FormEvent<HTMLFormElement>) => {
    if (!confirm(msg)) e.preventDefault();
  };
  const btn = "rounded-md border border-borda bg-superficie px-2 py-0.5 text-xs hover:border-destaque";
  const sufixo = p.orcamento?.tipo === "total" ? " (total)" : "/dia";
  const mudanca = (fator: number) =>
    p.orcamento
      ? `${brl.format(p.orcamento.valor)} → ${brl.format(Math.round(p.orcamento.valor * fator * 100) / 100)}${sufixo}`
      : `${fator > 1 ? "+" : "−"}${Math.round(Math.abs(fator - 1) * 100)}% no orçamento atual`;

  return (
    <div className={`flex flex-wrap items-center gap-1 ${p.compacto ? "" : "justify-end"}`}>
      {p.ativo != null && (
        <form action={acao} onSubmit={confirmar(`${p.ativo ? "Pausar" : "Ativar"} ${onde}: “${p.nome}”?`)}>
          {ocultos}
          <input type="hidden" name="acao" value={p.ativo ? "pausar" : "ativar"} />
          <Botao className={`${btn} ${p.ativo ? "text-critico" : "text-bom"}`}>{p.ativo ? "❚❚ Pausar" : "▶ Ativar"}</Botao>
        </form>
      )}
      {p.mostrarOrcamento && (
        <>
          {[0.8, 1.2].map((fator) => (
            <form key={fator} action={acao} onSubmit={confirmar(`Mudar o orçamento ${onde} de “${p.nome}”?\n${mudanca(fator)}`)}>
              {ocultos}
              <input type="hidden" name="acao" value="orcamento" />
              <input type="hidden" name="fator" value={fator} />
              <Botao className={btn} titulo={mudanca(fator)}>{fator > 1 ? "+20%" : "−20%"}</Botao>
            </form>
          ))}
          <details className="relative">
            <summary className={`${btn} cursor-pointer list-none`}>R$…</summary>
            <form
              action={acao}
              onSubmit={(e) => {
                const v = new FormData(e.currentTarget).get("valor");
                if (!confirm(`Mudar o orçamento ${onde} de “${p.nome}” para R$ ${v}${sufixo}?`)) e.preventDefault();
              }}
              className="absolute right-0 z-10 mt-1 flex gap-1 rounded-lg border border-borda bg-superficie p-2 shadow-lg"
            >
              {ocultos}
              <input type="hidden" name="acao" value="orcamento" />
              <input
                name="valor" required inputMode="decimal" placeholder={p.orcamento ? String(p.orcamento.valor).replace(".", ",") : "novo valor"}
                className="w-24 rounded-md border border-borda bg-fundo px-2 py-1 text-xs"
              />
              <Botao className={btn}>OK</Botao>
            </form>
          </details>
        </>
      )}
    </div>
  );
}
