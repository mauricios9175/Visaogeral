// Manual do gestor para as sugestões com IA: as regras de decisão (editáveis em Configurações) e os parâmetros
// numéricos de cada cliente. Arquivo sem "server-only": os tipos e padrões também são usados nos formulários.

export const MANUAL_PADRAO = `# Lógica de otimização de campanhas de leads (Meta Ads)

## Princípio geral
- Se não está quebrado, não mexe. Se o CPA (custo por lead) está dentro da meta E a qualidade dos leads no CRM está boa, a campanha fica como está.
- Regra de ouro: sempre cruzar as métricas da plataforma com o CRM. CPA baixo não significa nada se o lead não é qualificado.
- A primeira pergunta é sempre "preciso mexer nessa campanha?", e a resposta padrão é NÃO. Mexer no que performa pode quebrar a entrega e reiniciar o aprendizado do Meta.

## Quando mexer (CPA × qualidade no CRM)
- Dentro da meta + qualidade boa → Manter. Não há motivo para mexer.
- Acima da meta + qualidade boa → Otimizar, com foco em custo.
- Dentro da meta + qualidade ruim → Otimizar, com foco em qualidade.
- Acima da meta + qualidade ruim → Otimizar, prioridade máxima.

## Checklist antes de agir
1. O CPA está dentro da meta do cliente (com a tolerância)?
2. A qualidade dos leads, conferida no CRM, está boa (acima da taxa mínima de qualificação)?
3. Se as duas respostas forem sim, manter. Se alguma for não, iniciar o Passo 1.
4. Já existe volume suficiente (dias, gasto e leads mínimos) para julgar? Decidir com poucos dados leva a pausar anúncio bom ou manter anúncio ruim: nesse caso, a recomendação é aguardar.

## Ordem de otimização (sempre nesta sequência, nunca pular etapas)
Passo 1 — Analisar os anúncios (criativos). Cruzar custo × qualidade do lead no CRM:
- Caro + qualificado → NÃO desativar. O anúncio atrai a pessoa certa; o problema está no público/entrega: otimizar o público desse anúncio.
- Caro + desqualificado → Desativar.
- Barato + qualificado → Manter (e escalar, se houver verba e a performance se sustentar).
- Barato + desqualificado → O custo baixo engana: revisar a qualificação do formulário/oferta (perguntas que deixam passar qualquer pessoa) ou pausar.
Se após desativar os ruins não houver mais nada a ajustar, a otimização termina aí.

Passo 2 — Analisar os conjuntos de anúncios. Só se chega aqui quando NENHUM anúncio está bom. Olhar público, segmentação, posicionamentos e orçamento do conjunto, com a mesma lógica de custo × qualidade: manter o que traz lead qualificado a custo aceitável, ajustar o que traz qualidade com custo alto e pausar o que não entrega nem custo nem qualidade.

Passo 3 — Recriar a campanha do zero (não duplicar). Se nem anúncios nem conjuntos funcionam e a estratégia ainda faz sentido: campanha nova do zero para resetar o aprendizado, 2 a 3 dias de teste, com a antiga rodando em paralelo. Ao fim, comparar CPA e qualidade; se a nova for melhor, mover a verba de forma gradual.

Passo 4 — Produzir novos criativos (em paralelo ao Passo 3): novos ângulos e versões (imagem, vídeo), referências, modelo novo de anúncio. A campanha atual continua rodando durante a produção.

Passo 5 — Mudar o objetivo (último recurso), só depois dos Passos 1 a 4: formulário → leads no site → WhatsApp. Cada troca recomeça do Passo 1.

## Estrutura por faixa de orçamento (mensal)
- R$ 1 a 10 mil: uma campanha de captação enxuta; os testes acontecem dentro dela. Prioridade é não mexer no que funciona.
- R$ 10 a 30 mil: além da captação, uma campanha específica de testes, com um conjunto para cada anúncio testado. Criativos que performam no teste vão para a principal.
- Acima de R$ 30 mil: captação dividida em 2 ou 3 campanhas de escala (sem sobreposição de público; variar público, criativo ou ângulo) + testes + tráfego + engajamento. Não concentrar toda a verba de captação numa campanha só: quanto maior o orçamento de uma campanha, mais o Meta encarece o lead.

## Campanhas de tráfego (seguidores)
- Mexe-se pouco. Métrica principal: seguidores gerados, junto com o CPC.
- Muitos seguidores + CPC bom → manter. Seguidores bons + CPC alto → manter a ideia e deixar o criativo mais chamativo. Poucos seguidores → revisar perfil/conteúdo e testar nova ideia de criativo.
`;

