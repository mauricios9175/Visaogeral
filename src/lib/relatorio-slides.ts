import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { tokenDeAcesso, tokenSoDrive } from "./google";
import { detalheCliente, detalheCrm, DIMENSOES_UTM, type DimensaoUtm, type LinhaTabela } from "./consultas";
import { detalheGoogle } from "./consultas-google";
import { funilDoCliente, lerHistorico, mesDe, nomeMes, somarMeses, type MesConsolidado } from "./historico";
import { dinheiro, inteiro, pct } from "./formato";
import { hojeISO, somarDias, type Periodo } from "./datas";

// Relatório do cliente no Google Slides: o painel copia o modelo da Propulsão (no Drive do usuário)
// e troca os marcadores {{...}} por números, tabelas e gráficos desenhados no próprio slide (editáveis).
// Só usa o escopo drive.file: o painel enxerga apenas o modelo e os relatórios que ele mesmo criou.

const DRIVE = "https://www.googleapis.com/drive/v3";
const SLIDES = "https://slides.googleapis.com/v1/presentations";
const ARQUIVO_MODELO = path.join(process.cwd(), "modelos", "relatorio-propulsao.pptx");

export type ConfigRelatorio = { modeloId: string; pastaId: string | null; tokenId: string; email: string };

// ---------- Google Drive / Slides ----------

async function api<T>(acesso: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${acesso}`, ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...init.headers },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg: string = json?.error?.message ?? res.statusText;
    if (/insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(msg) || (json?.error?.status === "PERMISSION_DENIED" && /scope/i.test(msg))) {
      throw new Error("O login do Google ainda não tem a permissão de criar apresentações. Em Configurações, clique em reconectar o Google (mesmo e-mail) e tente de novo.");
    }
    if (res.status === 404) throw new Error("Modelo não encontrado no Drive (foi apagado?). Crie o modelo de novo.");
    throw new Error(`Google: ${msg}`);
  }
  return json as T;
}

export async function configRelatorio(): Promise<ConfigRelatorio | null> {
  const { data } = await db().from("configuracoes").select("valor").eq("chave", "relatorio_slides").maybeSingle();
  return (data?.valor as ConfigRelatorio | undefined) ?? null;
}

async function acessoDoToken(tokenId: string) {
  const { data } = await db().from("tokens_google").select("id, email, refresh_token").eq("id", tokenId).maybeSingle();
  if (!data) throw new Error("Login do Google do relatório não encontrado. Reconecte o Google e crie o modelo de novo.");
  return { acesso: await tokenDeAcesso(data.refresh_token as string), email: data.email as string };
}

/** Sobe o modelo da Propulsão para o Drive (convertido em Google Slides), dentro de uma pasta só dos relatórios. */
export async function criarModeloNoDrive(tokenId: string) {
  const { acesso, email } = await acessoDoToken(tokenId);
  const pasta = await api<{ id: string }>(acesso, `${DRIVE}/files?fields=id`, {
    method: "POST",
    body: JSON.stringify({ name: "Relatórios · Visão Geral", mimeType: "application/vnd.google-apps.folder" }),
  });
  const pptx = await readFile(ARQUIVO_MODELO);
  const limite = `limite${Date.now()}`;
  const meta = JSON.stringify({ name: "Modelo de relatório · Propulsão", mimeType: "application/vnd.google-apps.presentation", parents: [pasta.id] });
  const corpo = Buffer.concat([
    Buffer.from(`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${limite}\r\nContent-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation\r\n\r\n`),
    pptx,
    Buffer.from(`\r\n--${limite}--`),
  ]);
  const arquivo = await api<{ id: string }>(acesso, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${limite}` },
    body: corpo,
  });
  const valor: ConfigRelatorio = { modeloId: arquivo.id, pastaId: pasta.id, tokenId, email };
  const { error } = await db().from("configuracoes").upsert({ chave: "relatorio_slides", valor, atualizado_em: new Date().toISOString() });
  if (error) throw new Error(`${error.message} (rode o SQL 0016 no Supabase)`);
  return valor;
}

/** Dados para o seletor de pastas do Google (Google Picker) no navegador. */
export async function dadosSeletorPasta() {
  const config = await configRelatorio();
  if (!config) throw new Error("Crie primeiro o modelo no Drive.");
  const chave = process.env.GOOGLE_API_KEY?.trim();
  if (!chave) throw new Error("Falta a variável GOOGLE_API_KEY na Vercel (chave de API do Google Cloud).");
  const { data } = await db().from("tokens_google").select("refresh_token").eq("id", config.tokenId).maybeSingle();
  if (!data) throw new Error("Login do Google do relatório não encontrado.");
  return {
    token: await tokenSoDrive(data.refresh_token as string),
    chave,
    // número do projeto do Google Cloud = começo do client ID; o Picker usa para liberar a pasta escolhida ao painel
    appId: (process.env.GOOGLE_CLIENT_ID ?? "").split("-")[0],
    email: config.email,
  };
}

