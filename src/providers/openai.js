import OpenAI from 'openai'
import { ACTION_DEFINITIONS, executeAction } from '../services/actions.js'

export async function call({ apiKey, model = 'gpt-4.1-mini', systemPrompt, knowledgeBase, history, message, temperature = 0.7, top_p = 1.0, response_format = 'text', useActions = false }) {
  const client = new OpenAI({ apiKey })

  // Monta o input com histórico
  const input = []

  if (history?.length) {
    for (const msg of history) {
      input.push({ role: msg.role, content: msg.content })
    }
  }

  input.push({ role: 'user', content: message })

  // System prompt + knowledge base separados
  const systemContent = [
    systemPrompt,
    knowledgeBase ? `\n\n## Base de Conhecimento\n${knowledgeBase}` : '',
  ].filter(Boolean).join('')

  const params = {
    model,
    instructions: systemContent,
    input,
    temperature,
    top_p,
    ...(response_format === 'json' && { response_format: { type: 'json_object' } }),
    ...(useActions && { tools: ACTION_DEFINITIONS }),
  }

  let response = await client.responses.create(params)

  // Loop de execução de actions
  while (response.status === 'requires_action' || hasToolCall(response)) {
    const toolCall = extractToolCall(response)
    if (!toolCall) break

    const result = await executeAction(toolCall.name, toolCall.arguments)

    response = await client.responses.create({
      ...params,
      previous_response_id: response.id,
      input: [{ type: 'tool_result', tool_use_id: toolCall.id, content: JSON.stringify(result) }],
    })
  }

  return extractText(response)
}

function hasToolCall(response) {
  return response.output?.some(o => o.type === 'function_call')
}

function extractToolCall(response) {
  const call = response.output?.find(o => o.type === 'function_call')
  if (!call) return null
  return {
    id: call.id,
    name: call.name,
    arguments: typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments,
  }
}

function extractText(response) {
  return response.output
    ?.filter(o => o.type === 'message')
    .flatMap(o => o.content)
    .filter(c => c.type === 'output_text')
    .map(c => c.text)
    .join('\n') || ''
}