export const MANUAL_GOOGLE_PADRAO = `# Lógica de otimização de campanhas no Google Ads (Pesquisa)

## Princípio geral
- Se não está quebrado, não mexe. CPA (custo por conversão/lead) dentro da meta E leads de qualidade no CRM: manter.
- Regra de ouro: cruzar com o CRM sempre que houver dado (campanha, grupo e palavra-chave pelas UTMs). Quando o CRM não tiver o cruzamento, decidir pelas conversões do próprio Google e dizer isso.
- Decidir com volume: termo ou palavra com poucos cliques e pouco gasto → aguardar, nunca pausar.

## Quando mexer (CPA × qualidade)
- Dentro da meta + qualidade boa → Manter.
- Acima da meta + qualidade boa → Otimizar custo (termos, palavras, lances, anúncio).
- Dentro da meta + qualidade ruim → Otimizar qualidade (negativas, correspondência, anúncio e página mais claros sobre o que é oferecido).
- Acima da meta + qualidade ruim → Prioridade máxima.

## Ordem de otimização
Passo 1 — Termos de pesquisa (o que as pessoas digitaram):
- Termo sem relação com o negócio, ou que gastou ~2× o CPA desejado sem conversão → negativar na campanha (exata ou frase).
- Termo que converte bem e ainda não é palavra-chave → adicionar como palavra-chave exata no grupo.
Passo 2 — Palavras-chave:
- Cara + desqualificada (ou sem conversão com gasto ≥ 2× o CPA) → pausar.
- Cara + qualificada → manter; revisar o anúncio do grupo e a correspondência (ampla demais traz termos ruins).
- Barata + qualificada → manter e, se a campanha estiver limitada pelo orçamento, escalar.
- Índice de qualidade baixo (1 a 4) → títulos do grupo que repitam a palavra e página coerente.
Passo 3 — Grupos e anúncios:
- Cada grupo com títulos que conversam com as suas palavras. CTR baixo no grupo → reescrever os títulos.
- Grupo inteiro sem resultado com volume → pausar o grupo.
Passo 4 — Campanha: orçamento (escalar o que funciona aos poucos, ~20% por vez), estratégia de lance e locais.
Passo 5 — Estrutura: separar grupos por intenção quando um grupo mistura temas diferentes.
`;

export const CHAVE_MANUAL_GOOGLE = "manual_ia_google";

/** Parâmetros numéricos por cliente (a meta de CPA vem do cadastro do cliente). */
export type ParamsIA = {
  tolerancia: number;        // % que o CPA pode passar da meta antes de agir
  diasMinimos: number;       // dias de dados antes de decidir
  gastoMinimo: number;       // R$ gastos por anúncio antes de julgar
  leadsMinimos: number;      // leads por anúncio antes de julgar
  qualificacaoMinima: number; // % de leads qualificados no CRM para a qualidade ser "boa"
  notas: string;             // observações do cliente (ex.: "ticket alto, aceita CPL maior")
};

export const PARAMS_PADRAO: ParamsIA = {
  tolerancia: 20, diasMinimos: 3, gastoMinimo: 0, leadsMinimos: 5, qualificacaoMinima: 30, notas: "",
};

export function normalizarParams(p: Partial<ParamsIA> | null | undefined): ParamsIA {
  const n = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Math.max(0, Number(v)) : d);
  return {
    tolerancia: n(p?.tolerancia, PARAMS_PADRAO.tolerancia),
    diasMinimos: n(p?.diasMinimos, PARAMS_PADRAO.diasMinimos),
    gastoMinimo: n(p?.gastoMinimo, PARAMS_PADRAO.gastoMinimo),
    leadsMinimos: n(p?.leadsMinimos, PARAMS_PADRAO.leadsMinimos),
    qualificacaoMinima: n(p?.qualificacaoMinima, PARAMS_PADRAO.qualificacaoMinima),
    notas: String(p?.notas ?? "").slice(0, 2000),
  };
}

export const CHAVE_MANUAL = "manual_ia";
export const chaveParams = (clienteId: string) => `ia_cliente:${clienteId}`;