export const linkApresentacao = (id: string) => `https://docs.google.com/presentation/d/${id}/edit`;

// ---------- Desenho no slide (tabelas, gráficos e textos) ----------

type Caixa = { x: number; y: number; w: number; h: number };
type Req = Record<string, unknown>;

const cor = (hex: string) => ({
  rgbColor: { red: parseInt(hex.slice(0, 2), 16) / 255, green: parseInt(hex.slice(2, 4), 16) / 255, blue: parseInt(hex.slice(4, 6), 16) / 255 },
});
const emu = (v: number) => ({ magnitude: Math.round(v), unit: "EMU" });
const propriedades = (pagina: string, c: Caixa) => ({
  pageObjectId: pagina,
  size: { width: emu(c.w), height: emu(c.h) },
  transform: { scaleX: 1, scaleY: 1, translateX: Math.round(c.x), translateY: Math.round(c.y), unit: "EMU" },
});

const ROXO = "6900AF";
const PALETA = ["6900AF", "B57BEE", "1FB5CC", "F2A900", "E0559B", "4C7BE0", "2FA36B"];
const FONTE = "Saira";

let seq = 0;
const novoId = (p: string) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

function retangulo(pagina: string, c: Caixa, fundo: string): Req[] {
  const id = novoId("r");
  return [
    { createShape: { objectId: id, shapeType: "RECTANGLE", elementProperties: propriedades(pagina, c) } },
    {
      updateShapeProperties: {
        objectId: id,
        shapeProperties: { shapeBackgroundFill: { solidFill: { color: cor(fundo) } }, outline: { propertyState: "NOT_RENDERED" } },
        fields: "shapeBackgroundFill.solidFill.color,outline.propertyState",
      },
    },
  ];
}

function texto(pagina: string, c: Caixa, conteudo: string, e: { tamanho: number; cor?: string; negrito?: boolean; alinhar?: "START" | "CENTER" | "END" }): Req[] {
  const id = novoId("t");
  return [
    { createShape: { objectId: id, shapeType: "TEXT_BOX", elementProperties: propriedades(pagina, c) } },
    { insertText: { objectId: id, text: conteudo } },
    {
      updateTextStyle: {
        objectId: id, textRange: { type: "ALL" },
        style: { fontFamily: FONTE, fontSize: { magnitude: e.tamanho, unit: "PT" }, bold: !!e.negrito, foregroundColor: { opaqueColor: cor(e.cor ?? "444444") } },
        fields: "fontFamily,fontSize,bold,foregroundColor",
      },
    },
    { updateParagraphStyle: { objectId: id, textRange: { type: "ALL" }, style: { alignment: e.alinhar ?? "CENTER" }, fields: "alignment" } },
    { updateShapeProperties: { objectId: id, shapeProperties: { contentAlignment: "MIDDLE" }, fields: "contentAlignment" } },
  ];
}

