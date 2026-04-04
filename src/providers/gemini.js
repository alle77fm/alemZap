import { GoogleGenerativeAI } from '@google/generative-ai'

export async function call({ apiKey, model = 'gemini-2.0-flash', systemPrompt, knowledgeBase, history, message, temperature = 0.7, top_p = 1.0, response_format = 'text' }) {
  const genAI = new GoogleGenerativeAI(apiKey)

  const systemContent = [
    systemPrompt,
    knowledgeBase ? `\n\n## Base de Conhecimento\n${knowledgeBase}` : '',
  ].filter(Boolean).join('')

  const gemini = genAI.getGenerativeModel({
    model,
    systemInstruction: systemContent,
    generationConfig: { 
      temperature, 
      topP: top_p,
      responseMimeType: response_format === 'json' ? 'application/json' : 'text/plain'
    }
  })

  // Converte histórico para formato Gemini
  const geminiHistory = (history || []).map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }))

  const chat = gemini.startChat({ history: geminiHistory })
  const result = await chat.sendMessage(message)
  return result.response.text()
}
