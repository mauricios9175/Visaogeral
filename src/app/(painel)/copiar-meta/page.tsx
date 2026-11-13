import Link from "next/link";
import { connection } from "next/server";
import { Voltar } from "@/components/ui";
import { db, EMPRESA_PADRAO } from "@/lib/db";

const NIVEL = { campanha: "a campanha", conjunto: "o conjunto", anuncio: "o anúncio" } as const;

// "Copiar para outra conta" no Meta: escolha o cliente e a conta de anúncio onde colar.
export default async function CopiarMeta({ searchParams }: PageProps<"/copiar-meta">) {
  await connection();
  const { conta, nivel, id, nome, voltar } = (await searchParams) as { conta?: string; nivel?: string; id?: string; nome?: string; voltar?: string };
  const ok = /^act_\d+$/.test(conta ?? "") && /^(campanha|conjunto|anuncio)$/.test(nivel ?? "") && /^\d+$/.test(id ?? "");
  const { data } = await db().from("contas_anuncio").select("id, nome, cliente_id, clientes!inner(id, nome, empresa, ativo)").not("cliente_id", "is", null);
  type Linha = { id: string; nome: string; clientes: { id: string; nome: string; empresa: string | null; ativo: boolean } };
  const contas = ((data ?? []) as unknown as Linha[]).filter((c) => c.clientes.ativo !== false)
    .sort((a, b) => a.clientes.nome.localeCompare(b.clientes.nome, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"));
  const voltarSeguro = voltar && voltar.startsWith("/") ? voltar : "/";
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="space-y-2">
        <Voltar href={voltarSeguro}>Voltar</Voltar>
        <h1 className="text-[26px] font-extrabold tracking-tight">Copiar para outra conta</h1>
        <p className="text-sm text-texto-3">
          {ok && <>Copiando {NIVEL[nivel as keyof typeof NIVEL]} <b>“{nome ?? id}”</b>. </>}
          Escolha a conta de destino: abre um rascunho no cliente dela, com tudo copiado (públicos, textos e a copy de cada anúncio),
          em uma campanha nova. Imagens e vídeos são levados para a conta de destino na hora de publicar. Tudo nasce pausado.
        </p>
      </header>
      {!ok ? <p className="text-sm text-critico">Link inválido: abra pelo botão Duplicar, na tela do cliente.</p> : (
        <ul className="divide-y divide-borda rounded-2xl border border-borda bg-superficie">
          {contas.filter((c) => c.id !== conta).map((c) => (
            <li key={c.id}>
              <Link href={`/clientes/${c.clientes.id}/montar?${new URLSearchParams({ copiar: `${conta}:${nivel}:${id}`, contaDestino: c.id })}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-destaque-bg/30">
                <span><span className="font-medium">{c.clientes.nome}</span> <span className="text-texto-3">· {c.nome}</span></span>
                <span className="text-xs text-texto-3">{c.clientes.empresa || EMPRESA_PADRAO}</span>
              </Link>
            </li>
          ))}
          {contas.length <= 1 && <li className="px-4 py-3 text-sm text-texto-3">Nenhuma outra conta de anúncio vinculada a clientes.</li>}
        </ul>
      )}
    </div>
  );
}
