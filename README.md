# Visão Geral: painel de tráfego

Painel único para acompanhar todos os clientes de Meta Ads: investimento, leads, conversas, custo por resultado, ritmo de orçamento e desempenho por campanha, conjunto e anúncio. Os dados são puxados do Meta de forma automática.

**Fase 1 (esta versão):** conexão com o Meta (seu BM + Login com Facebook), sincronização automática, visão geral de todos os clientes e tela detalhada de cada cliente.
**Próximas fases:** leads de CRM (Kommo, RD Station), webhook de landing page, alertas com sugestões e resumo por e-mail.

---

## Como colocar no ar (uma vez só, ~30 min)

### 1. Banco de dados: Supabase (grátis)
1. Crie uma conta em **supabase.com** e depois um projeto novo (região São Paulo).
2. Abra **SQL Editor → New query**, cole todo o conteúdo de `supabase/migrations/0001_inicial.sql` e clique em **Run**.
3. Em **Project Settings → API**, copie a **Project URL** e a chave **service_role**. Elas viram `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.

### 2. Meta
**Token do seu BM (contas que estão no seu Business Manager):**
1. Em **developers.facebook.com → Meus Apps → Criar App**, escolha o tipo **Empresa** e vincule ao seu BM.
2. No **Business Manager**, vá em **Configurações → Usuários do sistema → Adicionar** e crie um usuário com função Admin.
3. Clique em **Atribuir ativos**, selecione todas as contas de anúncio dos clientes e marque *Visualizar desempenho*.
4. Clique em **Gerar token**, escolha o app, marque `ads_read`, `leads_retrieval` e `business_management`, e defina a validade como **Nunca expira**. Esse é o `META_SYSTEM_USER_TOKEN`.

**Login com Facebook (contas que ficam só no BM do cliente):**
1. No app, adicione o produto **Login do Facebook para Empresas**.
2. Em *URIs de redirecionamento OAuth válidos*, coloque `https://SEU-PAINEL.vercel.app/api/meta/callback`.
3. Em **Configurações**, crie uma configuração do tipo **Token de acesso do usuário** com as permissões `ads_read`, `business_management` e `leads_retrieval`. O ID dela vira `META_LOGIN_CONFIG_ID`.
4. Em **Configurações do app → Básico**, copie o **ID do app** e a **Chave secreta**. Elas viram `META_APP_ID` e `META_APP_SECRET`.
5. Enquanto o app estiver em modo de desenvolvimento, só quem tiver função no app (você) consegue logar. Para uso próprio isso basta.

> O token do Login com Facebook dura cerca de 60 dias. O painel avisa em Configurações quando faltar 7 dias. Aí é só clicar em "Conectar / reconectar perfil". Se puder, peça aos clientes para compartilharem a conta com o seu BM como parceiro, porque assim o acesso não expira.

### 3. Publicar: Vercel (grátis)
1. Em **vercel.com**, entre com o GitHub e clique em **Add New → Project → Visaogeral**.
2. Em **Environment Variables**, cadastre todas as variáveis do arquivo `.env.example`.
3. Clique em **Deploy**. Anote o endereço (ex.: `https://visaogeral.vercel.app`).

### 4. Sincronização automática: GitHub Actions (grátis)
No GitHub do repositório, abra **Settings → Secrets and variables → Actions → New repository secret** e crie:
- `APP_URL` com o endereço da Vercel
- `CRON_SECRET` com o mesmo valor cadastrado na Vercel

Pronto: a cada hora o painel puxa os dados de hoje e de ontem, e toda madrugada reprocessa os últimos 7 dias, porque o Meta ajusta números retroativamente. Para rodar na hora, use **Actions → Sincronizar Meta Ads → Run workflow**.

### 5. Primeiro uso
1. Entre no painel com a `APP_PASSWORD`.
2. **Configurações → Buscar contas no Meta**.
3. Cadastre os clientes com as metas: custo por resultado, orçamento mensal e ROAS.
4. Vincule cada conta de anúncio ao seu cliente.
5. Clique em **Recarregar últimos 30 dias** para carregar o histórico.

---

## Como os números são calculados
- **Resultados** = leads (formulário nativo + pixel) + conversas iniciadas (WhatsApp/Direct/Messenger).
- **Custo por resultado** = investido ÷ resultados.
- **CTR, CPC** consideram cliques no link.
- **Frequência média** é aproximada: soma o alcance de cada anúncio, então fica um pouco abaixo da real.
- **Saúde do cliente**: fica *Crítico* se o custo por resultado estiver mais de 30% acima da meta ou se houver gasto sem resultado; fica *Atenção* se estiver acima da meta ou se o orçamento estiver fora do ritmo (projeção de mais de 15% acima ou de mais de 20% abaixo).
- Comparações: "Este mês" é comparado com os mesmos dias do mês anterior, e "N dias" com os N dias anteriores.

## Desenvolvimento local
```bash
cp .env.example .env.local   # preencha os valores
npm install
npm run dev                  # http://localhost:3000
```
Feito com Next.js 16, Supabase e Recharts.
