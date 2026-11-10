"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Divide o período em pedaços de até 30 dias (o Meta e o tempo do servidor aguentam bem). */
function pedacos(desde: string, ate: string) {
  const dia = 86_400_000;
  const fim = Date.parse(ate);
  const lista: { desde: string; ate: string }[] = [];
  for (let t = Date.parse(desde); t <= fim; t += 30 * dia) {
    lista.push({ desde: new Date(t).toISOString().slice(0, 10), ate: new Date(Math.min(t + 29 * dia, fim)).toISOString().slice(0, 10) });
  }
  return lista;
}

const dataBR = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Puxa do Meta todos os dias do período escolhido, conta por conta e mês a mês.
 * A sincronização automática só refaz os últimos 7–30 dias; dias mais antigos que nunca foram puxados
 * (antes do painel existir ou de a conta ser vinculada) ficam faltando, e o investido sai baixo.
 */
export function PuxarHistoricoMeta({ contas, desde, ate, primeiroDia }: {
  contas: { id: string; nome: string }[]; desde: string; ate: string; primeiroDia: string | null;
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);
  const [erros, setErros] = useState<string[]>([]);
  if (!contas.length) return null;
  const faltando = !primeiroDia || primeiroDia > desde;

  async function puxar() {
    setRodando(true);
    setErros([]);
    const partes = pedacos(desde, ate);
    const tarefas = contas.flatMap((c) => partes.map((p) => ({ conta: c, ...p })));
    const falhas: string[] = [];
    let feitas = 0;
    const fila = [...tarefas];
    const trabalhador = async () => {
      for (let t = fila.shift(); t; t = fila.shift()) {
        setEstado(`Puxando ${feitas + 1} de ${tarefas.length}: ${t.conta.nome}, ${dataBR(t.desde)} a ${dataBR(t.ate)}…`);
        let erro = "";
        for (let tentativa = 1; tentativa <= 2; tentativa++) {
          try {
            const r = await fetch("/api/sync", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ etapa: "conta", id: t.conta.id, desde: t.desde, ate: t.ate }),
            });
            const j = await r.json().catch(() => ({ erro: `erro ${r.status}` }));
            if (!r.ok || j.erro) throw new Error(j.erro ?? `erro ${r.status}`);
            erro = "";
            break;
          } catch (e) {
            erro = e instanceof Error ? e.message : String(e);
          }
        }
        if (erro) falhas.push(`${t.conta.nome} (${dataBR(t.desde)} a ${dataBR(t.ate)}): ${erro}`);
        feitas++;
      }
    };
    await Promise.all([trabalhador(), trabalhador()]);
    // contas que deram certo em todos os pedaços: marca o histórico como puxado desde o início do período
    const ok = contas.filter((c) => !falhas.some((f) => f.startsWith(`${c.nome} (`))).map((c) => c.id);
    if (ok.length) {
      await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ etapa: "historico_feito", contas: ok, desde }) }).catch(() => {});
    }
    setErros(falhas);
    setEstado(falhas.length ? `Concluído com ${falhas.length} erro(s).` : "Pronto! Os números do período foram puxados de novo do Meta.");
    setRodando(false);
    router.refresh();
  }

  return (
    <div className={`space-y-2 rounded-xl border p-3 text-sm ${faltando ? "border-atencao/50 bg-atencao-bg/40" : "border-borda"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-texto-2">
          {faltando
            ? <>▲ O painel só tem dados do Meta {primeiroDia ? <>a partir de <b>{dataBR(primeiroDia)}</b></> : "de nenhum dia"} neste período (começa em {dataBR(desde)}). O investido e os resultados estão incompletos.</>
            : <>Os números não batem com o Gerenciador? Puxe de novo do Meta todos os dias deste período.</>}
        </p>
        <button type="button" onClick={puxar} disabled={rodando}
          className="rounded-lg bg-destaque px-3 py-1.5 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60">
          {rodando ? "Puxando…" : `Puxar do Meta ${dataBR(desde)} a ${dataBR(ate)}`}
        </button>
      </div>
      {estado && <p className="text-xs text-texto-3">{estado}</p>}
      {erros.length > 0 && <ul className="space-y-0.5 text-xs text-critico">{erros.map((e, i) => <li key={i}>■ {e}</li>)}</ul>}
    </div>
  );
}
