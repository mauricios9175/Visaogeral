import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { tokenDeAcesso, tokenSoDrive } from "./google";
import { atividadesDaConta } from "./meta";
import { tokenDaConta } from "./sync";
import type { ContaAnuncio } from "./db";
import { detalheCliente, detalheCrm, type DimensaoUtm, type LinhaTabela } from "./consultas";
import { detalheGoogle } from "./consultas-google";
import { funilDoCliente, lerHistorico, mesDe, nomeMes, somarMeses, type MesConsolidado } from "./historico";
import { dinheiro, inteiro, pct } from "./formato";
import { agruparPorNome, chaveDe, gastoPorNome, NIVEL_DA_UTM, nomeDoAnuncio, nomeDoPublico } from "./agrupar";
import type { NumerosFunil } from "./funil";
import { hojeISO, somarDias, type Periodo } from "./datas";
import { configEmpresa, corDoModelo, guardarModeloEmpresa, LAYOUTS, temaDaEmpresa, type ConfigEmpresa, type LayoutRelatorio, type TemaRelatorio } from "./empresas";

// Relatório do cliente no Google Slides: o painel copia o modelo da Propulsão (no Drive do usuário)
// e troca os marcadores {{...}} por números, tabelas e gráficos desenhados no próprio slide (editáveis).
// Só usa o escopo drive.file: o painel enxerga apenas o modelo e os relatórios que ele mesmo criou.

const DRIVE = "https://www.googleapis.com/drive/v3";
const SLIDES = "https://slides.googleapis.com/v1/presentations";

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

/** Sobe um arquivo de modelo (PowerPoint) para o Drive, convertido em Google Slides. */
async function subirModelo(acesso: string, layout: LayoutRelatorio, nome: string, pastaId: string | null) {
  const pptx = await readFile(path.join(process.cwd(), "modelos", LAYOUTS[layout].arquivo));
  const limite = `limite${Date.now()}`;
  const meta = JSON.stringify({ name: `Modelo de relatório · ${nome}`, mimeType: "application/vnd.google-apps.presentation", ...(pastaId && { parents: [pastaId] }) });
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
  return arquivo.id;
}

/** Sobe o modelo da Propulsão para o Drive (convertido em Google Slides), dentro de uma pasta só dos relatórios. */
export async function criarModeloNoDrive(tokenId: string) {
  const { acesso, email } = await acessoDoToken(tokenId);
  const pasta = await api<{ id: string }>(acesso, `${DRIVE}/files?fields=id`, {
    method: "POST",
    body: JSON.stringify({ name: "Relatórios · Visão Geral", mimeType: "application/vnd.google-apps.folder" }),
  });
  const modeloId = await subirModelo(acesso, "completo", "Propulsão", pasta.id);
  const valor: ConfigRelatorio = { modeloId, pastaId: pasta.id, tokenId, email };
  const { error } = await db().from("configuracoes").upsert({ chave: "relatorio_slides", valor, atualizado_em: new Date().toISOString() });
  if (error) throw new Error(`${error.message} (rode o SQL 0016 no Supabase)`);
  return valor;
}

// ---------- Pintar o modelo com as cores e a fonte da empresa ----------

type Rgb = { red?: number; green?: number; blue?: number };
const paraHex = (c?: Rgb) => c ? [c.red ?? 0, c.green ?? 0, c.blue ?? 0].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase() : null;

