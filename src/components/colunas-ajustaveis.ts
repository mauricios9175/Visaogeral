"use client";

/**
 * Colunas com largura ajustável, como no Excel: arraste a borda direita do cabeçalho; duplo clique volta ao automático.
 * A largura fica guardada no navegador por tabela (pelos títulos das colunas), então vale para todos os clientes.
 * Funciona com a tabela já pronta: só mexe no estilo das células. Devolve a função que desliga tudo.
 */
export function ajustarColunas(tabela: HTMLTableElement): () => void {
  const cabecalho = tabela.tHead?.rows[tabela.tHead.rows.length - 1];
  if (!cabecalho) return () => {};
  const ths = Array.from(cabecalho.cells);
  const titulo = (th: HTMLTableCellElement) =>
    Array.from(th.childNodes).filter((n) => !(n instanceof HTMLElement && (n.dataset.seta !== undefined || n.dataset.alca !== undefined)))
      .map((n) => n.textContent ?? "").join("").trim();
  const chave = `colunas:${ths.map(titulo).join("|")}`;
  let larguras: Record<string, number> = {};
  try { larguras = JSON.parse(localStorage.getItem(chave) ?? "{}") ?? {}; } catch { larguras = {}; }
  const guardar = () => {
    try {
      if (Object.keys(larguras).length) localStorage.setItem(chave, JSON.stringify(larguras));
      else localStorage.removeItem(chave);
    } catch { /* navegador sem armazenamento: só não lembra */ }
  };

  const posicao = (th: HTMLTableCellElement) => {
    let i = 0;
    for (const c of ths) { if (c === th) return i; i += c.colSpan || 1; }
    return i;
  };
  const celula = (tr: HTMLTableRowElement, col: number) => {
    let i = 0;
    for (const c of Array.from(tr.cells)) { if (col < i + (c.colSpan || 1)) return i === col && (c.colSpan || 1) === 1 ? c : null; i += c.colSpan || 1; }
    return null;
  };
  const pintar = (col: number, px: number | null) => {
    for (const tr of Array.from(tabela.rows)) {
      const c = celula(tr, col);
      if (!c) continue;
      const v = px == null ? "" : `${px}px`;
      c.style.width = v;
      c.style.minWidth = v;
      c.style.maxWidth = v;
      c.style.overflow = px == null ? "" : "hidden";
      c.style.textOverflow = px == null ? "" : "ellipsis";
    }
  };
  // com alguma largura escolhida, a tabela cresce (rolando para o lado) em vez de espremer as outras colunas
  const larguraOriginal = { width: tabela.style.width, minWidth: tabela.style.minWidth };
  const ajustarTabela = () => {
    const algum = Object.keys(larguras).length > 0;
    tabela.style.width = algum ? "auto" : larguraOriginal.width;
    tabela.style.minWidth = algum ? "100%" : larguraOriginal.minWidth;
    // sem quebrar linha (globals.css): as outras colunas mantêm o tamanho do conteúdo
    if (algum) tabela.dataset.colunas = ""; else delete tabela.dataset.colunas;
  };
  const pintarTudo = () => { for (const [col, px] of Object.entries(larguras)) pintar(Number(col), px); ajustarTabela(); };

  const limpar: (() => void)[] = [];
  for (const th of ths) {
    if (th.querySelector("[data-alca]")) continue;
    const col = posicao(th);
    if (getComputedStyle(th).position === "static") th.style.position = "relative";
    const alca = document.createElement("span");
    alca.dataset.alca = "";
    alca.title = "Arraste para mudar a largura · duplo clique volta ao automático";
    alca.className = "hover:bg-destaque/50";
    Object.assign(alca.style, { position: "absolute", right: "0", top: "0", height: "100%", width: "6px", cursor: "col-resize", touchAction: "none", userSelect: "none", zIndex: "10" });
    th.appendChild(alca);

    let inicioX = 0, inicioLargura = 0;
    const mover = (e: PointerEvent) => {
      const px = Math.max(40, Math.round(inicioLargura + e.clientX - inicioX));
      larguras[col] = px;
      pintar(col, px);
      ajustarTabela();
    };
    const soltar = () => {
      document.removeEventListener("pointermove", mover);
      document.removeEventListener("pointerup", soltar);
      document.body.style.cursor = "";
      guardar();
    };
    const apertar = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      inicioX = e.clientX;
      inicioLargura = th.getBoundingClientRect().width;
      document.body.style.cursor = "col-resize";
      document.addEventListener("pointermove", mover);
      document.addEventListener("pointerup", soltar);
    };
    const parar = (e: Event) => e.stopPropagation(); // o clique na alça não ordena a coluna
    const automatico = (e: Event) => {
      e.stopPropagation();
      delete larguras[col];
      pintar(col, null);
      ajustarTabela();
      guardar();
    };
    alca.addEventListener("pointerdown", apertar);
    alca.addEventListener("click", parar);
    alca.addEventListener("dblclick", automatico);
    limpar.push(() => { alca.removeEventListener("pointerdown", apertar); alca.removeEventListener("click", parar); alca.removeEventListener("dblclick", automatico); soltar(); });
  }

  pintarTudo();
  // linhas novas (outra página, outro filtro, atualização do servidor): aplica as larguras guardadas
  const observador = new MutationObserver(() => { pintarTudo(); observador.takeRecords(); });
  observador.observe(tabela, { childList: true, subtree: true });
  return () => { observador.disconnect(); limpar.forEach((f) => f()); };
}
