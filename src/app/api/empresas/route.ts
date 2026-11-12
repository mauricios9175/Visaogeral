import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { linkDoLogo, listarEmpresas, salvarEmpresa } from "@/lib/empresas";

/** A lista com o link do logo de cada uma (para a tela mostrar). */
const comLogo = async () => Promise.all((await listarEmpresas()).map(async (e) => ({ ...e, logoUrl: await linkDoLogo(e.logo, 6 * 3600) })));

// Empresas e relatórios (protegido pelo login do painel):
//   GET                                   → { empresas }
//   POST { nomeAtual, empresa: {...} }    → salva (nome novo renomeia nos clientes) → { empresas }
export async function GET() {
  return NextResponse.json({ empresas: await comLogo() });
}

export async function POST(request: NextRequest) {
  const c = await request.json().catch(() => ({}));
  try {
    if (typeof c.nomeAtual !== "string" || !c.nomeAtual.trim()) throw new Error("Empresa inválida.");
    await salvarEmpresa(c.nomeAtual, c.empresa ?? {});
    revalidatePath("/", "layout"); // o nome da empresa aparece no menu e nos filtros
    return NextResponse.json({ empresas: await comLogo() });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
