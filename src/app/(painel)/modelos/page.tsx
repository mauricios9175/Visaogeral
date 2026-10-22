import Link from "next/link";
import { db } from "@/lib/db";
import { OBJETIVOS, type Modelo } from "@/lib/modelos";
import { Aviso } from "@/components/ui";
import { BotaoEnviar } from "@/components/botao";
import { EditorModelo } from "@/components/editor-modelo";
import { criarModelosPadrao, excluirModelo } from "../../acoes-modelos";

const botao = "rounded-lg border border-borda bg-superficie px-3 py-1.5 text-sm hover:border-destaque";

export default async function Modelos({ searchParams }: PageProps<"/modelos">) {
  const { msg, editar } = (await searchParams) as { msg?: string; editar?: string };
  const { data, error } = await db().from("modelos").select("*").eq("plataforma", "meta").order("nome");
  const modelos = (data ?? []) as Modelo[];
  const emEdicao = editar === "novo" ? null : modelos.find((m) => m.id === editar);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Modelos de campanha</h1>
        <p className="text-sm text-texto-2">
          Monte campanha, conjunto e anúncios no Meta a partir de um modelo. Tudo é criado <b>pausado</b> para você
          revisar no Gerenciador. Para usar, abra o cliente e clique em “Montar campanha”.
        </p>
      </div>
      {msg && <Aviso>{msg}</Aviso>}
      {error && <Aviso>Rode o SQL 0013 no Supabase para usar os modelos ({error.message}).</Aviso>}

      {!error && !modelos.length && (
        <div className="rounded-xl border border-borda bg-superficie p-4 text-sm">
          <p>Nenhum modelo ainda. Comece com os três prontos (formulário, WhatsApp e site) e ajuste para cada nicho.</p>
          <form action={criarModelosPadrao} className="mt-2">
            <BotaoEnviar className="rounded-lg bg-destaque px-3 py-1.5 text-sm font-medium text-white">Criar modelos prontos</BotaoEnviar>
          </form>
        </div>
      )}

      {modelos.length > 0 && (
        <ul className="divide-y divide-borda rounded-xl border border-borda bg-superficie text-sm">
          {modelos.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{m.nome}</div>
                <div className="text-xs text-texto-3">
                  {OBJETIVOS[m.objetivo]?.rotulo ?? m.objetivo} · R$ {m.config.orcamentoDiario}/dia no {m.config.orcamentoEm} ·
                  {" "}{m.config.idadeMin}–{m.config.idadeMax} anos · {m.config.interesses.length} interesse(s)
                </div>
              </div>
              <Link href={`/modelos?editar=${m.id}#editor`} className={botao}>Editar</Link>
              <form action={excluirModelo}>
                <input type="hidden" name="id" value={m.id} />
                <BotaoEnviar className={`${botao} text-critico`} aguardando="…">Excluir</BotaoEnviar>
              </form>
            </li>
          ))}
        </ul>
      )}

      {!error && (
        <section id="editor" className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="font-medium">{emEdicao ? `Editar: ${emEdicao.nome}` : "Novo modelo"}</h2>
            {emEdicao && <Link href="/modelos?editar=novo#editor" className="text-sm text-destaque underline">criar um novo</Link>}
          </div>
          <EditorModelo key={emEdicao?.id ?? "novo"} modelo={emEdicao ?? undefined} />
        </section>
      )}
    </div>
  );
}
