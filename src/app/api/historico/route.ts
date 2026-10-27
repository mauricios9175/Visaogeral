import { NextResponse, type NextRequest } from "next/server";
import { blocosDeMeses, gravarHistorico, trazerCrmDoPeriodo } from "@/lib/historico";

export const maxDuration = 300;

// "Buscar o passado" em etapas, cada uma numa chamada (protegido pelo login do painel):
//   { etapa: "crm", clienteId, meses, cursor? }     → traz do CRM uma parte dos negócios; repetir com o cursor até vir null
//   { etapa: "meses", clienteId, desde, ate }       → grava um bloco de meses (Meta + Google + funil do CRM)
//   { etapa: "blocos", meses }                      → lista os blocos de meses a gravar
export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  const clienteId = String(corpo.clienteId ?? "");
  const meses = Math.min(Math.max(Number(corpo.meses) || 12, 1), 37);
  try {
    switch (corpo.etapa) {
      case "blocos":
        return NextResponse.json({ blocos: blocosDeMeses(meses) });
      case "crm":
        return NextResponse.json(await trazerCrmDoPeriodo(clienteId, meses, corpo.cursor ?? null));
      case "meses":
        return NextResponse.json(await gravarHistorico(clienteId, String(corpo.desde), String(corpo.ate)));
      default:
        return NextResponse.json({ erro: "etapa inválida" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