/** Tabela no estilo do Gerenciador: cabeçalho roxo, números à direita e linha de total opcional. */
function tabela(pagina: string, c: Caixa, cabecalho: string[], linhas: string[][], opcoes: { total?: string[]; larguraPrimeira?: number } = {}): Req[] {
  const id = novoId("tab");
  const todas = [cabecalho, ...linhas, ...(opcoes.total ? [opcoes.total] : [])];
  const colunas = cabecalho.length;
  const primeira = opcoes.larguraPrimeira ?? 0.28;
  const larguras = cabecalho.map((_, i) => (i === 0 ? c.w * primeira : (c.w * (1 - primeira)) / (colunas - 1)));
  const alturaLinha = 260_000;
  const reqs: Req[] = [{ createTable: { objectId: id, elementProperties: propriedades(pagina, { ...c, h: alturaLinha * todas.length }), rows: todas.length, columns: colunas } }];
  todas.forEach((linha, r) => linha.forEach((valor, col) => {
    const cell = { rowIndex: r, columnIndex: col };
    const ehCabecalho = r === 0;
    const ehTotal = !!opcoes.total && r === todas.length - 1;
    reqs.push(
      { insertText: { objectId: id, cellLocation: cell, text: valor || "—" } },
      {
        updateTextStyle: {
          objectId: id, cellLocation: cell, textRange: { type: "ALL" },
          style: {
            fontFamily: FONTE, fontSize: { magnitude: 8, unit: "PT" }, bold: ehCabecalho || ehTotal,
            foregroundColor: { opaqueColor: cor(ehCabecalho ? "FFFFFF" : "333333") },
          },
          fields: "fontFamily,fontSize,bold,foregroundColor",
        },
      },
    );
    if (col > 0) {
      reqs.push({ updateParagraphStyle: { objectId: id, cellLocation: cell, textRange: { type: "ALL" }, style: { alignment: "END" }, fields: "alignment" } });
    }
  }));
  const faixa = (linha: number, n: number) => ({ location: { rowIndex: linha, columnIndex: 0 }, rowSpan: n, columnSpan: colunas });
  const fundo = (linha: number, n: number, hex: string) => ({
    updateTableCellProperties: {
      objectId: id, tableRange: faixa(linha, n),
      tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: cor(hex) } }, contentAlignment: "MIDDLE" },
      fields: "tableCellBackgroundFill.solidFill.color,contentAlignment",
    },
  });
  reqs.push(fundo(0, 1, ROXO));
  if (linhas.length) reqs.push(fundo(1, linhas.length, "FFFFFF"));
  if (opcoes.total) reqs.push(fundo(todas.length - 1, 1, "F1E6FA"));
  reqs.push({
    updateTableBorderProperties: {
      objectId: id, tableRange: faixa(0, todas.length), borderPosition: "ALL",
      tableBorderProperties: { tableBorderFill: { solidFill: { color: cor("DDDDDD") } }, weight: { magnitude: 0.75, unit: "PT" } },
      fields: "tableBorderFill.solidFill.color,weight",
    },
  });
  larguras.forEach((w, i) => reqs.push({
    updateTableColumnProperties: { objectId: id, columnIndices: [i], tableColumnProperties: { columnWidth: emu(w) }, fields: "columnWidth" },
  }));
  reqs.push({
    updateTableRowProperties: {
      objectId: id, rowIndices: todas.map((_, i) => i), tableRowProperties: { minRowHeight: emu(alturaLinha) }, fields: "minRowHeight",
    },
  });
  return reqs;
}

type Serie = { nome: string; valores: (number | null)[] };

/** Gráfico de colunas desenhado com formas (o usuário pode mexer em tudo depois). */
function grafico(pagina: string, c: Caixa, titulo: string, categorias: string[], series: Serie[], formato: (v: number) => string): Req[] {
  const reqs: Req[] = [...retangulo(pagina, c, "FFFFFF")];
  reqs.push(...texto(pagina, { x: c.x, y: c.y + c.h * 0.03, w: c.w * 0.78, h: c.h * 0.1 }, titulo, { tamanho: 14, cor: "666666" }));
  const area = { x: c.x + c.w * 0.05, y: c.y + c.h * 0.2, w: c.w * 0.71, h: c.h * 0.6 };
  const base = area.y + area.h;
  const maximo = Math.max(1, ...series.flatMap((s) => s.valores.map((v) => v ?? 0))) * 1.12;
  const grupo = area.w / Math.max(categorias.length, 1);
  const barra = Math.min((grupo * 0.72) / series.length, 900_000);
  categorias.forEach((cat, i) => {
    const inicio = area.x + i * grupo + (grupo - barra * series.length) / 2;
    series.forEach((s, j) => {
      const v = s.valores[i];
      const x = inicio + j * barra;
      const alt = v ? (v / maximo) * area.h : 0;
      if (alt > 0) reqs.push(...retangulo(pagina, { x, y: base - alt, w: barra * 0.92, h: alt }, PALETA[j % PALETA.length]));
      const larguraRotulo = Math.max(barra, 640_000);
      reqs.push(...texto(pagina, { x: x + barra * 0.46 - larguraRotulo / 2, y: base - alt - 230_000, w: larguraRotulo, h: 220_000 },
        v == null ? "—" : formato(v), { tamanho: 8, negrito: true, cor: PALETA[j % PALETA.length] }));
    });
    reqs.push(...texto(pagina, { x: area.x + i * grupo, y: base + 40_000, w: grupo, h: 240_000 }, cat, { tamanho: 9, cor: "444444" }));
  });
  reqs.push(...retangulo(pagina, { x: area.x, y: base, w: area.w, h: 9_525 }, "999999"));
  // legenda à direita, como nos gráficos do Planilhas
  series.forEach((s, j) => {
    const y = c.y + c.h * 0.22 + j * 300_000;
    reqs.push(...retangulo(pagina, { x: c.x + c.w * 0.8, y: y + 50_000, w: 130_000, h: 130_000 }, PALETA[j % PALETA.length]));
    reqs.push(...texto(pagina, { x: c.x + c.w * 0.8 + 180_000, y, w: c.w * 0.18, h: 230_000 }, s.nome, { tamanho: 10, alinhar: "START" }));
  });
  return reqs;
}

