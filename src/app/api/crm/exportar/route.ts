import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { buscarTudo } from "@/lib/consultas";

// Planilha (CSV) dos negócios do CRM de um cliente no período, com as UTMs.
// Protegida pelo login do painel (proxy.ts). Separador ";" e vírgula decimal para abrir direto no Excel em português.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const cliente = q.get("cliente") ?? "";
  const de = q.get("de") ?? "", ate = q.get("ate") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(cliente) || !/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
    return new Response("Parâmetros inválidos", { status: 400 });
  }
  const banco = db();
  const { data: c } = await banco.from("clientes").select("nome").eq("id", cliente).maybeSingle();
  // margem de um dia por causa do fuso; o filtro exato é feito abaixo, no horário de Brasília
  const inicio = `${de}T00:00:00-03:00`, fim = `${ate}T23:59:59-03:00`;
  const colunas = "nome, criado_em, fechado_em, ganho, valor, pipeline_nome, etapa_nome, origem, responsavel, campos";
  const buscar = (cols: string) => buscarTudo<Record<string, unknown>>((a, b) =>
    banco.from("crm_negocios").select(cols).eq("cliente_id", cliente)
      .or(`and(criado_em.gte.${inicio},criado_em.lte.${fim}),and(fechado_em.gte.${inicio},fechado_em.lte.${fim})`)
      .order("criado_em").range(a, b),
  );
  const linhas = await buscar(`${colunas}, utm_source, utm_medium, utm_campaign, utm_content, utm_term`).catch(() => buscar(colunas));

  const data = (iso: unknown) =>
    iso ? new Date(String(iso)).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";
  const status = (g: unknown) => (g === true ? "Ganho" : g === false ? "Perdido" : "Em aberto");
  const camposExtras = [...new Set(linhas.flatMap((l) => Object.keys((l.campos as Record<string, string>) ?? {})))].sort();
  const cabecalho = [
    "Negócio", "Criado em", "Fechado em", "Status", "Valor", "Funil", "Etapa", "Fonte no CRM",
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "Responsável", ...camposExtras,
  ];
  const celula = (v: unknown) => {
    const t = v == null ? "" : String(v);
    return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const corpo = linhas.map((l) => [
    l.nome, data(l.criado_em), data(l.fechado_em), status(l.ganho),
    Number(l.valor ?? 0).toFixed(2).replace(".", ","), l.pipeline_nome, l.etapa_nome, l.origem,
    l.utm_source, l.utm_medium, l.utm_campaign, l.utm_content, l.utm_term, l.responsavel,
    ...camposExtras.map((k) => ((l.campos as Record<string, string>) ?? {})[k]),
  ].map(celula).join(";"));

  const nome = `crm-${String(c?.nome ?? "cliente").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]+/g, "-").toLowerCase()}-${de}-a-${ate}.csv`;
  // BOM para o Excel reconhecer os acentos
  return new Response("\uFEFF" + [cabecalho.map(celula).join(";"), ...corpo].join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}
