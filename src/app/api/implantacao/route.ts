import { NextResponse, type NextRequest } from "next/server";
import { checklistDoCliente, marcarItem, salvarModelo } from "@/lib/implantacao";

// Checklist de implantação (protegido pelo login do painel).
//   POST { op: "marcar", clienteId, id, feito?, ignorado? } → { checklist }
//   POST { op: "modelo", itens: string[], clienteId? }      → itens manuais (valem para todos os clientes)
export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => ({}));
  try {
    if (corpo.op === "marcar") {
      const clienteId = String(corpo.clienteId);
      await marcarItem(clienteId, String(corpo.id), {
        ...(typeof corpo.feito === "boolean" ? { feito: corpo.feito } : {}),
        ...(typeof corpo.ignorado === "boolean" ? { ignorado: corpo.ignorado } : {}),
      });
      return NextResponse.json({ checklist: await checklistDoCliente(clienteId) });
    }
    if (corpo.op === "modelo") {
      await salvarModelo(Array.isArray(corpo.itens) ? corpo.itens : []);
      return NextResponse.json(corpo.clienteId ? { checklist: await checklistDoCliente(String(corpo.clienteId)) } : { ok: true });
    }
    return NextResponse.json({ erro: "op inválida" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
