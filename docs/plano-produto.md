# Plano guardado: vender o painel para outros gestores de tráfego

Status: **na gaveta** (decisão do dono em 12/11/2026). Antes, o painel vai ficar mais personalizável.
Enquanto isso, toda mudança deve ser pensada para não atrapalhar essa versão futura (ver "Regras para o dia a dia").

## Modelo combinado

- **Cada gestor conecta tudo dele**: o app da Meta, o projeto do Google Cloud, os CRMs e a **chave de IA** (Gemini grátis,
  Claude ou GPT). O custo da IA fica com o gestor, não com o dono do painel.
- **Videoaulas** + uma **tela de primeira configuração** dentro do painel, que confere cada passo e mostra o vídeo daquele passo.
- **Em paralelo**: pedir a verificação da empresa e a análise do app na Meta e a verificação no Google. Quando aprovar,
  o painel ganha o "Entrar com Facebook/Google" de um clique, e o app próprio vira a opção avançada.

## O que muda no código (quando sair da gaveta)

1. Contas por gestor, com os dados separados no banco (cada tabela com o dono; trava no próprio banco).
2. Conexões e chaves (Meta, Google, CRM, IA) guardadas por conta e criptografadas, em vez de variáveis da Vercel.
3. Tela de primeira configuração guiada.
4. Cobrança (assinatura) e bloqueio de quem não paga.
5. Termos de uso, política de privacidade e contrato de tratamento de dados (LGPD).

## Hospedagem (opções estudadas)

- Servidor próprio (VPS, ex.: Hetzner ou Contabo) com painel gratuito tipo Coolify: barato e resolve o agendador
  (o do GitHub atrasa e pula horários).
- Banco: o código usa o Supabase em tudo. Mais simples: Supabase no próprio servidor ou Supabase Pro; trocar por
  Postgres puro é possível, mas dá trabalho.
- Conferir preços antes de contratar.

## Regras para o dia a dia (enquanto o plano está guardado)

- Ao pedir algo, explicar também: melhorias, o que vale fazer agora e o impacto para a versão de outros gestores.
- Evitar coisas presas a uma pessoa só: nomes, empresas (Propulsão, Viccon), cores e textos fixos devem ser
  configuráveis sempre que der.
- Chaves e conexões novas: preferir guardar por configuração (banco) em vez de variável de ambiente.
- Nada de dados de um cliente "vazando" para outro em telas ou na IA (já pensar como se houvesse vários gestores).
