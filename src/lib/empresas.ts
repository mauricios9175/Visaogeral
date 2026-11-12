import "server-only";
import { db, EMPRESA_PADRAO } from "./db";

// Empresas (para quem você atende o cliente: agências parceiras e os seus clientes próprios), cada uma com o seu
// relatório: o layout, as cores, a fonte, se recebe relatório mensal e o modelo dela no Google Drive.
// Nada fica preso no código: as empresas vêm dos clientes e a configuração fica em configuracoes ("empresas").

/** Layouts de relatório (os arquivos-base em /modelos). */
export type LayoutRelatorio = "completo" | "mensal" | "simples";

export const LAYOUTS: Record<LayoutRelatorio, { nome: string; descricao: string; arquivo: string; base: { primaria: string; destaque: string; fonte: string } }> = {
  completo: {
    nome: "Completo", arquivo: "relatorio-propulsao.pptx",
    descricao: "Públicos, anúncios, Google, qualificação por UTM, funil do CRM, gráficos e ações (como o da Propulsão).",
    base: { primaria: "6900AF", destaque: "6FE9FF", fonte: "Saira" },
  },
  mensal: {
    nome: "Mensal com destaques", arquivo: "relatorio-proprio.pptx",
    descricao: "Resumo com os principais números comparados ao mês anterior, destaques escritos pela IA, funil (se tiver CRM), gráficos, anúncios e ações.",
    base: { primaria: "1E3A8A", destaque: "F59E0B", fonte: "Poppins" },
  },
  simples: {
    nome: "Simples", arquivo: "relatorio-viccon.pptx",
    descricao: "Resumo comparado, destaques da IA, públicos, anúncios, Google e gráficos (sem funil de CRM).",
    base: { primaria: "0F172A", destaque: "14B8A6", fonte: "Inter" },
  },
};

export const FONTES = ["Saira", "Montserrat", "Poppins", "Inter", "Roboto", "Open Sans", "Lato", "Nunito", "Raleway", "Oswald"];

export type ConfigEmpresa = {
  nome: string;
  layout: LayoutRelatorio;
  relatorioMensal: boolean;     // entra nas sugestões de tarefa do começo do mês e no checklist de implantação
  primaria: string;             // cor principal (hex sem #)
  destaque: string;             // cor de destaque
  fonte: string;
  modeloId?: string;            // o modelo desta empresa no Google Drive (criado no primeiro relatório)
  modeloCores?: string;         // cores/fonte com que o modelo do Drive foi pintado (para repintar se mudarem)
};

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
export const chaveEmpresa = (nome: string) => sem(nome).replace(/\s+/g, " ");

/** Padrão de uma empresa ainda não configurada (as três de hoje mantêm o que já tinham). */
function padrao(nome: string): ConfigEmpresa {
  const k = chaveEmpresa(nome);
  const layout: LayoutRelatorio = k.includes("propulsao") ? "completo" : k.includes("viccon") ? "simples" : "mensal";
  const base = LAYOUTS[layout].base;
  return { nome, layout, relatorioMensal: !k.includes("viccon"), primaria: base.primaria, destaque: base.destaque, fonte: base.fonte };
}

type Salvo = Record<string, ConfigEmpresa>;

async function lerSalvo(): Promise<Salvo> {
  const { data } = await db().from("configuracoes").select("valor").eq("chave", "empresas").maybeSingle();
  return (data?.valor && typeof data.valor === "object" ? data.valor : {}) as Salvo;
}

