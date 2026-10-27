import { NextResponse, type NextRequest } from "next/server";
import { gravarHistorico, trazerCrmDoPeriodo } from "@/lib/historico";

export const maxDuration = 300;

const MES = /^\d{4}-\d{2}-01$/;

// "Buscar o passado" em etapas, cada uma numa chamada (protegido pelo login do painel):
//   { etapa: "crm", clienteId, desde, cursor? } → traz do CRM uma parte dos negócios desde o mês; repetir com o cursor até vir null
//   { etapa: "mes", clienteId, mes }            → grava um mês (Meta + Google + funil do CRM)
export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  const clienteId = String(corpo.clienteId ?? "");
  try {
    switch (corpo.etapa) {
      case "crm":
        if (!MES.test(String(corpo.desde))) throw new Error("mês inválido");
        return NextResponse.json(await trazerCrmDoPeriodo(clienteId, String(corpo.desde), corpo.cursor ?? null));
      case "mes":
        if (!MES.test(String(corpo.mes))) throw new Error("mês inválido");
        return NextResponse.json(await gravarHistorico(clienteId, String(corpo.mes), String(corpo.mes)));
      default:
        return NextResponse.json({ erro: "etapa inválida" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