function hsl(hex: string) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return { h, s, l };
}
function deHsl(h: number, s: number, l: number) {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
const corRgb = (hex: string) => ({ rgbColor: { red: parseInt(hex.slice(0, 2), 16) / 255, green: parseInt(hex.slice(2, 4), 16) / 255, blue: parseInt(hex.slice(4, 6), 16) / 255 } });

/** Troca uma cor do modelo pela equivalente nas cores novas (tons da cor principal viram tons da nova, idem destaque). */
function trocarCor(atual: string, de: { primaria: string; destaque: string }, para: { primaria: string; destaque: string }): string | null {
  const x = hsl(atual);
  if (x.s < 0.25 || x.l > 0.96 || x.l < 0.04) return null; // cinzas, branco e preto ficam
  const perto = (base: string) => { const b = hsl(base); const dh = Math.min(Math.abs(x.h - b.h), 360 - Math.abs(x.h - b.h)); return dh <= 30 ? b : null; };
  const alvo = perto(de.primaria) ? [de.primaria, para.primaria] : perto(de.destaque) ? [de.destaque, para.destaque] : null;
  if (!alvo) return null;
  const b = hsl(alvo[0]), n = hsl(alvo[1]);
  // mantém a diferença de claridade em relação à cor-base (um roxo escuro vira um azul escuro, um fundo claro vira claro)
  return deHsl(n.h, Math.min(1, n.s * (x.s / Math.max(b.s, 0.01))), Math.max(0.08, Math.min(0.97, n.l + Math.max(-0.25, Math.min(0.25, x.l - b.l)))));
}

/** Repinta o modelo no Drive: fundos, formas, linhas e textos nas cores da empresa; troca a fonte do layout pela escolhida. */
async function pintarModelo(acesso: string, id: string, de: { primaria: string; destaque: string; fonte: string }, para: { primaria: string; destaque: string; fonte: string }) {
  if (de.primaria === para.primaria && de.destaque === para.destaque && de.fonte === para.fonte) return;
  type Texto = { textElements?: { startIndex?: number; endIndex?: number; textRun?: { style?: { foregroundColor?: { opaqueColor?: { rgbColor?: Rgb } }; fontFamily?: string } } }[] };
  type El = {
    objectId: string;
    shape?: { shapeProperties?: { shapeBackgroundFill?: { solidFill?: { color?: { rgbColor?: Rgb } } }; outline?: { outlineFill?: { solidFill?: { color?: { rgbColor?: Rgb } } } } }; text?: Texto };
    line?: { lineProperties?: { lineFill?: { solidFill?: { color?: { rgbColor?: Rgb } } } } };
  };
  const ap = await api<{ slides: { objectId: string; pageProperties?: { pageBackgroundFill?: { solidFill?: { color?: { rgbColor?: Rgb } } } }; pageElements?: El[] }[] }>(acesso, `${SLIDES}/${id}`);
  const reqs: Req[] = [];
  const nova = (rgb?: Rgb) => { const h = paraHex(rgb); return h ? trocarCor(h, de, para) : null; };
  for (const sl of ap.slides) {
    const fundo = nova(sl.pageProperties?.pageBackgroundFill?.solidFill?.color?.rgbColor);
    if (fundo) reqs.push({ updatePageProperties: { objectId: sl.objectId, pageProperties: { pageBackgroundFill: { solidFill: { color: corRgb(fundo) } } }, fields: "pageBackgroundFill.solidFill.color" } });
    for (const el of sl.pageElements ?? []) {
      const f = nova(el.shape?.shapeProperties?.shapeBackgroundFill?.solidFill?.color?.rgbColor);
      if (f) reqs.push({ updateShapeProperties: { objectId: el.objectId, shapeProperties: { shapeBackgroundFill: { solidFill: { color: corRgb(f) } } }, fields: "shapeBackgroundFill.solidFill.color" } });
      const o = nova(el.shape?.shapeProperties?.outline?.outlineFill?.solidFill?.color?.rgbColor);
      if (o) reqs.push({ updateShapeProperties: { objectId: el.objectId, shapeProperties: { outline: { outlineFill: { solidFill: { color: corRgb(o) } } } }, fields: "outline.outlineFill.solidFill.color" } });
      const l = nova(el.line?.lineProperties?.lineFill?.solidFill?.color?.rgbColor);
      if (l) reqs.push({ updateLineProperties: { objectId: el.objectId, lineProperties: { lineFill: { solidFill: { color: corRgb(l) } } }, fields: "lineFill.solidFill.color" } });
      for (const t of el.shape?.text?.textElements ?? []) {
        const st = t.textRun?.style;
        if (!st || t.startIndex == null && t.endIndex == null) continue;
        const faixa = { type: "FIXED_RANGE", startIndex: t.startIndex ?? 0, endIndex: t.endIndex };
        const c = nova(st.foregroundColor?.opaqueColor?.rgbColor);
        if (c) reqs.push({ updateTextStyle: { objectId: el.objectId, textRange: faixa, style: { foregroundColor: { opaqueColor: corRgb(c) } }, fields: "foregroundColor" } });
        if (de.fonte !== para.fonte && st.fontFamily === de.fonte) {
          reqs.push({ updateTextStyle: { objectId: el.objectId, textRange: faixa, style: { fontFamily: para.fonte }, fields: "fontFamily" } });
        }
      }
    }
  }
  for (let i = 0; i < reqs.length; i += 400) {
    await api(acesso, `${SLIDES}/${id}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: reqs.slice(i, i + 400) }) });
  }
}

/**
 * Modelo da empresa no Drive: criado no primeiro relatório (a partir do layout escolhido, já nas cores dela);
 * se as cores ou a fonte mudaram, é repintado; se foi apagado, é criado de novo.
 */
async function idDoModeloEmpresa(cfg: ConfigEmpresa, config: ConfigRelatorio, acesso: string, recriar = false) {
  const base = LAYOUTS[cfg.layout].base;
  const alvo = { primaria: cfg.primaria, destaque: cfg.destaque, fonte: cfg.fonte };
  if (cfg.modeloId && !recriar) {
    if (cfg.modeloCores !== corDoModelo(cfg)) {
      // repinta a partir das cores com que foi pintado da última vez
      const [, p1, d1, f1] = (cfg.modeloCores ?? corDoModelo({ ...base, layout: cfg.layout })).split("|");
      await pintarModelo(acesso, cfg.modeloId, { primaria: p1, destaque: d1, fonte: f1 }, alvo);
      await guardarModeloEmpresa(cfg.nome, cfg.modeloId, corDoModelo(cfg));
    }
    return cfg.modeloId;
  }
  const id = await subirModelo(acesso, cfg.layout, cfg.nome, config.pastaId);
  await pintarModelo(acesso, id, base, alvo);
  await guardarModeloEmpresa(cfg.nome, id, corDoModelo(cfg));
  return id;
}

/** Link do modelo de uma empresa (se já existe). */
export async function modeloDaEmpresa(nome: string | null | undefined) {
  return (await configEmpresa(nome)).modeloId ?? null;
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

// Cores do relatório que está sendo gerado (as da empresa; um por vez, volta ao padrão no fim).
const TEMA_PADRAO = temaDaEmpresa({ ...LAYOUTS.completo.base, layout: "completo" });
let tema: TemaRelatorio = TEMA_PADRAO;

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
        style: { fontFamily: tema.fonte, fontSize: { magnitude: e.tamanho, unit: "PT" }, bold: !!e.negrito, foregroundColor: { opaqueColor: cor(e.cor ?? "444444") } },
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
            fontFamily: tema.fonte, fontSize: { magnitude: ehCabecalho ? 7 : 8, unit: "PT" }, bold: ehCabecalho || ehTotal,
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
  reqs.push(fundo(0, 1, tema.primaria));
  if (linhas.length) reqs.push(fundo(1, linhas.length, "FFFFFF"));
  if (opcoes.total) reqs.push(fundo(todas.length - 1, 1, tema.clara));
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
      if (alt > 0) reqs.push(...retangulo(pagina, { x, y: base - alt, w: barra * 0.92, h: alt }, tema.paleta[j % tema.paleta.length]));
      const larguraRotulo = Math.max(barra, 640_000);
      reqs.push(...texto(pagina, { x: x + barra * 0.46 - larguraRotulo / 2, y: base - alt - 230_000, w: larguraRotulo, h: 220_000 },
        v == null ? "—" : formato(v), { tamanho: 8, negrito: true, cor: tema.paleta[j % tema.paleta.length] }));
    });
    reqs.push(...texto(pagina, { x: area.x + i * grupo, y: base + 40_000, w: grupo, h: 240_000 }, cat, { tamanho: 9, cor: "444444" }));
  });
  reqs.push(...retangulo(pagina, { x: area.x, y: base, w: area.w, h: 9_525 }, "999999"));
  // legenda à direita, como nos gráficos do Planilhas
  series.forEach((s, j) => {
    const y = c.y + c.h * 0.22 + j * 300_000;
    reqs.push(...retangulo(pagina, { x: c.x + c.w * 0.8, y: y + 50_000, w: 130_000, h: 130_000 }, tema.paleta[j % tema.paleta.length]));
    reqs.push(...texto(pagina, { x: c.x + c.w * 0.8 + 180_000, y, w: c.w * 0.18, h: 230_000 }, s.nome, { tamanho: 10, alinhar: "START" }));
  });
  return reqs;
}

/** Caixa arredondada com duas linhas (rótulo e valor), no estilo do slide de pipeline. */
function caixaFunil(pagina: string, c: Caixa, rotulo: string, valor: string, cheia: boolean): Req[] {
  const id = novoId("f");
  const corTexto = cheia ? "FFFFFF" : tema.escura;
  const textoTodo = `${rotulo}\n${valor}`;
  return [
    { createShape: { objectId: id, shapeType: "ROUND_RECTANGLE", elementProperties: propriedades(pagina, c) } },
    {
      updateShapeProperties: {
        objectId: id,
        shapeProperties: {
          shapeBackgroundFill: { solidFill: { color: cor(cheia ? tema.primaria : "FFFFFF") } },
          outline: cheia ? { propertyState: "NOT_RENDERED" } : { outlineFill: { solidFill: { color: cor(tema.primaria) } }, weight: { magnitude: 2.25, unit: "PT" }, propertyState: "RENDERED" },
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
        style: { fontFamily: tema.fonteFunil, fontSize: { magnitude: 11, unit: "PT" }, bold: false, foregroundColor: { opaqueColor: cor(corTexto) } },
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
function desenharFunil(
  pagina: string, larg: number, alt: number, passos: { nome: string; valor: string; taxa: string | null }[],
  investido: string, valorVendas: string, valorPropostas: string | null,
): Req[] {
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
    reqs.push(...retangulo(pagina, { x: xLinha, y: yIni, w: espessura, h: yFim - yIni + espessura }, tema.primaria));
    reqs.push(...retangulo(pagina, { x: xLinha, y: yIni, w: caixas[0].x - xLinha, h: espessura }, tema.primaria));
    reqs.push(...retangulo(pagina, { x: xLinha, y: yFim, w: caixas[n - 1].x - xLinha, h: espessura }, tema.primaria));
  }
  passos.forEach((p, i) => {
    reqs.push(...caixaFunil(pagina, caixas[i], p.nome, p.valor, true));
    // taxa de passagem do passo anterior para este, ao lado da caixa
    if (i > 0 && p.taxa) {
      // quando sai uma linha da caixa (valor das vendas ou valor somado do passo), a taxa fica acima dela
      const y = i === n - 1 || (valorPropostas && i === n - 2) ? caixas[i].y : caixas[i].y + h * 0.25;
      reqs.push(...texto(pagina, { x: caixas[i].x + caixas[i].w + larg * 0.01, y, w: larg * 0.09, h: h * 0.45 }, `${p.taxa}`, { tamanho: 10, cor: tema.media, alinhar: "START" }));
    }
  });
  const larguraValor = larg * 0.25;
  // valor das propostas: ao lado do passo antes das vendas (o último passo do meio), ligado por uma linha
  const iPropostas = n - 2;
  if (valorPropostas && iPropostas > 0) {
    const cx = caixas[iPropostas];
    const x = larg * 0.66;
    reqs.push(...retangulo(pagina, { x: cx.x + cx.w, y: cx.y + h / 2, w: x - (cx.x + cx.w), h: 12_700 }, tema.primaria));
    reqs.push(...caixaFunil(pagina, { x, y: cx.y, w: larguraValor, h }, "Valor das propostas", valorPropostas, false));
  }
  reqs.push(...caixaFunil(pagina, { x: larg * 0.66, y: caixas[0].y, w: larguraValor, h }, "Valor investido", investido, false));
  const ultima = caixas[n - 1];
  const xVendas = Math.max(larg * 0.62, ultima.x + ultima.w + larg * 0.1);
  reqs.push(...retangulo(pagina, { x: ultima.x + ultima.w, y: ultima.y + h / 2, w: xVendas - (ultima.x + ultima.w), h: 12_700 }, tema.primaria));
  reqs.push(...caixaFunil(pagina, { x: xVendas, y: ultima.y, w: Math.min(larguraValor, larg * 0.96 - xVendas), h }, "Valor das vendas", valorVendas, false));
  return reqs;
}

// ---------- Dados do relatório ----------

export type PedidoRelatorio = {
  clienteId: string; desde: string; ate: string;
  qualificacoes: DimensaoUtm[]; // um slide de qualificação por UTM escolhida; vazio = sem qualificação
  agrupar: boolean; // junta públicos e anúncios de mesmo nome (duplicados para teste)
  motivosPerda?: boolean; // slide com os motivos de perda do CRM (opcional)
  vendas?: boolean;       // slide com o gráfico de vendas realizadas e valor das vendas (padrão: sim, se houver CRM)
  empresaModelo?: string; // usar o modelo desta empresa (sem: o da empresa do cliente)
  resumoIA?: boolean;     // slide "Destaques" escrito pela IA (modelos novos; padrão: sim)
};

/** Período anterior para comparar: o mês anterior (relatório de mês inteiro) ou os mesmos dias logo antes. */
function periodoAnterior(desde: string, ate: string): { desde: string; ate: string } {
  if (desde.endsWith("-01")) {
    const ini = mesDe(desde, -1);
    const fimMes = somarDias(desde, -1);
    // mês em andamento: compara com os mesmos dias do mês anterior
    const dias = Math.round((Date.parse(ate) - Date.parse(desde)) / 86_400_000);
    return { desde: ini, ate: [somarDias(ini, dias), fimMes].sort()[0] };
  }
  const n = Math.round((Date.parse(ate) - Date.parse(desde)) / 86_400_000) + 1;
  return { desde: somarDias(desde, -n), ate: somarDias(desde, -1) };
}

/** Texto do slide "Destaques" (para o cliente): 4 a 6 tópicos curtos escritos pela IA com os números do período. */
async function destaquesIA(clienteId: string, atual: Periodo, anterior: Periodo) {
  const { dadosDoPeriodo } = await import("./analise");
  const { perguntarIA } = await import("./ia");
  const dados = await dadosDoPeriodo(clienteId, atual, anterior);
  const sistema = `Você escreve o slide "Destaques do período" de um relatório de tráfego pago que vai para o CLIENTE (dono da empresa).
Escreva de 4 a 6 tópicos, um por linha, cada um começando com "• " e com no máximo 22 palavras.
Linguagem simples e positiva-realista, sem jargão (explique CPL como "custo por contato/lead"), com números concretos do período e a comparação com o anterior.
Inclua pelo menos um ponto de atenção e termine com um tópico sobre o foco do próximo período. Não invente números. Sem markdown, sem títulos.`;
  const t = await perguntarIA(sistema, dados.texto, { temperatura: 0.4 });
  return t.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => (l.startsWith("•") ? l : `• ${l.replace(/^[-*]\s*/, "")}`)).slice(0, 7).join("\n");
}

type Cartao = { rotulo: string; valor: string; variacao: number | null; melhorMaior: boolean | null; comparado: string };

/** Cartões do resumo ({{tabela:resumo}}): até 4 por linha, com a variação colorida (verde melhorou, vermelho piorou). */
function cartoesResumo(pagina: string, c: Caixa, cartoes: Cartao[]): Req[] {
  const reqs: Req[] = [];
  const porLinha = Math.min(4, cartoes.length) || 1;
  const linhas = Math.ceil(cartoes.length / porLinha);
  const gap = c.w * 0.025;
  const w = (c.w - gap * (porLinha - 1)) / porLinha;
  const h = Math.min((c.h - gap * (linhas - 1)) / linhas, 1_250_000);
  cartoes.forEach((k, i) => {
    const x = c.x + (i % porLinha) * (w + gap);
    const y = c.y + Math.floor(i / porLinha) * (h + gap);
    reqs.push(...retangulo(pagina, { x, y, w, h }, tema.clara));
    reqs.push(...retangulo(pagina, { x, y, w: 45_000, h }, tema.primaria));
    reqs.push(...texto(pagina, { x: x + w * 0.08, y: y + h * 0.1, w: w * 0.88, h: h * 0.24 }, k.rotulo, { tamanho: 10, cor: "6B7280", alinhar: "START" }));
    reqs.push(...texto(pagina, { x: x + w * 0.08, y: y + h * 0.34, w: w * 0.88, h: h * 0.34 }, k.valor, { tamanho: 20, negrito: true, cor: tema.escura, alinhar: "START" }));
    if (k.variacao != null && Number.isFinite(k.variacao)) {
      const melhorou = k.melhorMaior == null ? null : (k.variacao >= 0) === k.melhorMaior;
      const seta = k.variacao >= 0 ? "▲" : "▼";
      const corVar = melhorou == null ? "6B7280" : melhorou ? "15803D" : "B91C1C";
      reqs.push(...texto(pagina, { x: x + w * 0.08, y: y + h * 0.7, w: w * 0.88, h: h * 0.22 },
        `${seta} ${Math.abs(k.variacao).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% vs ${k.comparado}`, { tamanho: 9, cor: corVar, alinhar: "START" }));
    }
  });
  return reqs;
}

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

/** Linhas que cabem numa tabela do slide (as outras viram uma linha "Outros"), sem contar cabeçalho e total. */
const LINHAS_POR_TABELA = 9;

type ItemMeta = Pick<LinhaTabela, "nome" | "resultados" | "gasto" | "impressoes" | "cliques_link">;

function somarMeta(a: ItemMeta, b: ItemMeta): ItemMeta {
  return {
    nome: a.nome, resultados: a.resultados + b.resultados, gasto: a.gasto + b.gasto,
    impressoes: a.impressoes + b.impressoes, cliques_link: a.cliques_link + b.cliques_link,
  };
}

function celulasMeta(nome: string, l: ItemMeta) {
  const div = (x: number, y: number) => (y > 0 ? x / y : null);
  return [
    nome, inteiro(l.resultados), dinheiro(div(l.gasto, l.resultados)), dinheiro(l.gasto), inteiro(l.impressoes),
    inteiro(l.cliques_link), dinheiro(div(l.gasto, l.cliques_link)), pct(div(l.cliques_link * 100, l.impressoes)), dinheiro(div(l.gasto * 1000, l.impressoes)),
  ];
}

/**
 * Conjuntos ou anúncios do Meta para a tabela: junta os de mesmo público/criativo (se pedido),
 * ordena, mostra os primeiros e soma o resto numa linha "Outros".
 */
function linhasMeta(ls: LinhaTabela[], ordenar: "gasto" | "resultados", juntar: "publico" | "anuncio" | null) {
  const grupos = juntar
    ? agruparPorNome<ItemMeta>(ls, (l) => l.nome, juntar === "publico" ? nomeDoPublico : nomeDoAnuncio, somarMeta)
        // corta o nome antes de acrescentar quantos foram juntados, para o "(3x)" não sumir
        .map((g) => ({ ...g.item, nome: g.juntos > 1 ? `${curto(g.nome, 34)} (${g.juntos}x)` : g.nome }))
    : ls;
  const ordenados = [...grupos].sort((a, b) => b[ordenar] - a[ordenar] || b.gasto - a.gasto);
  const mostrados = ordenados.length > LINHAS_POR_TABELA + 1 ? ordenados.slice(0, LINHAS_POR_TABELA) : ordenados;
  const resto = ordenados.slice(mostrados.length);
  return [
    ...mostrados.map((l) => celulasMeta(curto(l.nome, 40), l)),
    ...(resto.length ? [celulasMeta(`Outros (${resto.length})`, resto.reduce(somarMeta))] : []),
  ];
}
// sem "Alcance": o alcance somado de vários conjuntos não é o alcance real, e assim os valores cabem sem quebrar
const CABECALHO_META = ["", "Resultados", "Custo por resultado", "Valor gasto", "Impressões", "Cliques no link", "CPC", "CTR", "CPM"];

/** Ordem dos slides de qualificação: público e anúncio primeiro. */
export const ORDEM_QUALIFICACAO: DimensaoUtm[] = ["utm_medium", "utm_content", "utm_campaign", "utm_term", "utm_source"];

/** Como cada UTM aparece no título e na tabela do slide de qualificação. */
export const TITULO_QUALIFICACAO: Record<DimensaoUtm, string> = {
  utm_medium: "Público", utm_content: "Anúncio", utm_campaign: "Campanha", utm_term: "Termo", utm_source: "Origem",
};

/** Soma o funil de vários grupos de UTM (passos pelo nome). */
function somarFunil(a: NumerosFunil, b: NumerosFunil): NumerosFunil {
  const passos = [...a.passos.map((p) => ({ ...p }))];
  for (const p of b.passos) {
    const x = passos.find((y) => y.nome === p.nome);
    if (x) x.valor += p.valor;
    else passos.push({ ...p });
  }
  return { leads: a.leads + b.leads, vendas: a.vendas + b.vendas, faturamento: a.faturamento + b.faturamento, valorPropostas: a.valorPropostas + b.valorPropostas, passos };
}

const VERBO: Record<string, string> = {
  pausar: "Pausamos", ativar: "Ativamos", orcamento: "Ajustamos o orçamento de", duplicar: "Duplicamos", montar: "Criamos", editar: "Editamos",
};

const diaCurto = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(new Date(iso));

/** Tipos do histórico do Meta que interessam ao cliente: criar, pausar/ativar, orçamento, público, lance, criativo. */
const ATIVIDADE_RELEVANTE = /create|run_status|budget|target|bid|creative|optimization|schedule/i;
const ATIVIDADE_IGNORADA = /review|billing|funding|payment|account_|spend_limit|delete|archive/i;

/** Orçamento antes → depois no extra_data do Meta (centavos), quando vier. */
function mudancaDeOrcamento(extra?: string) {
  try {
    const j = JSON.parse(extra ?? "{}");
    const valor = (x: unknown): number | null => {
      if (x == null) return null;
      if (typeof x === "number") return x;
      if (typeof x === "object") return valor((x as Record<string, unknown>).old_value ?? (x as Record<string, unknown>).new_value ?? (x as Record<string, unknown>).value);
      const n = Number(x);
      return Number.isFinite(n) ? n : null;
    };
    const antes = valor(j.old_value), depois = valor(j.new_value);
    if (antes == null || depois == null) return "";
    return ` de ${dinheiro(antes / 100)} para ${dinheiro(depois / 100)}`;
  } catch {
    return "";
  }
}

/**
 * Ações do período para o slide "Ações realizadas": o histórico de atividades do Meta (o que foi feito pelo
 * Gerenciador ou pelo painel) e as ações do painel no Google. Repetições do mesmo item no mesmo dia viram uma linha.
 */
export async function acoesDoPeriodo(clienteId: string, desde: string, ate: string) {
  const banco = db();
  const [{ data: log }, { data: contas }] = await Promise.all([
    banco.from("acoes_log").select("criado_em, acao, nivel, objeto_nome, depois, plataforma")
      .eq("cliente_id", clienteId).eq("ok", true).gte("criado_em", `${desde}T00:00:00-03:00`).lte("criado_em", `${ate}T23:59:59-03:00`)
      .order("criado_em").limit(50),
    banco.from("contas_anuncio").select("*").eq("cliente_id", clienteId),
  ]);
  type Linha = { quando: string; texto: string };
  const linhas: Linha[] = [];
  let leuMeta = false;
  for (const c of (contas ?? []) as ContaAnuncio[]) {
    const token = await tokenDaConta(c);
    if (!token) continue;
    const atividades = await atividadesDaConta(c.id, token, desde, ate).catch(() => null);
    if (!atividades) continue;
    leuMeta = true;
    for (const a of atividades) {
      if (!ATIVIDADE_RELEVANTE.test(a.event_type) || ATIVIDADE_IGNORADA.test(a.event_type)) continue;
      const oque = a.translated_event_type || a.event_type.replace(/_/g, " ");
      const extra = /budget/i.test(a.event_type) ? mudancaDeOrcamento(a.extra_data) : "";
      linhas.push({ quando: a.event_time, texto: `${oque}${a.object_name ? ` “${curto(a.object_name, 40)}”` : ""}${extra}` });
    }
  }
  // do painel: sempre o Google; o Meta só se o histórico do Meta não pôde ser lido (senão apareceria duas vezes)
  type Log = { criado_em: string; acao: string; nivel: string | null; objeto_nome: string | null; depois: string | null; plataforma: string };
  for (const a of (log ?? []) as Log[]) {
    if (a.plataforma === "meta" && leuMeta) continue;
    const oque = `${a.nivel ?? "item"} “${curto(a.objeto_nome ?? "", 40)}”`;
    const extra = a.acao === "orcamento" && a.depois ? ` para ${a.depois}` : "";
    linhas.push({ quando: a.criado_em, texto: `${VERBO[a.acao] ?? a.acao} ${oque}${extra}${a.plataforma === "google" ? " (Google)" : ""}` });
  }
  const vistos = new Set<string>();
  return linhas
    .sort((a, b) => a.quando.localeCompare(b.quando))
    .map((l) => `${diaCurto(l.quando)}: ${l.texto.charAt(0).toUpperCase()}${l.texto.slice(1)}`)
    .filter((t) => !vistos.has(t) && vistos.add(t))
    .slice(-12);
}

/** Gera o relatório: copia o modelo (o da empresa do cliente, ou o escolhido), preenche e devolve o link. */
export async function gerarRelatorio(p: PedidoRelatorio) {
  const { data: emp } = await db().from("clientes").select("empresa").eq("id", p.clienteId).maybeSingle();
  const cfg = await configEmpresa(p.empresaModelo || (emp?.empresa as string | null));
  tema = temaDaEmpresa(cfg);
  try {
    return await preencherRelatorio(p, cfg);
  } finally {
    tema = TEMA_PADRAO;
  }
}

async function preencherRelatorio(p: PedidoRelatorio, cfg: ConfigEmpresa) {
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
  const ant = periodoAnterior(p.desde, p.ate);
  const anteriorP = periodo(ant.desde, ant.ate);
  const novo = cfg.layout !== "completo";
  const [meta, crm, google, { meses }, funil, acoes, destaques] = await Promise.all([
    detalheCliente(p.clienteId, atual, anteriorP),
    detalheCrm(p.clienteId, atual, anteriorP).catch(() => null),
    detalheGoogle(p.clienteId, atual, anteriorP).catch(() => null),
    lerHistorico(p.clienteId),
    funilDoCliente(p.clienteId),
    acoesDoPeriodo(p.clienteId, p.desde, p.ate),
    // sem IA (ou se falhar): o slide fica com um texto para você escrever
    novo && p.resumoIA !== false
      ? destaquesIA(p.clienteId, atual, anteriorP).catch((e) => `• (Não consegui escrever com a IA: ${e instanceof Error ? e.message.slice(0, 120) : e}. Escreva aqui os destaques do período.)`)
      : Promise.resolve("• Escreva aqui os destaques do período."),
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
  const valorPropostas = soma ? soma.valorPropostas : aoVivo?.valorPropostas ?? null;
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
  const copiar = (modeloId: string) => api<{ id: string }>(acesso, `${DRIVE}/files/${modeloId}/copy?fields=id&supportsAllDrives=true`, {
    method: "POST",
    body: JSON.stringify({ name: `Relatório ${cliente.nome} · ${rotuloPer}`, ...(pasta && { parents: [pasta] }) }),
  });
  const copia = await copiar(await idDoModeloEmpresa(cfg, config, acesso))
    // modelo apagado no Drive: sobe de novo (nas cores da empresa) e tenta mais uma vez
    .catch(async (e) => (/não encontrado/i.test(String(e)) ? copiar(await idDoModeloEmpresa(cfg, config, acesso, true)) : Promise.reject(e)))
    .catch((e) => {
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
  if (slideFunil && novo && !temCrm) {
    reqs.push({ deleteObject: { objectId: slideFunil.objectId } });
  } else if (slideFunil) {
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
      etapas.map((e) => ({ nome: e.nome, valor: inteiro(e.valor), taxa: e.taxa })), dinheiro(gasto), dinheiro(faturamento),
      valorPropostas ? dinheiro(valorPropostas) : null));
  }
  trocar("{{acoes}}", [...acoes, "Próximos passos: "].join("\n"));
  trocar("{{analise}}", destaques);

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

  const totalMeta = celulasMeta("Total", { ...meta.atual, nome: "Total" });
  preencher("tabela:conjuntos", meta.conjuntos.length
    ? (pg, c) => tabela(pg, c, [p.agrupar ? "Público" : "Conjunto de anúncios", ...CABECALHO_META.slice(1)],
        linhasMeta(meta.conjuntos, "gasto", p.agrupar ? "publico" : null), { total: totalMeta, larguraPrimeira: 0.3 })
    : null);
  preencher("tabela:anuncios", meta.anuncios.length
    ? (pg, c) => tabela(pg, c, ["Anúncio", ...CABECALHO_META.slice(1)],
        linhasMeta(meta.anuncios, "resultados", p.agrupar ? "anuncio" : null), { total: totalMeta, larguraPrimeira: 0.3 })
    : null);
  const campanhasG = (google?.campanhas ?? []).filter((x) => x.gasto > 0);
  preencher("tabela:google", campanhasG.length
    ? (pg, c) => tabela(pg, c, ["Campanha", "Conversões", "Custo por conversão", "Valor gasto", "Impressões", "Cliques", "CPC", "CTR"],
        campanhasG.slice(0, LINHAS_POR_TABELA + 1).map((x) => [curto(x.nome), inteiro(x.conversoes), dinheiro(x.cpa), dinheiro(x.gasto), inteiro(x.impressoes), inteiro(x.cliques), dinheiro(x.cpc), pct(x.ctr)]),
        { total: ["Total", inteiro(google!.atual.conversoes), dinheiro(google!.atual.cpa), dinheiro(google!.atual.gasto), inteiro(google!.atual.impressoes), inteiro(google!.atual.cliques), dinheiro(google!.atual.cpc), pct(google!.atual.ctr)], larguraPrimeira: 0.32 })
    : null);
  // Qualificação: um slide para cada UTM escolhida (público, anúncio, campanha…); nenhuma = sem o slide
  // investido de cada UTM: gasto do anúncio/conjunto/campanha com o mesmo nome
  const gastos = {
    campanha: gastoPorNome([...meta.campanhas, ...(google?.campanhas ?? [])]),
    conjunto: gastoPorNome(meta.conjuntos),
    anuncio: gastoPorNome(meta.anuncios),
  };
  type LinhaQ = { nome: string; funil: NumerosFunil; gasto: number | null };
  const somarQ = (a: LinhaQ, b: LinhaQ): LinhaQ => ({
    nome: a.nome, funil: somarFunil(a.funil, b.funil), gasto: a.gasto == null && b.gasto == null ? null : (a.gasto ?? 0) + (b.gasto ?? 0),
  });
  const linhasQualificacao = (d: DimensaoUtm): LinhaQ[] => {
    const nivel = NIVEL_DA_UTM[d];
    const bruto = (crm?.porUtm[d] ?? []).filter((x) => x.funil.leads || x.funil.vendas)
      .map((x) => ({ nome: x.nome, funil: x.funil, gasto: nivel && x.nome !== "(sem UTM)" ? gastos[nivel].get(chaveDe(x.nome)) ?? null : null }));
    // UTMs com o nome do conjunto/anúncio: junta os do mesmo público, como nas tabelas do Meta
    const grupos = (p.agrupar && d !== "utm_source"
      ? agruparPorNome(bruto, (x) => x.nome,
          (n) => (n === "(sem UTM)" ? n : d === "utm_content" ? nomeDoAnuncio(n) : nomeDoPublico(n)), somarQ)
          .map((g) => ({ ...g.item, nome: g.juntos > 1 ? `${curto(g.nome, 40)} (${g.juntos}x)` : g.nome }))
      : bruto)
      .sort((a, b) => Number(a.nome === "(sem UTM)") - Number(b.nome === "(sem UTM)") || b.funil.faturamento - a.funil.faturamento || b.funil.vendas - a.funil.vendas || b.funil.leads - a.funil.leads);
    const mostrados = grupos.length > LINHAS_POR_TABELA + 1 ? grupos.slice(0, LINHAS_POR_TABELA) : grupos;
    const resto = grupos.slice(mostrados.length);
    return [...mostrados, ...(resto.length ? [{ ...resto.reduce(somarQ), nome: `Outros (${resto.length})` }] : [])];
  };
  const qualificacoes = p.qualificacoes.map((d) => ({ d, linhas: linhasQualificacao(d) })).filter((q) => q.linhas.length);
  const mq = marcadores.get("tabela:qualificacao");
  // Motivos de perda (opcional): cópia do slide de qualificação com a tabela dos motivos. Criada antes das cópias
  // da qualificação, fica depois delas.
  const perdas = p.motivosPerda && crm ? crm.motivosPerda : null;
  if (mq && perdas?.total) {
    const slide = novoId("mp"), elemento = novoId("mpe");
    reqs.push({ duplicateObject: { objectId: mq.slide, objectIds: { [mq.slide]: slide, [mq.elemento]: elemento } } });
    reqs.push({ replaceAllText: { containsText: { text: "Qualificação por público", matchCase: false }, replaceText: "Motivos de perda", pageObjectIds: [slide] } });
    reqs.push({ deleteObject: { objectId: elemento } });
    const lista = perdas.lista;
    const mostrados = lista.length > LINHAS_POR_TABELA + 1 ? lista.slice(0, LINHAS_POR_TABELA) : lista;
    const resto = lista.slice(mostrados.length);
    const linhas = [...mostrados, ...(resto.length ? [{ motivo: `Outros (${resto.length})`, total: resto.reduce((t, x) => t + x.total, 0), valor: resto.reduce((t, x) => t + x.valor, 0) }] : [])];
    const temValor = lista.some((x) => x.valor > 0);
    reqs.push(...tabela(slide, { ...mq.caixa, h: alturaSlide - mq.caixa.y - 150_000 },
      ["Motivo", "Perdidos", "% dos perdidos", ...(temValor ? ["Valor perdido"] : [])],
      linhas.map((x) => [curto(x.motivo, 60), inteiro(x.total), pct(taxa(x.total, perdas.total)), ...(temValor ? [dinheiro(x.valor)] : [])]),
      { total: ["Total", inteiro(perdas.total), "100%", ...(temValor ? [dinheiro(lista.reduce((t, x) => t + x.valor, 0))] : [])], larguraPrimeira: 0.5 }));
  }
  if (mq) {
    if (!qualificacoes.length) reqs.push({ deleteObject: { objectId: mq.slide } });
    else {
      // o primeiro usa o slide do modelo; os outros são cópias dele (na ordem escolhida, logo depois)
      const slides = qualificacoes.map((_, i) => (i === 0 ? { slide: mq.slide, elemento: mq.elemento } : { slide: novoId("q"), elemento: novoId("qm") }));
      for (let i = qualificacoes.length - 1; i > 0; i--) {
        reqs.push({ duplicateObject: { objectId: mq.slide, objectIds: { [mq.slide]: slides[i].slide, [mq.elemento]: slides[i].elemento } } });
      }
      qualificacoes.forEach((q, i) => {
        const { slide, elemento } = slides[i];
        const titulo = TITULO_QUALIFICACAO[q.d];
        reqs.push({ replaceAllText: { containsText: { text: "Qualificação por público", matchCase: false }, replaceText: `Qualificação por ${titulo.toLowerCase()}`, pageObjectIds: [slide] } });
        reqs.push({ deleteObject: { objectId: elemento } });
        reqs.push(...tabela(slide, { ...mq.caixa, h: alturaSlide - mq.caixa.y - 150_000 },
          [titulo, funil.leads, ...nomesPassos, funil.vendas, `${funil.leads} → ${funil.vendas.toLowerCase()}`, "Valor das vendas",
            ...(NIVEL_DA_UTM[q.d] ? ["Investido"] : [])],
          q.linhas.map((x) => [
            curto(x.nome, nomesPassos.length > 2 ? 42 : 52), inteiro(x.funil.leads), ...nomesPassos.map((n) => inteiro(x.funil.passos.find((y) => y.nome === n)?.valor)),
            inteiro(x.funil.vendas), pct(taxa(x.funil.vendas, x.funil.leads)), dinheiro(x.funil.faturamento),
            ...(NIVEL_DA_UTM[q.d] ? [dinheiro(x.gasto)] : []),
          ]),
          { larguraPrimeira: nomesPassos.length > 2 ? 0.27 : 0.34 }));
      });
    }
  }
  // Vendas realizadas: dois slides, cada um com um gráfico na largura toda (lado a lado ficava apertado em
  // clientes com muitos meses): o número de vendas e, no seguinte, o valor das vendas.
  // Com o marcador {{grafico:vendas}} no modelo, o slide dele é o do número e uma cópia é a do valor; sem ele,
  // as duas são cópias do slide de oportunidades (logo depois dele).
  const graficoNumVendas = (pg: string, c: Caixa): Req[] =>
    grafico(pg, c, "Vendas realizadas", categorias, [{ nome: `Nº ${funil.vendas}`, valores: valoresDe((m) => m.vendas, vendas) }], (v) => inteiro(v));
  const graficoValorVendas = (pg: string, c: Caixa): Req[] =>
    grafico(pg, c, "Valor das vendas", categorias, [{ nome: "Valor", valores: valoresDe((m) => m.faturamento, faturamento) }], moedaCurta);
  /** Copia o slide do marcador (a cópia fica logo depois do original), troca os textos e desenha o gráfico. */
  const copiaCom = (m: { slide: string; elemento: string; caixa: Caixa }, trocas: [string, string][], gerar: (pg: string, c: Caixa) => Req[]) => {
    const slide = novoId("vd"), elemento = novoId("vde");
    reqs.push({ duplicateObject: { objectId: m.slide, objectIds: { [m.slide]: slide, [m.elemento]: elemento } } });
    for (const [de, para] of trocas) reqs.push({ replaceAllText: { containsText: { text: de, matchCase: false }, replaceText: para, pageObjectIds: [slide] } });
    reqs.push({ deleteObject: { objectId: elemento } });
    reqs.push(...gerar(slide, m.caixa));
  };
  const querVendas = (p.vendas ?? true) && temCrm;
  const mv = marcadores.get("grafico:vendas");
  if (mv) {
    // a cópia (valor) é feita antes de preencher o original, que apaga o marcador
    if (querVendas) copiaCom(mv, [["Vendas realizadas", "Valor das vendas"], ["Nº de vendas", "Valor das vendas"]], graficoValorVendas);
    preencher("grafico:vendas", querVendas ? graficoNumVendas : null);
  } else if (querVendas) {
    const mo = marcadores.get("grafico:oportunidades");
    if (mo) {
      // cada cópia entra logo depois do original: primeiro a do valor, depois a do número (que fica no meio)
      copiaCom(mo, [["das oportunidades", "do valor das vendas"], ["oportunidades", "valor das vendas"]], graficoValorVendas);
      copiaCom(mo, [["oportunidades", "vendas"]], graficoNumVendas);
    }
  }
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
  // ----- slides dos modelos novos -----
  // resumo: cartões com os principais números e a variação contra o período anterior
  const mesAnt = cobreMeses && p.desde.endsWith("-01") ? meses.find((m) => m.mes === mesDe(ant.desde)) ?? null : null;
  const gastoAnt = mesAnt?.investimento ?? meta.anterior.gasto + (google?.anterior.gasto ?? 0);
  const funilAnt = crm?.anterior?.funil;
  const leadsAnt = mesAnt?.leads ?? (funilAnt ? funilAnt.leads : Math.round(meta.anterior.resultados + (google?.anterior.conversoes ?? 0)));
  const vendasAnt = mesAnt?.vendas ?? funilAnt?.vendas ?? null;
  const fatAnt = mesAnt?.faturamento ?? funilAnt?.faturamento ?? null;
  const varPct = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? ((a - b) / b) * 100 : null);
  const div = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? a / b : null);
  const comparado = (() => {
    if (p.desde.endsWith("-01") && ant.desde.endsWith("-01")) { const n = nomeMes(ant.desde, false); return n[0].toUpperCase() + n.slice(1); }
    return "período anterior";
  })();
  const cpl = div(gasto, leads), cplAnt = div(gastoAnt, leadsAnt);
  const cartoes: Cartao[] = [
    { rotulo: "Investimento", valor: dinheiro(gasto), variacao: varPct(gasto, gastoAnt), melhorMaior: null, comparado },
    { rotulo: funil.leads, valor: inteiro(leads), variacao: varPct(leads, leadsAnt), melhorMaior: true, comparado },
    { rotulo: `Custo por ${funil.leads.toLowerCase().replace(/s$/, "")}`, valor: dinheiro(cpl), variacao: varPct(cpl, cplAnt), melhorMaior: false, comparado },
    { rotulo: "CTR (Meta)", valor: pct(meta.atual.ctr), variacao: varPct(meta.atual.ctr, meta.anterior.ctr), melhorMaior: true, comparado },
    ...(temCrm ? [
      { rotulo: funil.vendas, valor: inteiro(vendas), variacao: varPct(vendas, vendasAnt), melhorMaior: true, comparado },
      { rotulo: "Faturamento", valor: dinheiro(faturamento), variacao: varPct(faturamento, fatAnt), melhorMaior: true, comparado },
      { rotulo: "Retorno (faturamento ÷ investimento)", valor: faturamento && gasto ? `${(faturamento / gasto).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}x` : "—", variacao: varPct(div(faturamento, gasto), div(fatAnt, gastoAnt)), melhorMaior: true, comparado },
      { rotulo: `Taxa ${funil.leads.toLowerCase()} → ${funil.vendas.toLowerCase()}`, valor: pct(taxa(vendas, leads)), variacao: varPct(taxa(vendas, leads), taxa(vendasAnt, leadsAnt)), melhorMaior: true, comparado },
    ] : [
      { rotulo: "Cliques no link", valor: inteiro(meta.atual.cliques_link), variacao: varPct(meta.atual.cliques_link, meta.anterior.cliques_link), melhorMaior: true, comparado },
      { rotulo: "CPM (custo por mil)", valor: dinheiro(meta.atual.cpm), variacao: varPct(meta.atual.cpm, meta.anterior.cpm), melhorMaior: false, comparado },
      { rotulo: "Impressões", valor: inteiro(meta.atual.impressoes), variacao: varPct(meta.atual.impressoes, meta.anterior.impressoes), melhorMaior: true, comparado },
      { rotulo: "Frequência", valor: meta.atual.frequencia ? meta.atual.frequencia.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "—", variacao: null, melhorMaior: null, comparado },
    ]),
  ];
  preencher("tabela:resumo", (pg, c) => cartoesResumo(pg, c, cartoes));
  preencher("grafico:resultados", (pg, c) => grafico(pg, c, `${funil.leads} por mês`, categorias, [
    { nome: funil.leads, valores: valoresDe((m) => m.leads, leads) },
  ], (v) => inteiro(v)));
  preencher("grafico:custo", (pg, c) => grafico(pg, c, `Custo por ${funil.leads.toLowerCase().replace(/s$/, "")}`, categorias, [
    { nome: "Custo", valores: valoresDe((m) => m.cpl, cpl) },
  ], dinheiro));

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