/** Caixa arredondada com duas linhas (rótulo e valor), no estilo do slide de pipeline. */
function caixaFunil(pagina: string, c: Caixa, rotulo: string, valor: string, cheia: boolean): Req[] {
  const id = novoId("f");
  const corTexto = cheia ? "FFFFFF" : "4B0A86";
  const textoTodo = `${rotulo}\n${valor}`;
  return [
    { createShape: { objectId: id, shapeType: "ROUND_RECTANGLE", elementProperties: propriedades(pagina, c) } },
    {
      updateShapeProperties: {
        objectId: id,
        shapeProperties: {
          shapeBackgroundFill: { solidFill: { color: cor(cheia ? ROXO : "FFFFFF") } },
          outline: cheia ? { propertyState: "NOT_RENDERED" } : { outlineFill: { solidFill: { color: cor(ROXO) } }, weight: { magnitude: 2.25, unit: "PT" }, propertyState: "RENDERED" },
          contentAlignment: "MIDDLE",
        },
        fields: cheia ? "shapeBackgroundFill.solidFill.color,outline.propertyState,contentAlignment"
          : "shapeBackgroundFill.solidFill.color,outline.outlineFill.solidFill.color,outline.weight,outline.propertyState,contentAlignment",
      },
    },
    { insertText: { objectId: id, text: textoTodo } },
    {
      updateTextStyle: {
        objectId: id, textRange: { type: "ALL" },
        style: { fontFamily: "Montserrat", fontSize: { magnitude: 11, unit: "PT" }, bold: false, foregroundColor: { opaqueColor: cor(corTexto) } },
        fields: "fontFamily,fontSize,bold,foregroundColor",
      },
    },
    {
      updateTextStyle: {
        objectId: id, textRange: { type: "FIXED_RANGE", startIndex: rotulo.length + 1, endIndex: textoTodo.length },
        style: { fontFamily: "Arial", fontSize: { magnitude: 15, unit: "PT" }, bold: true },
        fields: "fontFamily,fontSize,bold",
      },
    },
    { updateParagraphStyle: { objectId: id, textRange: { type: "ALL" }, style: { alignment: "CENTER", spaceAbove: { magnitude: 0, unit: "PT" }, spaceBelow: { magnitude: 0, unit: "PT" } }, fields: "alignment,spaceAbove,spaceBelow" } },
  ];
}

/**
 * Slide de pipeline com quantos passos o funil do cliente tiver: caixas roxas que afunilam,
 * a linha ligando o primeiro ao último passo, o valor investido e o valor das vendas.
 */
function desenharFunil(pagina: string, larg: number, alt: number, passos: { nome: string; valor: string; taxa: string | null }[], investido: string, valorVendas: string): Req[] {
  const reqs: Req[] = [];
  const n = passos.length;
  const topo = alt * 0.19, fundo = alt * 0.9;
  const h = Math.min(alt * 0.12, ((fundo - topo) / n) * 0.72);
  const passo = n > 1 ? (fundo - topo - h) / (n - 1) : 0;
  const centro = larg * 0.42;
  const largura = (i: number) => larg * (n > 1 ? 0.31 - (0.15 * i) / (n - 1) : 0.31);
  const caixas = passos.map((_, i) => ({ x: centro - largura(i) / 2, y: topo + i * passo, w: largura(i), h }));
  // linha à esquerda ligando o primeiro e o último passo
  const xLinha = caixas[0].x - larg * 0.04;
  const espessura = 28_575;
  if (n > 1) {
    const yIni = caixas[0].y + h / 2, yFim = caixas[n - 1].y + h / 2;
    reqs.push(...retangulo(pagina, { x: xLinha, y: yIni, w: espessura, h: yFim - yIni + espessura }, ROXO));
    reqs.push(...retangulo(pagina, { x: xLinha, y: yIni, w: caixas[0].x - xLinha, h: espessura }, ROXO));
    reqs.push(...retangulo(pagina, { x: xLinha, y: yFim, w: caixas[n - 1].x - xLinha, h: espessura }, ROXO));
  }
  passos.forEach((p, i) => {
    reqs.push(...caixaFunil(pagina, caixas[i], p.nome, p.valor, true));
    // taxa de passagem do passo anterior para este, ao lado da caixa
    if (i > 0 && p.taxa) {
      // no último passo sai uma linha para o valor das vendas: a taxa fica acima dela
      const y = i === n - 1 ? caixas[i].y : caixas[i].y + h * 0.25;
      reqs.push(...texto(pagina, { x: caixas[i].x + caixas[i].w + larg * 0.01, y, w: larg * 0.09, h: h * 0.45 }, `${p.taxa}`, { tamanho: 10, cor: "8A5BB5", alinhar: "START" }));
    }
  });
  const larguraValor = larg * 0.25;
  reqs.push(...caixaFunil(pagina, { x: larg * 0.66, y: caixas[0].y, w: larguraValor, h }, "Valor investido", investido, false));
  const ultima = caixas[n - 1];
  const xVendas = Math.max(larg * 0.62, ultima.x + ultima.w + larg * 0.1);
  reqs.push(...retangulo(pagina, { x: ultima.x + ultima.w, y: ultima.y + h / 2, w: xVendas - (ultima.x + ultima.w), h: 12_700 }, ROXO));
  reqs.push(...caixaFunil(pagina, { x: xVendas, y: ultima.y, w: Math.min(larguraValor, larg * 0.96 - xVendas), h }, "Valor das vendas", valorVendas, false));
  return reqs;
}

