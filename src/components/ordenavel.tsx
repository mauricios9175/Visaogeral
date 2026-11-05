"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Deixa qualquer tabela ordenável pelo cabeçalho (clique: maior → menor; de novo: menor → maior; de novo: ordem
 * original) e, nas tabelas compridas, com uma busca. Funciona com as tabelas já prontas do servidor: só reordena
 * e esconde as linhas no navegador.
 *
 * - O valor da célula é o primeiro número do texto (R$ 1.234,56 · 12,5% · 3,2x) ou o texto; vazio ("—") vai pro fim.
 * - Uma célula pode dizer o valor certo com data-valor (ex.: data-valor="2026-10" num mês).
 * - Cabeçalho com data-sem-ordem não ordena (ex.: "Ações"). Linhas de total ficam no tfoot.
 */
export function Ordenavel({ children, busca, minimoBusca = 12 }: {
  children: React.ReactNode;
  /** força mostrar (true) ou esconder (false) a busca; padrão: só com mais de `minimoBusca` linhas */
  busca?: boolean;
  minimoBusca?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const estado = useRef<{ col: number; desc: boolean } | null>(null);
  const [q, setQ] = useState("");
  const [linhas, setLinhas] = useState({ total: 0, visiveis: 0 });

  useEffect(() => {
    const raiz = ref.current;
    const tabela = raiz?.querySelector("table");
    const corpo = tabela?.tBodies[0];
    const cabecalho = tabela?.tHead?.rows[tabela.tHead.rows.length - 1];
    if (!tabela || !corpo || !cabecalho) return;

    // posição lógica de cada coluna (respeita colSpan)
    const indiceDe = (th: HTMLTableCellElement) => {
      let i = 0;
      for (const c of Array.from(cabecalho.cells)) { if (c === th) return i; i += c.colSpan || 1; }
      return i;
    };
    const celula = (tr: HTMLTableRowElement, col: number) => {
      let i = 0;
      for (const c of Array.from(tr.cells)) { if (col < i + (c.colSpan || 1)) return c; i += c.colSpan || 1; }
      return null;
    };
    const valor = (tr: HTMLTableRowElement, col: number): number | string | null => {
      const c = celula(tr, col);
      if (!c) return null;
      const bruto = c.dataset.valor ?? (c.textContent ?? "").trim();
      if (!bruto || /^[—–-]$/.test(bruto)) return null;
      if (c.dataset.valor && !/^-?[\d.,]+$/.test(c.dataset.valor)) return c.dataset.valor.toLowerCase();
      const m = bruto.match(/-?\d[\d.]*(?:,\d+)?/);
      // texto com número só no meio (ex.: "Grupo 2") ordena como texto
      if (!m || (m.index ?? 0) > 4) return bruto.toLowerCase();
      const n = Number(m[0].replace(/\./g, "").replace(",", "."));
      return Number.isFinite(n) ? n : bruto.toLowerCase();
    };

    corpo.querySelectorAll("tr").forEach((tr, i) => { if (!tr.dataset.ordemOriginal) tr.dataset.ordemOriginal = String(i); });

    let observador: MutationObserver | null = null;
    const aplicar = () => {
      const e = estado.current;
      const rows = Array.from(corpo.rows);
      rows.forEach((tr, i) => { if (!tr.dataset.ordemOriginal) tr.dataset.ordemOriginal = String(1000 + i); });
      const ordenadas = [...rows].sort((a, b) => {
        if (!e) return Number(a.dataset.ordemOriginal) - Number(b.dataset.ordemOriginal);
        const va = valor(a, e.col), vb = valor(b, e.col);
        if (va == null || vb == null) return va == null ? (vb == null ? 0 : 1) : -1;
        const r = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
        return e.desc ? -r : r;
      });
      ordenadas.forEach((tr) => corpo.appendChild(tr));
      // descarta os avisos das nossas próprias trocas (senão o observador reordenaria sem parar)
      observador?.takeRecords();
      for (const th of Array.from(cabecalho.cells)) {
        if (th.dataset.semOrdem !== undefined) continue;
        const ativo = e && indiceDe(th) === e.col;
        th.setAttribute("aria-sort", ativo ? (e!.desc ? "descending" : "ascending") : "none");
        const seta = th.querySelector<HTMLSpanElement>("[data-seta]");
        if (seta) seta.textContent = ativo ? (e!.desc ? " ↓" : " ↑") : "";
      }
    };

    const cliques: [HTMLTableCellElement, () => void][] = [];
    for (const th of Array.from(cabecalho.cells)) {
      if (th.dataset.semOrdem !== undefined || !(th.textContent ?? "").trim()) continue;
      th.style.cursor = "pointer";
      th.title = "Clique para ordenar";
      th.classList.add("select-none", "hover:text-texto");
      if (!th.querySelector("[data-seta]")) {
        const s = document.createElement("span");
        s.dataset.seta = "";
        s.className = "text-destaque";
        th.appendChild(s);
      }
      const col = indiceDe(th);
      const clique = () => {
        const e = estado.current;
        // 1º clique: maior → menor (texto: A → Z); 2º: inverte; 3º: volta à ordem original
        const primeiroDesc = typeof valor(corpo.rows[0], col) !== "string";
        estado.current = !e || e.col !== col ? { col, desc: primeiroDesc } : e.desc === primeiroDesc ? { col, desc: !e.desc } : null;
        aplicar();
      };
      th.addEventListener("click", clique);
      cliques.push([th, clique]);
    }

    // o servidor trocou as linhas (ex.: depois de uma ação): reaplica a ordem escolhida
    observador = new MutationObserver(() => {
      if (estado.current) aplicar();
      setLinhas((x) => ({ ...x, total: corpo.rows.length }));
    });
    observador.observe(corpo, { childList: true });
    setLinhas({ total: corpo.rows.length, visiveis: corpo.rows.length });
    return () => {
      observador?.disconnect();
      cliques.forEach(([th, f]) => th.removeEventListener("click", f));
    };
  }, []);

  // busca: esconde as linhas que não têm o texto
  useEffect(() => {
    const corpo = ref.current?.querySelector("table")?.tBodies[0];
    if (!corpo) return;
    const termo = q.trim().toLowerCase();
    let n = 0;
    for (const tr of Array.from(corpo.rows)) {
      const ok = !termo || (tr.textContent ?? "").toLowerCase().includes(termo);
      tr.style.display = ok ? "" : "none";
      if (ok) n++;
    }
    setLinhas((x) => ({ ...x, visiveis: n }));
  }, [q]);

  const mostrarBusca = busca ?? linhas.total > minimoBusca;
  return (
    <div ref={ref}>
      {mostrarBusca && (
        <div className="sticky left-0 flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-texto-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar na tabela…" aria-label="Buscar na tabela"
            className="min-h-8 w-full rounded-lg border border-borda bg-fundo px-2.5 text-sm text-texto sm:w-60" />
          {q && <span>{linhas.visiveis} de {linhas.total}</span>}
        </div>
      )}
      {children}
    </div>
  );
}
