import Link from "next/link";
import type { LinhaNivelGoogle, NivelGoogle } from "@/lib/google";
import { decimal, dinheiro, inteiro, pct } from "@/lib/formato";
import { SeloStatus } from "./ui";
import { BotaoGoogle } from "./botao-google";

export const NIVEIS_GOOGLE: { chave: "campanhas" | NivelGoogle; rotulo: string }[] = [
  { chave: "campanhas", rotulo: "Campanhas" },
  { chave: "grupos", rotulo: "Grupos de anúncios" },
  { chave: "anuncios", rotulo: "Anúncios" },
  { chave: "palavras", rotulo: "Palavras-chave" },
  { chave: "termos", rotulo: "Termos de pesquisa" },
];

const STATUS: Record<string, string> = { ENABLED: "ACTIVE", PAUSED: "PAUSED", REMOVED: "DELETED" };
const FORCA: Record<string, string> = { EXCELLENT: "Excelente", GOOD: "Boa", AVERAGE: "Média", POOR: "Fraca", PENDING: "Pendente", UNRATED: "" };
const APROVACAO: Record<string, string> = { APPROVED: "", APPROVED_LIMITED: "aprovado (limitado)", DISAPPROVED: "reprovado", AREA_OF_INTEREST_ONLY: "limitado" };

/** Tabela de um nível do Google (grupos, anúncios, palavras-chave ou termos), com as ações de cada linha. */
export function TabelaNivelGoogle({ nivel, linhas, contaDe, link, voltar, cpaMedio }: {
  nivel: NivelGoogle; linhas: LinhaNivelGoogle[]; contaDe: (campanhaId: string) => string | undefined;
  /** link para descer um nível (grupo → anúncios) */
  link: (l: LinhaNivelGoogle) => string | null;
  voltar: string; cpaMedio: number | null;
}) {
  if (!linhas.length) return <p className="p-4 text-sm text-texto-3">Sem dados neste nível no período.</p>;
  const cab = nivel === "grupos" ? "Grupo" : nivel === "anuncios" ? "Anúncio" : nivel === "palavras" ? "Palavra-chave" : "Termo pesquisado";
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-texto-3">
        <tr>
          <th className="px-4 py-2 font-normal">{cab}</th>
          {["Investido", "Conversões", "Custo/conv.", "Cliques", "CTR", "CPC", "Ações"].map((h) => (
            <th key={h} className="px-3 py-2 text-right font-normal">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody className="num">
        {linhas.map((l) => {
          const conta = contaDe(l.campanhaId);
          const cpa = l.conversoes ? l.gasto / l.conversoes : null;
          const semConv = l.gasto > 0 && l.conversoes === 0;
          const caro = cpaMedio != null && cpa != null && cpa > cpaMedio * 1.3;
          const href = link(l);
          const ativo = l.status === "ENABLED";
          const info = [
            nivel === "grupos" ? l.tipo : null,
            nivel !== "grupos" ? `${l.grupo ?? ""}` : null,
            l.detalhe,
            l.extra?.qualidade ? `qualidade ${l.extra.qualidade}/10` : null,
            l.extra?.forca && FORCA[l.extra.forca] ? `força ${FORCA[l.extra.forca]}` : null,
            l.extra?.aprovacao && APROVACAO[l.extra.aprovacao] ? APROVACAO[l.extra.aprovacao] : null,
          ].filter(Boolean).join(" · ");
          const nivelAcao = nivel === "grupos" ? "grupo" : nivel === "anuncios" ? "anuncio" : "palavra";
          return (
            <tr key={`${l.campanhaId}-${l.id}`} className="border-t border-borda">
              <td className="max-w-96 px-4 py-2">
                <div className="flex items-center gap-2">
                  {nivel !== "termos" && <SeloStatus status={STATUS[l.status] ?? l.status} />}
                  {href ? <Link href={href} className="truncate hover:text-destaque hover:underline" title={l.nome}>{l.nome}</Link>
                    : <span className="truncate" title={l.nome}>{l.nome}</span>}
                </div>
                <div className="truncate text-xs text-texto-3" title={`${l.campanha} · ${info}`}>{info || l.campanha}</div>
              </td>
              <td className="px-3 py-2 text-right">{dinheiro(l.gasto)}</td>
              <td className="px-3 py-2 text-right">{decimal(l.conversoes).replace(/,00$/, "")}</td>
              <td className={`px-3 py-2 text-right ${semConv || caro ? "text-critico" : ""}`}>{semConv ? "sem conversão" : dinheiro(cpa)}</td>
              <td className="px-3 py-2 text-right">{inteiro(l.cliques)}</td>
              <td className="px-3 py-2 text-right">{pct(l.impressoes ? (l.cliques / l.impressoes) * 100 : null)}</td>
              <td className="px-3 py-2 text-right">{dinheiro(l.cliques ? l.gasto / l.cliques : null)}</td>
              <td className="px-3 py-2">
                {conta && (
                  <div className="flex justify-end gap-1.5">
                    {nivel !== "termos" && (l.status === "ENABLED" || l.status === "PAUSED") && (
                      <BotaoGoogle voltar={voltar} rotulo={ativo ? "Pausar" : "Ativar"} perigo={ativo}
                        confirmar={`${ativo ? "Pausar" : "Ativar"} “${l.nome}” no Google?`}
                        campos={{ conta_id: conta, nivel: nivelAcao, acao: ativo ? "pausar" : "ativar", objeto_id: l.id, nome: l.nome }} />
                    )}
                    {nivel === "termos" && l.extra?.termoStatus !== "EXCLUDED" && (
                      <BotaoGoogle voltar={voltar} rotulo="Negativar" perigo
                        confirmar={`Adicionar [${l.nome}] como negativa (exata) na campanha “${l.campanha}”?`}
                        campos={{ conta_id: conta, nivel: "termo", acao: "negativar", objeto_id: l.campanhaId, texto: l.nome, tipo: "EXACT", nome: l.campanha }} />
                    )}
                    {nivel === "termos" && l.grupoId && l.extra?.termoStatus !== "ADDED" && (
                      <BotaoGoogle voltar={voltar} rotulo="+ Palavra"
                        confirmar={`Adicionar [${l.nome}] como palavra-chave (exata) no grupo “${l.grupo}”?`}
                        campos={{ conta_id: conta, nivel: "termo", acao: "adicionar", objeto_id: l.grupoId, texto: l.nome, tipo: "EXACT", nome: l.grupo ?? "" }} />
                    )}
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