// ---------- Dados do relatório ----------

export type PedidoRelatorio = { clienteId: string; desde: string; ate: string; dimensao: DimensaoUtm };

/** Rótulo do período: "Outubro/2026" para mês fechado, senão "01/10 a 15/10/2026". */
export function rotuloPeriodo(desde: string, ate: string) {
  const fimDoMes = somarDias(mesDe(desde, 1), -1);
  // mês fechado, ou o mês atual até hoje
  const mesInteiro = desde.endsWith("-01") && (ate === fimDoMes || (ate === hojeISO() && mesDe(ate) === desde));
  if (mesInteiro) {
    const r = nomeMes(desde);
    return r[0].toUpperCase() + r.slice(1);
  }
  const br = (iso: string) => iso.split("-").reverse().join("/");
  return `${br(desde).slice(0, 5)} a ${br(ate)}`;
}

const periodo = (desde: string, ate: string): Periodo => ({ chave: "livre", rotulo: "", desde, ate, qs: "" });
const curto = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const moedaCurta = (v: number) => (v >= 10_000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : dinheiro(v));

function linhasMeta(ls: LinhaTabela[], ordenar: "gasto" | "resultados") {
  return [...ls].sort((a, b) => b[ordenar] - a[ordenar] || b.gasto - a.gasto).slice(0, 12).map((l) => [
    curto(l.nome, 42), inteiro(l.resultados), dinheiro(l.cpr), dinheiro(l.gasto), inteiro(l.impressoes), inteiro(l.alcance),
    inteiro(l.cliques_link), dinheiro(l.cpc), pct(l.ctr), dinheiro(l.cpm),
  ]);
}
const CABECALHO_META = ["", "Resultados", "Custo por resultado", "Valor gasto", "Impressões", "Alcance", "Cliques no link", "CPC", "CTR", "CPM"];

const VERBO: Record<string, string> = {
  pausar: "Pausamos", ativar: "Ativamos", orcamento: "Ajustamos o orçamento de", duplicar: "Duplicamos", montar: "Criamos",
};

/** Ações registradas pelo painel no período (pausas, orçamento, campanhas novas), em frases curtas. */
async function acoesDoPeriodo(clienteId: string, desde: string, ate: string) {
  const { data } = await db().from("acoes_log").select("criado_em, acao, nivel, objeto_nome, depois, plataforma")
    .eq("cliente_id", clienteId).eq("ok", true).gte("criado_em", `${desde}T00:00:00-03:00`).lte("criado_em", `${ate}T23:59:59-03:00`)
    .order("criado_em").limit(12);
  return ((data ?? []) as { criado_em: string; acao: string; nivel: string | null; objeto_nome: string | null; depois: string | null; plataforma: string }[])
    .map((a) => {
      const dia = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(new Date(a.criado_em));
      const oque = `${a.nivel ?? "item"} “${curto(a.objeto_nome ?? "", 40)}”`;
      const extra = a.acao === "orcamento" && a.depois ? ` para ${a.depois}` : "";
      return `${dia}: ${VERBO[a.acao] ?? a.acao} ${oque}${extra}${a.plataforma === "google" ? " (Google)" : ""}`;
    });
}

