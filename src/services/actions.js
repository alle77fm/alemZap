// Definições das actions disponíveis para a IA
export const ACTION_DEFINITIONS = [
  {
    type: 'function',
    name: 'criarPedido',
    description: 'Cria um novo pedido para o cliente',
    parameters: {
      type: 'object',
      properties: {
        cliente: { type: 'string', description: 'Nome do cliente' },
        itens: { type: 'string', description: 'Itens do pedido' },
        endereco: { type: 'string', description: 'Endereço de entrega' },
      },
      required: ['cliente', 'itens'],
    },
  },
  {
    type: 'function',
    name: 'gerarLinkPagamento',
    description: 'Gera um link de pagamento para um pedido',
    parameters: {
      type: 'object',
      properties: {
        pedidoId: { type: 'string', description: 'ID do pedido' },
        valor: { type: 'number', description: 'Valor em reais' },
      },
      required: ['pedidoId', 'valor'],
    },
  },
  {
    type: 'function',
    name: 'consultarStatusPedido',
    description: 'Consulta o status de um pedido existente',
    parameters: {
      type: 'object',
      properties: {
        pedidoId: { type: 'string', description: 'ID do pedido' },
      },
      required: ['pedidoId'],
    },
  },
]

// Executores — implemente a lógica real aqui
const handlers = {
  criarPedido: async ({ cliente, itens, endereco }) => {
    // TODO: integrar com sistema de pedidos
    const pedidoId = `PED-${Date.now()}`
    return { success: true, pedidoId, mensagem: `Pedido ${pedidoId} criado para ${cliente}` }
  },

  gerarLinkPagamento: async ({ pedidoId, valor }) => {
    // TODO: integrar com Stripe, Mercado Pago, etc.
    return { success: true, link: `https://pagamento.exemplo.com/${pedidoId}`, valor }
  },

  consultarStatusPedido: async ({ pedidoId }) => {
    // TODO: buscar no banco de dados real
    return { success: true, pedidoId, status: 'em_preparo', previsao: '30 minutos' }
  },
}

export async function executeAction(name, args) {
  const handler = handlers[name]
  if (!handler) throw new Error(`Action desconhecida: ${name}`)
  return await handler(args)
}
