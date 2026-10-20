import Link from "next/link";
import { db, EMPRESA_PADRAO } from "@/lib/db";
import { dataBRCurta, hojeISO, periodoRelatorio } from "@/lib/datas";
import { gerarRelatorios, type TipoRelatorio } from "@/lib/relatorio";
import { Aviso } from "@/components/ui";
import { Mensagem } from "@/components/mensagem";

export const maxDuration = 120;

const TIPOS: { chave: TipoRelatorio; rotulo: string }[] = [
  { chave: "semanal", rotulo: "Semana anterior (segunda)" },
  { chave: "parcial", rotulo: "Parcial da semana (quarta)" },
];

export default async function Relatorios({ searchParams }: PageProps<"/relatorios">) {
  const busca = (await searchParams) as { tipo?: string; empresa?: string };
  // Na quarta-feira abre direto na parcial; nos outros dias, no relatório da semana anterior.
  const quarta = new Date(`${hojeISO()}T12:00:00Z`).getUTCDay() === 3;
  const tipo: TipoRelatorio = busca.tipo === "parcial" || busca.tipo === "semanal" ? busca.tipo : quarta ? "parcial" : "semanal";
  const { data: clientes } = await db().from("clientes").select("empresa").eq("ativo", true);
  const empresas = [...new Set((clientes ?? []).map((c) => (c.empresa as string | null) || EMPRESA_PADRAO))].sort();
  const empresa = busca.empresa && empresas.includes(busca.empresa) ? busca.empresa : null;
  const { atual } = periodoRelatorio(tipo);
  const relatorios = await gerarRelatorios(tipo, empresa);
  const link = (t: TipoRelatorio, e: string | null) => `/relatorios?tipo=${t}${e ? `&empresa=${encodeURIComponent(e)}` : ""}`;
  const chip = (ativo: boolean) =>
    `rounded-full border px-3 py-1 ${ativo ? "border-destaque bg-superficie font-medium" : "border-borda text-texto-2 hover:text-texto"}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Relatórios para clientes</h1>
        <p className="text-sm text-texto-2">
          Período: {dataBRCurta(atual.desde)} a {dataBRCurta(atual.ate)}
          {tipo === "parcial" && " (até agora)"} · revise, edite se quiser e copie ou abra no WhatsApp.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {TIPOS.map((t) => <Link key={t.chave} href={link(t.chave, empresa)} className={chip(t.chave === tipo)}>{t.rotulo}</Link>)}
      </div>
      <div className="flex flex-wrap gap-1 text-sm">
        {[null, ...empresas].map((e) => (
          <Link key={e ?? "todas"} href={link(tipo, e)} className={chip(e === empresa)}>{e ?? "Todas as empresas"}</Link>
        ))}
      </div>

      {tipo === "parcial" && (
        <Aviso>
          A parcial vai de segunda até agora e compara com os mesmos dias da semana passada. Os dados de hoje ainda estão
          sendo acumulados (a sincronização roda a cada hora).
        </Aviso>
      )}
      {relatorios.length === 0 && <Aviso>Nenhum cliente ativo nesta empresa.</Aviso>}

      <div className="grid gap-4 lg:grid-cols-2">
        {relatorios.map((r) => (
          <section key={r.cliente.id} className="space-y-2 rounded-xl border border-borda bg-superficie p-4">
            <div className="flex items-baseline justify-between gap-2">
              <Link href={`/clientes/${r.cliente.id}`} className="font-medium hover:underline">{r.cliente.nome}</Link>
              <span className="text-xs text-texto-3">{r.cliente.empresa || EMPRESA_PADRAO}</span>
            </div>
            <Mensagem textoInicial={r.texto} />
          </section>
        ))}
      </div>
    </div>
  );
}
