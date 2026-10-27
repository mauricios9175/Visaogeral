"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const campo = "rounded-lg border border-borda bg-fundo px-2 py-1.5 text-sm outline-none focus:border-destaque";

async function etapa(corpo: Record<string, unknown>) {
  const res = await fetch("/api/historico", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const json = await res.json().catch(() => ({ erro: res.status === 504 ? "demorou demais (tempo esgotado)" : `erro ${res.status}` }));
  if (!res.ok || json.erro) throw new Error(json.erro ?? `erro ${res.status}`);
  return json;
}

/** "Buscar o passado" em etapas (CRM, depois os meses em blocos), com o andamento na tela. */
export function BuscarHistorico({ clienteId, temMeses }: { clienteId: string; temMeses: boolean }) {
  const [meses, setMeses] = useState(temMeses ? "3" : "12");
  const [andamento, setAndamento] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const router = useRouter();
  const rodando = andamento !== null;

  async function buscar() {
    setResultado(null);
    const avisos: string[] = [];
    try {
      setAndamento("Trazendo os negócios do CRM…");
      // em partes: CRMs grandes têm dezenas de milhares de oportunidades.
      // Se o CRM falhar, os meses ainda saem com Meta e Google (o funil usa o que já estiver no banco).
      let cursor: unknown = null, negocios = 0;
      try {
        for (let parte = 1; parte <= 100; parte++) {
          const r = await etapa({ etapa: "crm", clienteId, meses, cursor });
          negocios += r.linhas;
          cursor = r.cursor;
          if (!cursor) break;
          setAndamento(`Trazendo os negócios do CRM (parte ${parte + 1}, ${negocios.toLocaleString("pt-BR")} até agora)…`);
        }
      } catch (e) {
        avisos.push(`CRM: ${e instanceof Error ? e.message : e}`);
      }
      const { blocos } = await etapa({ etapa: "blocos", meses });
      let gravados = 0;
      for (const [i, b] of (blocos as { desde: string; ate: string }[]).entries()) {
        setAndamento(`Gravando os meses (${i + 1} de ${blocos.length})…`);
        try {
          const r = await etapa({ etapa: "meses", clienteId, desde: b.desde, ate: b.ate });
          gravados += r.meses;
          avisos.push(...r.erros);
        } catch (e) {
          avisos.push(`${b.desde.slice(0, 7)} a ${b.ate.slice(0, 7)}: ${e instanceof Error ? e.message : e}`);
        }
      }
      setResultado({ ok: gravados > 0, texto: `Histórico gravado: ${gravados} mês(es).${avisos.length ? ` Avisos: ${[...new Set(avisos)].join(" · ")}` : ""}` });
      router.refresh();
    } catch (e) {
      setResultado({ ok: false, texto: `Erro: ${e instanceof Error ? e.message : e}` });
    } finally {
      setAndamento(null);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm">
        Buscar o passado
        <select value={meses} onChange={(e) => setMeses(e.target.value)} disabled={rodando} className={campo}>
          <option value="3">últimos 3 meses</option>
          <option value="6">últimos 6 meses</option>
          <option value="12">últimos 12 meses</option>
          <option value="24">últimos 24 meses</option>
          <option value="37">tudo que o Meta guarda (37 meses)</option>
        </select>
      </label>
      <button type="button" onClick={buscar} disabled={rodando}
        className="rounded-lg bg-destaque px-3 py-1.5 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-70">
        {rodando ? (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Buscando…
          </span>
        ) : "Buscar e gravar"}
      </button>
      {andamento && <span className="text-xs text-texto-3">{andamento} Não feche a página.</span>}
      {resultado && <p className={`basis-full text-sm ${resultado.ok ? "text-texto-2" : "text-critico"}`}>{resultado.texto}</p>}
    </div>
  );
}
