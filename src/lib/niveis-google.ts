import type { NivelGoogle } from "./google";

/** Abas da seção do Google na tela do cliente (mesma hierarquia do Google Ads). */
export const NIVEIS_GOOGLE: { chave: "campanhas" | NivelGoogle; rotulo: string }[] = [
  { chave: "campanhas", rotulo: "Campanhas" },
  { chave: "grupos", rotulo: "Grupos de anúncios" },
  { chave: "anuncios", rotulo: "Anúncios" },
  { chave: "palavras", rotulo: "Palavras-chave" },
  { chave: "termos", rotulo: "Termos de pesquisa" },
];
