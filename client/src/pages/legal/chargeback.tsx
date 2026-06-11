import { useGlobalConfigStore } from "@/stores/global-config";
import { SiteFooter } from "@/components/layout/site-footer";

export default function Chargeback() {
  const { config } = useGlobalConfigStore();

  return (
    <div className="min-h-screen bg-gray-50 py-12" data-testid="docs-page">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-sm p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Política de Chargeback</h1>

          <div className="prose prose-gray max-w-none">
            <p className="text-sm text-gray-600 mb-6">
              <strong>Última atualização:</strong> Março de 2026
            </p>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
              <p className="text-amber-800 font-semibold">
                ATENÇÃO: Chargebacks são contestações feitas diretamente na operadora do cartão e podem resultar
                em bloqueio temporário ou permanente da sua conta vendedora. Mantenha sua taxa abaixo de 1%.
              </p>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">1. O que é Chargeback</h2>
            <p className="mb-4">
              Chargeback é a contestação formal de uma transação de cartão de crédito feita pelo portador
              diretamente junto à sua instituição financeira (banco ou operadora), resultando na reversão do
              valor debitado. É diferente de um reembolso voluntário, é uma disputa formal que envolve as
              bandeiras (Visa, Mastercard) e pode resultar em penalidades para o vendedor.
            </p>
            <p className="mb-4">
              Para pagamentos via PIX, contestações são tratadas de forma diferente pelo Banco Central do
              Brasil, por meio do Mecanismo Especial de Devolução (MED), e não geram chargeback.
            </p>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">2. Motivos Comuns</h2>
            <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">2.1 Motivos Legítimos</h3>
            <ul className="list-disc pl-6 mb-4">
              <li>Transação não reconhecida ou não autorizada pelo titular (fraude)</li>
              <li>Produto ou serviço não entregue dentro do prazo acordado</li>
              <li>Produto significativamente diferente do anunciado</li>
              <li>Cobrança duplicada na mesma transação</li>
              <li>Valor cobrado diferente do acordado</li>
              <li>Cancelamento solicitado e não processado</li>
            </ul>

            <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">2.2 Motivos Ilegítimos (Chargeback Amigável)</h3>
            <ul className="list-disc pl-6 mb-4">
              <li>Arrependimento da compra após uso ou consumo do produto</li>
              <li>Desconhecimento do nome exibido na fatura do cartão</li>
              <li>Dificuldades financeiras pessoais</li>
              <li>Uso integral do produto seguido de contestação</li>
              <li>Não solicitação de reembolso antes de acionar o banco</li>
            </ul>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">3. Limites por Processadora</h2>
            <p className="mb-4">
              Cada processadora de pagamentos possui seus próprios programas de monitoramento de chargeback.
              Os limites que impactam diretamente sua conta na VolatusPay são:
            </p>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-gray-900 mb-3">EfíBank (Cartão Nacional)</h3>
              <ul className="list-disc pl-6 text-gray-700">
                <li><strong>Atenção:</strong> acima de 1% de chargebacks sobre o total de transações mensais</li>
                <li><strong>Risco alto:</strong> acima de 2%, possível suspensão do processamento de cartões</li>
              </ul>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-gray-900 mb-3">Stripe (Cartões Internacionais)</h3>
              <ul className="list-disc pl-6 text-gray-700">
                <li><strong>Alerta precoce:</strong> acima de 0,3% de disputas, monitoramento iniciado</li>
                <li><strong>Risco de encerramento:</strong> acima de 0,65%, conta pode ser suspensa pela Stripe</li>
                <li>Stripe segue o programa Visa Dispute Monitoring (VDMP) e Mastercard ECM</li>
              </ul>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-gray-900 mb-3">PagarMe (Cartões Nacionais)</h3>
              <ul className="list-disc pl-6 text-gray-700">
                <li><strong>Monitoramento:</strong> acima de 1% de chargebacks mensais</li>
                <li><strong>Suspensão:</strong> acima de 2% por dois meses consecutivos</li>
              </ul>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-gray-900 mb-3">Bandeiras (Visa / Mastercard)</h3>
              <ul className="list-disc pl-6 text-gray-700">
                <li><strong>Visa VDMP Alerta:</strong> 100+ disputas/mês E ratio acima de 0,65%</li>
                <li><strong>Visa VDMP Alto Risco:</strong> 1.000+ disputas/mês E ratio acima de 2%</li>
                <li><strong>Mastercard ECM:</strong> 100+ chargebacks/mês E ratio acima de 1,5%</li>
                <li><strong>Mastercard HECM (Alto Risco):</strong> 300+ chargebacks/mês E ratio acima de 3%</li>
                <li>Merchants incluídos nesses programas pagam multas diretamente às bandeiras</li>
              </ul>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">4. Processo de Chargeback</h2>
            <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">4.1 Fluxo</h3>
            <ol className="list-decimal pl-6 mb-4">
              <li>Cliente contesta a cobrança diretamente no banco ou operadora do cartão</li>
              <li>A processadora notifica a VolatusPay com os dados da contestação</li>
              <li>O vendedor é notificado imediatamente por e-mail e na plataforma</li>
              <li>Prazo de 10 dias corridos para o vendedor apresentar documentos de defesa</li>
              <li>A VolatusPay submete a defesa à processadora</li>
              <li>Análise pela operadora/bandeira: 30 a 90 dias</li>
              <li>Decisão final da bandeira, irrevogável após arbitragem</li>
            </ol>

            <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">4.2 Prazos</h3>
            <ul className="list-disc pl-6 mb-4">
              <li><strong>Notificação ao vendedor:</strong> Imediata (e-mail + plataforma)</li>
              <li><strong>Prazo para defesa:</strong> 10 dias corridos a partir da notificação</li>
              <li><strong>Análise pela operadora:</strong> 30 a 90 dias</li>
              <li><strong>Decisão final:</strong> Irrevogável (exceto em processo de arbitragem)</li>
            </ul>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">5. Documentos de Defesa</h2>
            <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">5.1 Produtos Digitais</h3>
            <ul className="list-disc pl-6 mb-4">
              <li>Data e hora do primeiro acesso ao produto (log de sistema)</li>
              <li>Endereço IP do acesso, com geolocalização</li>
              <li>Downloads realizados (arquivos, certificados)</li>
              <li>Progresso em cursos: módulos assistidos, percentual de conclusão</li>
              <li>Tempo total de uso na plataforma</li>
              <li>Termos de Uso aceitos eletronicamente (com timestamp e IP)</li>
              <li>Histórico de comunicações com o comprador (e-mails, chats)</li>
            </ul>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">6. Taxas e Custos</h2>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <h3 className="text-lg font-semibold text-red-800 mb-2">Taxa de Chargeback</h3>
              <p className="text-red-700">
                <strong>R$ 25,00</strong> por chargeback recebido, descontado automaticamente do saldo do vendedor,
                independente do resultado da defesa. Essa taxa cobre os custos administrativos de processamento
                cobrados pelas bandeiras e adquirentes.
              </p>
            </div>

            <ul className="list-disc pl-6 mb-4">
              <li>Cobrada imediatamente após o recebimento da notificação de contestação</li>
              <li>Descontada automaticamente do saldo disponível</li>
              <li>Não reembolsável mesmo em caso de defesa bem-sucedida</li>
              <li>Em caso de saldo insuficiente, gera débito a ser quitado no próximo crédito</li>
            </ul>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">7. Impactos no Vendedor</h2>
            <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">7.1 Escala de Consequências</h3>
            <ul className="list-disc pl-6 mb-4">
              <li><strong>0,0%, 1,0%:</strong> Operação normal sem restrições</li>
              <li><strong>1,0%, 1,5%:</strong> Alerta, monitoramento intensificado, análise da conta iniciada</li>
              <li><strong>1,5%, 2,0%:</strong> Risco alto, possível aplicação de reserva técnica (retenção de até 15% das vendas)</li>
              <li><strong>Acima de 2,0%:</strong> Suspensão preventiva do processamento de cartões</li>
              <li><strong>Reincidência:</strong> Encerramento definitivo da conta vendedora</li>
            </ul>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">8. Prevenção</h2>
            <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">8.1 Boas Práticas</h3>
            <ul className="list-disc pl-6 mb-4">
              <li>Descrição clara, honesta e detalhada de todos os produtos</li>
              <li>Política de reembolso visível antes da finalização da compra</li>
              <li>Canal de atendimento ao cliente ativo e ágil (responda antes que o cliente vá ao banco)</li>
              <li>Confirmação automática de acesso/entrega enviada por e-mail</li>
              <li>Nome reconhecível na fatura do cartão (evita contestações por não reconhecimento)</li>
              <li>Comunicação proativa sobre prazo de entrega e suporte</li>
            </ul>

            <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">8.2 Checkout Transparente</h3>
            <ul className="list-disc pl-6 mb-4">
              <li>Exibir nome da empresa ou produto claramente na descrição da cobrança</li>
              <li>Mostrar valor total de forma clara, incluindo parcelas e juros</li>
              <li>Apresentar política de reembolso antes do pagamento</li>
              <li>Fornecer dados de contato acessíveis na confirmação do pedido</li>
            </ul>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">9. Resultados Possíveis</h2>
            <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">9.1 Defesa Aceita</h3>
            <ul className="list-disc pl-6 mb-4">
              <li>Valor da transação retorna ao saldo do vendedor</li>
              <li>Taxa de R$ 25,00 não é reembolsada</li>
              <li>Registro positivo no histórico da conta</li>
            </ul>

            <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">9.2 Defesa Rejeitada</h3>
            <ul className="list-disc pl-6 mb-4">
              <li>Valor da transação permanece devolvido ao comprador</li>
              <li>Taxa de R$ 25,00 mantida</li>
              <li>Impacto negativo no índice de chargeback da conta</li>
            </ul>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">10. Recursos e Arbitragem</h2>
            <p className="mb-4">
              Após a decisão inicial da operadora, ainda é possível:
            </p>
            <ul className="list-disc pl-6 mb-4">
              <li>Entrar com recurso de pré-arbitragem junto à bandeira (prazo de 30 dias após a decisão)</li>
              <li>Solicitar arbitragem formal para transações acima de R$ 500,00</li>
              <li>Buscar acordo direto com o comprador antes da arbitragem final</li>
            </ul>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">11. Responsabilidades</h2>
            <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">11.1 Do Vendedor</h3>
            <ul className="list-disc pl-6 mb-4">
              <li>Entregar o produto ou serviço exatamente conforme anunciado</li>
              <li>Manter registros completos de todas as transações e acessos</li>
              <li>Responder disputas dentro do prazo de 10 dias</li>
              <li>Fornecer suporte adequado ao comprador antes de qualquer contestação</li>
              <li>Apresentar defesa completa e documentada quando solicitado</li>
            </ul>

            <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">11.2 Da VolatusPay</h3>
            <ul className="list-disc pl-6 mb-4">
              <li>Notificar imediatamente sobre chargebacks recebidos</li>
              <li>Auxiliar na preparação da defesa com dados técnicos disponíveis</li>
              <li>Submeter a defesa à processadora dentro dos prazos das bandeiras</li>
              <li>Representar o vendedor junto às adquirentes no processo de disputa</li>
            </ul>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">12. Suporte</h2>
            <p className="mb-4">
              Nossa equipe especializada está disponível para auxiliar em chargebacks:
            </p>
            <div className="bg-gray-50 p-4 rounded-lg">
              <p><strong>E-mail:</strong> {config?.companyEmail || "volatuspay@gmail.com"}</p>
              {config?.companyPhone && <p><strong>WhatsApp:</strong> {config.companyPhone}</p>}
              <p><strong>Horário:</strong> Segunda a Sexta, 9h às 18h (horário de Brasília)</p>
            </div>

            <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Dica:</strong> A melhor defesa contra chargeback é a prevenção. Responda o cliente
                antes que ele recorra ao banco, a maioria das contestações pode ser resolvida com um
                bom atendimento e política de reembolso transparente.
              </p>
            </div>
          </div>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