/** Gera o relatório: copia o modelo, preenche e devolve o link da apresentação nova. */
export async function gerarRelatorio(p: PedidoRelatorio) {
  const config = await configRelatorio();
  if (!config) throw new Error("Crie primeiro o modelo no Drive (botão logo acima).");
  const banco = db();
  // pasta_drive vem do SQL 0017; sem ele, segue sem a pasta do cliente
  const lerCliente = (colunas: string) => banco.from("clientes").select(colunas).eq("id", p.clienteId).maybeSingle();
  const primeira = await lerCliente("id, nome, pasta_drive");
  const { data: clienteRaw } = primeira.error ? await lerCliente("id, nome") : primeira;
  const cliente = clienteRaw as unknown as { id: string; nome: string; pasta_drive?: { id: string; nome: string } | null } | null;
  if (!cliente) throw new Error("Cliente não encontrado.");
  const atual = periodo(p.desde, p.ate);
  const [meta, crm, google, { meses }, funil, acoes] = await Promise.all([
    detalheCliente(p.clienteId, atual, atual),
    detalheCrm(p.clienteId, atual, atual).catch(() => null),
    detalheGoogle(p.clienteId, atual, atual).catch(() => null),
    lerHistorico(p.clienteId),
    funilDoCliente(p.clienteId),
    acoesDoPeriodo(p.clienteId, p.desde, p.ate),
  ]);
  if (!meta) throw new Error("Cliente não encontrado.");
  const rotuloPer = rotuloPeriodo(p.desde, p.ate);
  const taxa = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? (a / b) * 100 : null);

  // funil: meses fechados vêm do histórico (respeita as correções manuais); período quebrado é calculado na hora
  const doHistorico = meses.filter((m) => m.mes >= mesDe(p.desde) && m.mes <= p.ate);
  const cobreMeses = p.desde.endsWith("-01") && doHistorico.length > 0 && doHistorico.length === mesesNoIntervalo(p.desde, p.ate);
  const soma = cobreMeses ? somarMeses(doHistorico) : null;
  const gasto = soma?.investimento ?? meta.atual.gasto + (google?.atual.gasto ?? 0);
  const aoVivo = crm?.atual.funil;
  const leads = soma ? soma.leads : aoVivo ? aoVivo.leads : Math.round(meta.atual.resultados + (google?.atual.conversoes ?? 0));
  const valorPasso = (nome: string) => (soma ? soma.passos.find((x) => x.nome === nome)?.valor ?? null : aoVivo?.passos.find((x) => x.nome === nome)?.valor ?? null);
  const nomesPassos = funil.passos.map((x) => x.nome);
  const vendas = soma ? soma.vendas : aoVivo?.vendas ?? null;
  const faturamento = soma ? soma.faturamento : aoVivo?.faturamento ?? null;
  const temCrm = !!crm || !!soma?.crm;

  // gráficos: até 6 meses do histórico terminando no mês do relatório
  const serie: MesConsolidado[] = meses.filter((m) => m.mes <= p.ate).slice(0, 6).reverse();
  const usaHistorico = serie.length > 0;
  const categorias = usaHistorico ? serie.map((m) => { const n = nomeMes(m.mes, false); return n[0].toUpperCase() + n.slice(1); }) : [rotuloPer];
  const valoresDe = (f: (m: MesConsolidado) => number | null, atualV: number | null) => (usaHistorico ? serie.map(f) : [atualV]);
  const passoDoMes = (m: MesConsolidado, nome: string) => m.passos.find((x) => x.nome === nome);

  // copia o modelo e lê onde estão os marcadores
  const { acesso } = await acessoDoToken(config.tokenId);
  // pasta do cliente escolhida no painel; sem ela, a pasta "Relatórios · Visão Geral"
  const pasta = (cliente.pasta_drive as { id: string } | null)?.id ?? config.pastaId;
  const copia = await api<{ id: string }>(acesso, `${DRIVE}/files/${config.modeloId}/copy?fields=id&supportsAllDrives=true`, {
    method: "POST",
    body: JSON.stringify({ name: `Relatório ${cliente.nome} · ${rotuloPer}`, ...(pasta && { parents: [pasta] }) }),
  }).catch((e) => {
    if (pasta !== config.pastaId && /not found|não encontrado|File not found|insufficient/i.test(String(e))) {
      throw new Error("Não consegui salvar na pasta escolhida para este cliente. Escolha a pasta de novo (botão “Escolher pasta”).");
    }
    throw e;
  });
  type Elemento = {
    objectId: string;
    size?: { width?: { magnitude?: number }; height?: { magnitude?: number } };
    transform?: { scaleX?: number; scaleY?: number; translateX?: number; translateY?: number };
    shape?: { text?: { textElements?: { textRun?: { content?: string } }[] } };
    image?: unknown;
  };
  const apresentacao = await api<{ slides: { objectId: string; pageElements?: Elemento[] }[]; pageSize: { height: { magnitude: number } } }>(
    acesso, `${SLIDES}/${copia.id}`,
  );
  const alturaSlide = apresentacao.pageSize.height.magnitude;
  const larguraSlide = (apresentacao as { pageSize: { width?: { magnitude?: number } } }).pageSize.width?.magnitude ?? 9_144_000;
  const textoDe = (el: Elemento) => (el.shape?.text?.textElements ?? []).map((x) => x.textRun?.content ?? "").join("");
  // slide do pipeline: o que tem {{leads}}; as caixas fixas do modelo são trocadas pelo funil do cliente
  const slideFunil = apresentacao.slides.find((s) => (s.pageElements ?? []).some((el) => textoDe(el).includes("{{leads}}")));
  const marcadores = new Map<string, { slide: string; elemento: string; caixa: Caixa }>();
  for (const s of apresentacao.slides) {
    for (const el of s.pageElements ?? []) {
      const t = (el.shape?.text?.textElements ?? []).map((x) => x.textRun?.content ?? "").join("");
      const m = t.match(/\{\{((?:tabela|grafico):\w+)\}\}/);
      if (!m) continue;
      const tr = el.transform ?? {};
      marcadores.set(m[1], {
        slide: s.objectId, elemento: el.objectId,
        caixa: {
          x: tr.translateX ?? 0, y: tr.translateY ?? 0,
          w: (el.size?.width?.magnitude ?? 0) * (tr.scaleX ?? 1), h: (el.size?.height?.magnitude ?? 0) * (tr.scaleY ?? 1),
        },
      });
    }
  }

  const reqs: Req[] = [];
  const trocar = (de: string, para: string) => reqs.push({ replaceAllText: { containsText: { text: de, matchCase: true }, replaceText: para } });
  trocar("{{cliente}}", cliente.nome);
  trocar("{{periodo}}", rotuloPer);
  trocar("{{investimento}}", dinheiro(gasto));
  if (slideFunil) {
    // apaga as caixas do modelo (fica o título e as imagens, como o foguete) e desenha o funil do cliente
    for (const el of slideFunil.pageElements ?? []) {
      if (el.image || /PIPELINE|\{\{periodo\}\}/i.test(textoDe(el))) continue;
      reqs.push({ deleteObject: { objectId: el.objectId } });
    }
    const etapas = temCrm
      ? [
          { nome: funil.leads, valor: leads, taxa: null as string | null },
          ...nomesPassos.map((nome, i) => {
            const v = valorPasso(nome);
            return { nome, valor: v, taxa: pctOuNada(taxa(v, i === 0 ? leads : valorPasso(nomesPassos[i - 1]))) };
          }),
          { nome: funil.vendas, valor: vendas, taxa: pctOuNada(taxa(vendas, nomesPassos.length ? valorPasso(nomesPassos.at(-1)!) : leads)) },
        ]
      : [{ nome: funil.leads, valor: leads, taxa: null }];
    reqs.push(...desenharFunil(slideFunil.objectId, larguraSlide, alturaSlide,
      etapas.map((e) => ({ nome: e.nome, valor: inteiro(e.valor), taxa: e.taxa })), dinheiro(gasto), dinheiro(faturamento)));
  }
  trocar("{{acoes}}", [...acoes, "Próximos passos: "].join("\n"));

  /** Troca o marcador pelo conteúdo; sem conteúdo, apaga o slide inteiro. */
  const preencher = (chave: string, gerar: ((pagina: string, c: Caixa) => Req[]) | null) => {
    const m = marcadores.get(chave);
    if (!m) return;
    if (!gerar) {
      reqs.push({ deleteObject: { objectId: m.slide } });
      return;
    }
    reqs.push({ deleteObject: { objectId: m.elemento } });
    // tabelas usam a largura do quadro e descem até o fim do slide
    const caixa = chave.startsWith("tabela") ? { ...m.caixa, h: alturaSlide - m.caixa.y - 150_000 } : m.caixa;
    reqs.push(...gerar(m.slide, caixa));
  };

  const totalMeta = (ls: LinhaTabela[]) => {
    const t = meta.atual;
    return ls.length ? ["Total", inteiro(t.resultados), dinheiro(t.cpr), dinheiro(t.gasto), inteiro(t.impressoes), inteiro(t.alcance),
      inteiro(t.cliques_link), dinheiro(t.cpc), pct(t.ctr), dinheiro(t.cpm)] : undefined;
  };
  preencher("tabela:conjuntos", meta.conjuntos.length
    ? (pg, c) => tabela(pg, c, ["Conjunto de anúncios", ...CABECALHO_META.slice(1)], linhasMeta(meta.conjuntos, "gasto"), { total: totalMeta(meta.conjuntos) })
    : null);
  preencher("tabela:anuncios", meta.anuncios.length
    ? (pg, c) => tabela(pg, c, ["Anúncio", ...CABECALHO_META.slice(1)], linhasMeta(meta.anuncios, "resultados"), { total: totalMeta(meta.anuncios) })
    : null);
  const campanhasG = (google?.campanhas ?? []).filter((x) => x.gasto > 0);
  preencher("tabela:google", campanhasG.length
    ? (pg, c) => tabela(pg, c, ["Campanha", "Conversões", "Custo por conversão", "Valor gasto", "Impressões", "Cliques", "CPC", "CTR"],
        campanhasG.slice(0, 12).map((x) => [curto(x.nome), inteiro(x.conversoes), dinheiro(x.cpa), dinheiro(x.gasto), inteiro(x.impressoes), inteiro(x.cliques), dinheiro(x.cpc), pct(x.ctr)]),
        { total: ["Total", inteiro(google!.atual.conversoes), dinheiro(google!.atual.cpa), dinheiro(google!.atual.gasto), inteiro(google!.atual.impressoes), inteiro(google!.atual.cliques), dinheiro(google!.atual.cpc), pct(google!.atual.ctr)], larguraPrimeira: 0.32 })
    : null);
  const utm = (crm?.porUtm[p.dimensao] ?? []).filter((x) => x.funil.leads || x.funil.vendas);
  const dim = DIMENSOES_UTM.find((d) => d.chave === p.dimensao)!;
  preencher("tabela:qualificacao", utm.length
    ? (pg, c) => tabela(pg, c, [dim.rotulo, funil.leads, ...nomesPassos, funil.vendas, `${funil.leads} → ${funil.vendas.toLowerCase()}`, "Valor das vendas"],
        utm.slice(0, 12).map((x) => [
          curto(x.nome, 60), inteiro(x.funil.leads), ...nomesPassos.map((n) => inteiro(x.funil.passos.find((y) => y.nome === n)?.valor)),
          inteiro(x.funil.vendas), pct(taxa(x.funil.vendas, x.funil.leads)), dinheiro(x.funil.faturamento),
        ]),
        { larguraPrimeira: nomesPassos.length > 2 ? 0.3 : 0.38 })
    : null);
  preencher("grafico:oportunidades", (pg, c) => grafico(pg, c, "Evolução das oportunidades", categorias, [
    { nome: `Nº ${funil.leads}`, valores: valoresDe((m) => m.leads, leads) },
    ...nomesPassos.map((n) => ({ nome: `Nº ${n}`, valores: valoresDe((m) => passoDoMes(m, n)?.valor ?? null, valorPasso(n)) })),
    ...(temCrm ? [{ nome: `Nº ${funil.vendas}`, valores: valoresDe((m) => m.vendas, vendas) }] : []),
  ], (v) => inteiro(v)));
  preencher("grafico:taxas", temCrm ? (pg, c) => grafico(pg, c, "Evolução das taxas", categorias, [
    ...nomesPassos.map((n, i) => ({
      nome: n,
      valores: valoresDe((m) => { const t = passoDoMes(m, n)?.taxa; return t == null ? null : t * 100; },
        taxa(valorPasso(n), i === 0 ? leads : valorPasso(nomesPassos[i - 1]))),
    })),
    {
      nome: funil.vendas,
      valores: valoresDe((m) => (m.conversaoVendas == null ? null : m.conversaoVendas * 100),
        taxa(vendas, nomesPassos.length ? valorPasso(nomesPassos.at(-1)!) : leads)),
    },
  ], (v) => pct(v)) : null);
  preencher("grafico:investimento", (pg, c) => grafico(pg, c, "Investimento em anúncios", categorias, [
    { nome: "Investimento", valores: valoresDe((m) => m.investimento, gasto) },
  ], moedaCurta));

  // em partes (são centenas de alterações); a ordem importa: cada parte usa o que a anterior criou
  for (let i = 0; i < reqs.length; i += 400) {
    await api(acesso, `${SLIDES}/${copia.id}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: reqs.slice(i, i + 400) }) });
  }
  const link = linkApresentacao(copia.id);
  await banco.from("relatorios_gerados").insert({ cliente_id: p.clienteId, periodo: rotuloPer, link }).then(() => null, () => null);
  return { link, periodo: rotuloPer };
}

const pctOuNada = (v: number | null) => (v == null ? null : pct(v));

function mesesNoIntervalo(desde: string, ate: string) {
  let n = 0;
  for (let m = mesDe(desde); m <= ate; m = mesDe(m, 1)) n++;
  return n;
}
