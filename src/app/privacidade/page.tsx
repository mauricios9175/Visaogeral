export const metadata = { title: "Política de Privacidade · Visão Geral" };

/** Página pública exigida pela tela de consentimento OAuth do Google. */
export default function Privacidade() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-4 py-10 text-sm leading-relaxed">
      <h1 className="text-xl font-semibold">Política de Privacidade · Visão Geral</h1>
      <p className="text-texto-2">Última atualização: outubro de 2026.</p>
      <p>
        O Visão Geral é um painel interno e privado, usado apenas pelo seu proprietário (gestor de tráfego) para
        acompanhar o desempenho das campanhas dos clientes que ele atende. Não é oferecido ao público nem a terceiros.
      </p>
      <h2 className="font-semibold">Dados acessados</h2>
      <p>
        Com a autorização do proprietário, o painel lê dados de desempenho das contas de anúncio do Google Ads e do
        Meta Ads (investimento, impressões, cliques, conversões, nomes e status de campanhas e anúncios) e dados de
        negócios dos CRMs conectados. O acesso é somente leitura: o painel não cria, altera ou exclui campanhas.
      </p>
      <h2 className="font-semibold">Uso e armazenamento</h2>
      <p>
        Os dados são usados exclusivamente para montar relatórios e alertas para o próprio proprietário e seus
        clientes. Ficam guardados em banco de dados privado, acessível apenas pelo servidor do painel. Tokens de
        acesso nunca são enviados ao navegador. Nenhum dado é vendido ou compartilhado com terceiros.
      </p>
      <h2 className="font-semibold">Uso de dados das APIs do Google</h2>
      <p>
        O uso e a transferência de informações recebidas das APIs do Google seguem a Política de Dados do Usuário dos
        Serviços de API do Google, incluindo os requisitos de uso limitado.
      </p>
      <h2 id="remocao" className="font-semibold">Remoção e exclusão de dados</h2>
      <p>
        O acesso pode ser revogado a qualquer momento em myaccount.google.com/permissions. Para pedir a exclusão dos
        dados, escreva para mauricios9175@gmail.com.
      </p>
    </main>
  );
}
