import OpenAI from 'openai'

export async function call({ apiKey, model = 'deepseek-chat', systemPrompt, knowledgeBase, history, message, temperature = 0.7, top_p = 1.0, response_format = 'text' }) {
  const client = new OpenAI({ 
    apiKey,
    baseURL: 'https://api.deepseek.com/v1',
  })

  const messages = []
  
  const systemContent = [
    systemPrompt,
    knowledgeBase ? `\n\n## Base de Conhecimento\n${knowledgeBase}` : '',
  ].filter(Boolean).join('')

  if (systemContent) messages.push({ role: 'system', content: systemContent })

  if (history?.length) {
    for (const msg of history) {
      if (msg.role !== 'system') {
        messages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content })
      }
    }
  }

  messages.push({ role: 'user', content: message })

  const params = {
    model,
    messages,
    temperature,
    top_p,
    ...(response_format === 'json' && model !== 'deepseek-reasoner' && { response_format: { type: 'json_object' } }),
  }

  const completion = await client.chat.completions.create(params)
  return completion.choices[0].message.content
}