async function gravar(s: Salvo) {
  const { error } = await db().from("configuracoes").upsert({ chave: "empresas", valor: s, atualizado_em: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

/**
 * Modelos que já estavam no Drive antes desta tela (o da Propulsão em relatorio_slides; o dos próprios e o da
 * Viccon em relatorio_modelos): continuam sendo usados pelas mesmas empresas.
 */
async function modelosAntigos(): Promise<{ propulsao?: string; proprio?: string; viccon?: string }> {
  const { data } = await db().from("configuracoes").select("chave, valor").in("chave", ["relatorio_slides", "relatorio_modelos"]);
  const m = new Map(((data ?? []) as { chave: string; valor: Record<string, string> }[]).map((x) => [x.chave, x.valor]));
  return { propulsao: m.get("relatorio_slides")?.modeloId, proprio: m.get("relatorio_modelos")?.proprio, viccon: m.get("relatorio_modelos")?.viccon };
}

/** Todas as empresas (as dos clientes, ativos ou não, e as já configuradas), com a configuração de cada uma. */
export async function listarEmpresas(): Promise<(ConfigEmpresa & { clientes: number; ativos: number })[]> {
  const [{ data }, salvo, antigos] = await Promise.all([db().from("clientes").select("empresa, ativo"), lerSalvo(), modelosAntigos()]);
  const contagem = new Map<string, { nome: string; clientes: number; ativos: number }>();
  for (const c of (data ?? []) as { empresa: string | null; ativo: boolean | null }[]) {
    const nome = c.empresa || EMPRESA_PADRAO;
    const k = chaveEmpresa(nome);
    const x = contagem.get(k) ?? { nome, clientes: 0, ativos: 0 };
    x.clientes++;
    if (c.ativo !== false) x.ativos++;
    contagem.set(k, x);
  }
  if (!contagem.has(chaveEmpresa(EMPRESA_PADRAO))) contagem.set(chaveEmpresa(EMPRESA_PADRAO), { nome: EMPRESA_PADRAO, clientes: 0, ativos: 0 });
  for (const [k, c] of Object.entries(salvo)) if (!contagem.has(k)) contagem.set(k, { nome: c.nome, clientes: 0, ativos: 0 });
  return [...contagem.entries()].map(([k, x]) => {
    const cfg = { ...padrao(x.nome), ...salvo[k], nome: salvo[k]?.nome ?? x.nome };
    if (!cfg.modeloId) {
      // modelo que já existia no Drive: o completo era o da Propulsão; o mensal, o dos próprios; o simples, o da Viccon
      const antigo = k.includes("propulsao") ? antigos.propulsao : k === chaveEmpresa(EMPRESA_PADRAO) ? antigos.proprio : k.includes("viccon") ? antigos.viccon : undefined;
      if (antigo) Object.assign(cfg, { modeloId: antigo, modeloCores: corDoModelo(padrao(x.nome)) });
    }
    return { ...cfg, clientes: x.clientes, ativos: x.ativos };
  }).sort((a, b) => Number(a.nome === EMPRESA_PADRAO) - Number(b.nome === EMPRESA_PADRAO) || b.ativos - a.ativos || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Configuração da empresa (pelo nome; vazio = clientes próprios). */
export async function configEmpresa(nome: string | null | undefined): Promise<ConfigEmpresa> {
  const n = nome || EMPRESA_PADRAO;
  const todas = await listarEmpresas();
  return todas.find((e) => chaveEmpresa(e.nome) === chaveEmpresa(n)) ?? padrao(n);
}

/** Assinatura das cores e fonte (para saber se o modelo do Drive precisa ser repintado). */
export const corDoModelo = (c: Pick<ConfigEmpresa, "primaria" | "destaque" | "fonte" | "layout">) => `${c.layout}|${c.primaria}|${c.destaque}|${c.fonte}`;

const hex = (v: unknown, padrao: string) => {
  const s = String(v ?? "").replace("#", "").trim().toUpperCase();
  return /^[0-9A-F]{6}$/.test(s) ? s : padrao;
};

/**
 * Salva a empresa. Mudou o nome: renomeia em todos os clientes. Mudou o layout: o modelo do Drive é refeito no próximo
 * relatório (o antigo continua lá, não é apagado). Mudou cor/fonte: o modelo é repintado no próximo relatório.
 */
export async function salvarEmpresa(nomeAtual: string, e: Partial<ConfigEmpresa>) {
  const salvo = await lerSalvo();
  const atual = await configEmpresa(nomeAtual);
  const nome = String(e.nome ?? atual.nome).trim().slice(0, 60) || atual.nome;
  const layout = e.layout && e.layout in LAYOUTS ? e.layout : atual.layout;
  const nova: ConfigEmpresa = {
    nome, layout,
    relatorioMensal: e.relatorioMensal ?? atual.relatorioMensal,
    primaria: hex(e.primaria, atual.primaria), destaque: hex(e.destaque, atual.destaque),
    fonte: e.fonte && FONTES.includes(e.fonte) ? e.fonte : atual.fonte,
    // layout novo = arquivo novo no Drive
    ...(layout === atual.layout && atual.modeloId ? { modeloId: atual.modeloId, modeloCores: atual.modeloCores } : {}),
  };
  const kAntiga = chaveEmpresa(nomeAtual), kNova = chaveEmpresa(nome);
  if (kNova !== kAntiga) {
    if (salvo[kNova] && kNova !== kAntiga) throw new Error(`Já existe a empresa “${salvo[kNova].nome}”.`);
    // renomeia nos clientes (clientes próprios ficam gravados como o nome novo também)
    const { data } = await db().from("clientes").select("id, empresa");
    const ids = ((data ?? []) as { id: string; empresa: string | null }[]).filter((c) => chaveEmpresa(c.empresa || EMPRESA_PADRAO) === kAntiga).map((c) => c.id);
    if (ids.length) {
      const { error } = await db().from("clientes").update({ empresa: nome }).in("id", ids);
      if (error) throw new Error(error.message);
    }
    delete salvo[kAntiga];
  }
  salvo[kNova] = nova;
  await gravar(salvo);
  return nova;
}

/** Guarda o id (e as cores) do modelo da empresa no Drive. */
export async function guardarModeloEmpresa(nome: string, modeloId: string, cores: string) {
  const salvo = await lerSalvo();
  const atual = await configEmpresa(nome);
  salvo[chaveEmpresa(nome)] = { ...atual, modeloId, modeloCores: cores };
  await gravar(salvo);
}

// ---------- Cores do relatório (tabelas, gráficos e funil) a partir das duas cores escolhidas ----------

const mistura = (a: string, b: string, t: number) => {
  const c = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return [0, 2, 4].map((i) => Math.round(c(a, i) + (c(b, i) - c(a, i)) * t).toString(16).padStart(2, "0")).join("").toUpperCase();
};

export type TemaRelatorio = { primaria: string; paleta: string[]; fonte: string; fonteFunil: string; clara: string; escura: string; media: string };

export function temaDaEmpresa(c: Pick<ConfigEmpresa, "primaria" | "destaque" | "fonte" | "layout">): TemaRelatorio {
  // o completo com as cores originais fica idêntico ao modelo da Propulsão de antes
  if (c.layout === "completo" && c.primaria === "6900AF" && c.destaque === "6FE9FF" && c.fonte === "Saira") {
    return { primaria: "6900AF", paleta: ["6900AF", "B57BEE", "1FB5CC", "F2A900", "E0559B", "4C7BE0", "2FA36B"], fonte: "Saira", fonteFunil: "Montserrat", clara: "F1E6FA", escura: "4B0A86", media: "8A5BB5" };
  }
  return {
    primaria: c.primaria,
    paleta: [c.primaria, c.destaque, mistura(c.primaria, "FFFFFF", 0.45), "10B981", "EF4444", "0EA5E9", "F59E0B"],
    fonte: c.fonte, fonteFunil: c.fonte,
    clara: mistura(c.primaria, "FFFFFF", 0.9), escura: mistura(c.primaria, "000000", 0.25), media: mistura(c.primaria, "FFFFFF", 0.35),
  };
}
