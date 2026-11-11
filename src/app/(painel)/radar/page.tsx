import { connection } from "next/server";
import { db } from "@/lib/db";
import { hojeISO } from "@/lib/datas";
import { listarSalvos, lerRadar } from "@/lib/radar";
import { RadarCriativos } from "@/components/radar";

export const maxDuration = 300;

export default async function PaginaRadar() {
  await connection();
  const [radar, salvos, { data: clientes }] = await Promise.all([
    lerRadar().catch(() => null),
    listarSalvos().catch(() => []),
    db().from("clientes").select("id, nome, nicho").eq("ativo", true).order("nome"),
  ]);
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <h1 className="text-[26px] font-extrabold tracking-tight">Radar de criativos</h1>
        <p className="mt-1 text-sm text-texto-3">
          Por nicho dos seus clientes: buscas prontas na Biblioteca de Anúncios, os criativos que mais performam nos seus clientes do mesmo nicho
          e o que está em alta. Achou um anúncio bom? Analise aqui e veja como adaptar.
        </p>
      </header>
      <RadarCriativos inicial={radar} salvosIniciais={salvos} clientes={(clientes ?? []) as { id: string; nome: string; nicho: string | null }[]} hoje={hojeISO()} />
    </div>
  );
}
