import Link from "next/link";
import { connection } from "next/server";
import { Voltar } from "@/components/ui";
import { db, EMPRESA_PADRAO } from "@/lib/db";
import { formatarIdGoogle } from "@/lib/google";

// "Copiar campanha para…": escolha o cliente (e a conta) onde colar a campanha do Google Ads.
export default async function CopiarGoogle({ searchParams }: PageProps<"/copiar-google">) {
  await connection();
  const { conta, campanha, nome, voltar } = (await searchParams) as { conta?: string; campanha?: string; nome?: string; voltar?: string };
  const ok = /^\d+$/.test(conta ?? "") && /^\d+$/.test(campanha ?? "");
  const { data } = await db().from("contas_google").select("id, nome, cliente_id, clientes!inner(id, nome, empresa, ativo)").not("cliente_id", "is", null);
  type Linha = { id: string; nome: string; clientes: { id: string; nome: string; empresa: string | null; ativo: boolean } };
  const contas = ((data ?? []) as unknown as Linha[]).filter((c) => c.clientes.ativo !== false);
  const clientes = [...new Map(contas.map((c) => [c.clientes.id, c.clientes])).values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const destinoSeguro = voltar && voltar.startsWith("/") ? voltar : "/";
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="space-y-2">
        <Voltar href={destinoSeguro}>Voltar</Voltar>
        <h1 className="text-[26px] font-extrabold tracking-tight">Copiar campanha para…</h1>
        <p className="text-sm text-texto-3">
          {nome ? <>Campanha <b>“{nome}”</b> (conta {formatarIdGoogle(conta ?? "")}). </> : null}
          Escolha o cliente: a campanha abre na montagem dele para você revisar e escolher a conta. Ela é criada pausada.
          Dá para colar no mesmo cliente também (vira uma cópia na mesma conta ou em outra conta dele).
        </p>
      </header>
      {!ok ? <p className="text-sm text-critico">Link inválido: abra pela campanha, no Google Ads do cliente.</p> : (
        <ul className="divide-y divide-borda rounded-2xl border border-borda bg-superficie">
          {clientes.map((c) => (
            <li key={c.id}>
              <Link href={`/clientes/${c.id}/montar-google?copiar=${conta}:${campanha}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-destaque-bg/30">
                <span className="font-medium">{c.nome}</span>
                <span className="text-xs text-texto-3">
                  {c.empresa || EMPRESA_PADRAO} · {contas.filter((x) => x.clientes.id === c.id).map((x) => x.nome).join(", ")}
                </span>
              </Link>
            </li>
          ))}
          {!clientes.length && <li className="px-4 py-3 text-sm text-texto-3">Nenhum cliente com conta do Google Ads vinculada.</li>}
        </ul>
      )}
    </div>
  );
}
