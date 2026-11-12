import { NextResponse, type NextRequest } from "next/server";
import { analisarAnuncioExterno, excluirSalvo, gerarRadar, listarSalvos, lerRadar, salvarPalavras } from "@/lib/radar";

export const maxDuration = 300;

// Radar de criativos (protegido pelo login do painel):
//   GET                                   → { radar, salvos }
//   POST { op: "gerar" }                  → monta o radar agora
//   POST { op: "palavras", nicho, palavras: string[] }
//   POST { op: "analisar", link, caminho, mime, nicho, clienteId?, diasNoAr?, versoes?, observacao?, texto? }
//   POST { op: "excluir", id }
export async function GET() {
  const [radar, salvos] = await Promise.all([lerRadar(), listarSalvos()]);
  return NextResponse.json({ radar, salvos });
}

const numero = (v: unknown) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v))));

export async function POST(request: NextRequest) {
  const c = await request.json().catch(() => ({}));
  try {
    switch (c.op) {
      case "gerar":
        // "continuar": termina o de hoje (o que faltou); senão recomeça do zero
        return NextResponse.json({ radar: await gerarRadar({ recomecar: !c.continuar, orcamentoMs: 230_000 }) });
      case "palavras":
        return NextResponse.json({ palavras: await salvarPalavras(String(c.nicho ?? ""), Array.isArray(c.palavras) ? c.palavras.map(String) : []) });
      case "analisar": {
        const caminho = typeof c.caminho === "string" && c.caminho.startsWith("montagens/") ? c.caminho : null;
        const link = typeof c.link === "string" && /^https?:\/\//.test(c.link.trim()) ? c.link.trim().slice(0, 1000) : "";
        const salvo = await analisarAnuncioExterno({
          link, caminho, mime: typeof c.mime === "string" ? c.mime : null, nicho: String(c.nicho ?? "").slice(0, 80),
          clienteId: typeof c.clienteId === "string" && c.clienteId ? c.clienteId : null,
          diasNoAr: numero(c.diasNoAr), versoes: numero(c.versoes),
          observacao: String(c.observacao ?? ""), texto: String(c.texto ?? ""),
        });
        return NextResponse.json({ salvo });
      }
      case "excluir":
        return NextResponse.json({ salvos: await excluirSalvo(String(c.id)) });
      default:
        return NextResponse.json({ erro: "op inválida" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
