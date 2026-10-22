"use client";

import { useFormStatus } from "react-dom";
import { acaoGoogle, acaoMeta } from "@/app/acoes-anuncios";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Para onde dá para copiar: campanhas e conjuntos do cliente (só os da mesma conta aparecem). */
export type DestinosDuplicar = {
  campanhas: { id: string; nome: string; conta: string }[];
  conjuntos: { id: string; nome: string; conta: string; pai: string }[];
};

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
  /** Meta: liga o "Duplicar" (campanha atual do conjunto / conjunto atual do anúncio + destinos possíveis) */
  duplicar?: { destinos: DestinosDuplicar; campanhaAtual: string; conjuntoAtual: string | null };
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
          <details>
            <summary className={`${btn} cursor-pointer list-none`}>R$…</summary>
            <form
              action={acao}
              onSubmit={(e) => {
                const v = new FormData(e.currentTarget).get("valor");
                if (!confirm(`Mudar o orçamento ${onde} de “${p.nome}” para R$ ${v}${sufixo}?`)) e.preventDefault();
              }}
              className="mt-1 flex gap-1 rounded-lg border border-borda bg-fundo p-2"
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
      {p.duplicar && <Duplicar {...p} duplicar={p.duplicar} ocultos={ocultos} />}
    </div>
  );
}

/** Duplicar no Meta: anúncio → conjunto de destino; conjunto → campanha de destino (com ou sem anúncios); campanha inteira. */
function Duplicar(p: PropsAcoes & { duplicar: NonNullable<PropsAcoes["duplicar"]>; ocultos: React.ReactNode }) {
  const { destinos, campanhaAtual, conjuntoAtual } = p.duplicar;
  const campo = "w-full rounded-md border border-borda bg-fundo px-2 py-1 text-xs";
  const btn = "rounded-md border border-borda bg-superficie px-2 py-0.5 text-xs hover:border-destaque";
  const conjuntos = destinos.conjuntos.filter((c) => c.conta === p.contaId);
  const campanhas = destinos.campanhas.filter((c) => c.conta === p.contaId);
  return (
    <details>
      <summary className={`${btn} cursor-pointer list-none`} title="Duplicar (a cópia nasce pausada)">⧉ Duplicar</summary>
      <form
        action={acaoMeta}
        onSubmit={(e) => {
          if (!confirm(`Duplicar “${p.nome}”? A cópia vai ser criada PAUSADA no Meta.`)) e.preventDefault();
        }}
        className="mt-1 w-72 space-y-2 rounded-lg border border-borda bg-fundo p-3 text-left text-xs"
      >
        {p.ocultos}
        <input type="hidden" name="acao" value="duplicar" />
        <input type="hidden" name="campanha_atual" value={campanhaAtual} />
        <input type="hidden" name="conjunto_atual" value={conjuntoAtual ?? ""} />
        {p.nivel === "anuncio" && (
          <label className="block space-y-1">
            <span className="text-texto-3">Copiar para o conjunto</span>
            <select name="destino" defaultValue={conjuntoAtual ?? ""} className={campo}>
              {conjuntos.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.id === conjuntoAtual ? " (o mesmo)" : ` · ${c.pai}`}</option>)}
            </select>
          </label>
        )}
        {p.nivel === "conjunto" && (
          <>
            <label className="block space-y-1">
              <span className="text-texto-3">Copiar para a campanha</span>
              <select name="destino" defaultValue={campanhaAtual} className={campo}>
                {campanhas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.id === campanhaAtual ? " (a mesma)" : ""}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" name="com_anuncios" value="1" defaultChecked /> copiar junto os anúncios
            </label>
            {p.orcamento?.tipo === "dia" && (
              <label className="block space-y-1">
                <span className="text-texto-3">Orçamento diário da cópia (vazio = igual, {brl.format(p.orcamento.valor)})</span>
                <input name="valor" inputMode="decimal" placeholder="R$" className={campo} />
              </label>
            )}
          </>
        )}
        {p.nivel === "campanha" && <p className="text-texto-2">Copia a campanha inteira, com todos os conjuntos e anúncios.</p>}
        <p className="text-texto-3">A cópia nasce pausada, com “ - cópia” no nome. Você revisa e ativa no Gerenciador.</p>
        <Botao className={`${btn} w-full`}>Criar cópia pausada</Botao>
      </form>
    </details>
  );
}
