import { NextResponse, type NextRequest } from "next/server";
import { baixarDoDrive, listarDoDrive } from "@/lib/drive";
import { novoCaminho, salvar } from "@/lib/armazenamento";

export const maxDuration = 300;

// Traz os criativos de uma pasta (ou arquivo) do Drive para o Storage, prontos para a montagem.
// Protegida pelo login do painel (proxy.ts).
export async function POST(request: NextRequest) {
  const { link, lote } = (await request.json()) as { link?: string; lote?: string };
  if (!link || !/^[\w-]{8,40}$/.test(lote ?? "")) return NextResponse.json({ erro: "Cole o link da pasta do Drive." }, { status: 400 });
  try {
    const { acesso, arquivos } = await listarDoDrive(link);
    if (!arquivos.length) throw new Error("Nenhuma imagem ou vídeo encontrado nesse link.");
    if (arquivos.length > 20) throw new Error(`A pasta tem ${arquivos.length} criativos; use uma pasta com até 20.`);
    const importados: { caminho: string; nome: string; tipo: string; tamanho: number }[] = [];
    for (const a of arquivos) {
      const caminho = novoCaminho(lote!, a.nome);
      await salvar(caminho, await baixarDoDrive(acesso, a.id), a.tipo);
      importados.push({ caminho, nome: a.nome, tipo: a.tipo, tamanho: a.tamanho });
    }
    return NextResponse.json({ arquivos: importados });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
