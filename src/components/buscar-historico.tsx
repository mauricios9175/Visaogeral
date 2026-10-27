"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const campo = "rounded-lg border border-borda bg-fundo px-2 py-1.5 text-sm outline-none focus:border-destaque";
const NOMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const nome = (m: string) => `${NOMES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;

async function etapa(corpo: Record<string, unknown>) {
  const res = await fetch("/api/historico", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const json = await res.json().catch(() => ({ erro: res.status === 504 ? "demorou demais (tempo esgotado)" : `erro ${res.status}` }));
  if (!res.ok || json.erro) throw new Error(json.erro ?? `erro ${res.status}`);
  return json;
}

/**
 * "Buscar o passado": escolhe de qual a qual mês, pode pular os meses já gravados.
 * Lê o CRM em partes e grava um mês por chamada, com o andamento na tela.
 * `opcoes`: meses disponíveis (do mais recente para o mais antigo); `gravados`: meses que já têm dados.
 */
export function BuscarHistorico({ clienteId, opcoes, gravados }: { clienteId: string; opcoes: string[]; gravados: string[] }) {
  const [de, setDe] = useState(opcoes[Math.min(11, opcoes.length - 1)]);
  const [ate, setAte] = useState(opcoes[0]);
  const [pular, setPular] = useState(gravados.length > 0);
  const [lerCrm, setLerCrm] = useState(true);
  const [andamento, setAndamento] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const router = useRouter();
  const rodando = andamento !== null;

  const [ini, fim] = de <= ate ? [de, ate] : [ate, de];
  const escolhidos = opcoes.filter((m) => m >= ini && m <= fim).reverse();
  const aGravar = pular ? escolhidos.filter((m) => !gravados.includes(m)) : escolhidos;

  async function buscar() {
    setResultado(null);
    const avisos: string[] = [];
    const falharam: string[] = [];
    let feitos = 0;
    try {
      if (lerCrm && aGravar.length) {
        // em partes: CRMs grandes têm dezenas de milhares de oportunidades.
        // Se o CRM falhar, os meses ainda saem com Meta e Google (o funil usa o que já estiver no banco).
        setAndamento("Trazendo os negócios do CRM…");
        let cursor: unknown = null, negocios = 0;
        try {
          for (let parte = 1; parte <= 100; parte++) {
            const r = await etapa({ etapa: "crm", clienteId, desde: aGravar[0], cursor });
            negocios += r.linhas;
            cursor = r.cursor;
            if (!cursor) break;
            setAndamento(`Trazendo os negócios do CRM (parte ${parte + 1}, ${negocios.toLocaleString("pt-BR")} até agora)…`);
          }
        } catch (e) {
          avisos.push(`CRM: ${e instanceof Error ? e.message : e}`);
        }
      }
      for (const [i, mes] of aGravar.entries()) {
        setAndamento(`Gravando ${nome(mes)} (${i + 1} de ${aGravar.length})…`);
        try {
          const r = await etapa({ etapa: "mes", clienteId, mes });
          feitos += r.meses;
          avisos.push(...r.erros);
        } catch (e) {
          falharam.push(nome(mes));
          avisos.push(`${nome(mes)}: ${e instanceof Error ? e.message : e}`);
        }
      }
      const texto = !aGravar.length
        ? "Todos os meses escolhidos já estavam gravados."
        : `Gravado(s) ${feitos} mês(es).` +
          (falharam.length ? ` Não deu em: ${falharam.join(", ")} (tente só esses de novo, sem ler o CRM).` : "") +
          (avisos.length ? ` Avisos: ${[...new Set(avisos)].join(" · ")}` : "");
      setResultado({ ok: !falharam.length, texto });
      router.refresh();
    } finally {
      setAndamento(null);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Buscar de
        <select value={de} onChange={(e) => setDe(e.target.value)} disabled={rodando} className={`${campo} capitalize`}>
          {opcoes.map((m) => <option key={m} value={m}>{nome(m)}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        até
        <select value={ate} onChange={(e) => setAte(e.target.value)} disabled={rodando} className={`${campo} capitalize`}>
          {opcoes.map((m) => <option key={m} value={m}>{nome(m)}</option>)}
        </select>
      </label>
      <div className="flex flex-col gap-1 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={pular} onChange={(e) => setPular(e.target.checked)} disabled={rodando} />
          Pular os meses já gravados
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={lerCrm} onChange={(e) => setLerCrm(e.target.checked)} disabled={rodando} />
          Ler o CRM antes <span className="text-xs text-texto-3">(desmarque se acabou de ler)</span>
        </label>
      </div>
      <button type="button" onClick={buscar} disabled={rodando || !aGravar.length}
        className="rounded-lg bg-destaque px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60">
        {rodando ? (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Buscando…
          </span>
        ) : `Buscar e gravar ${aGravar.length} mês(es)`}
      </button>
      {andamento && <span className="basis-full text-xs text-texto-3">{andamento} Não feche a página.</span>}
      {resultado && <p className={`basis-full text-sm ${resultado.ok ? "text-texto-2" : "text-critico"}`}>{resultado.texto}</p>}
    </div>
  );
}
