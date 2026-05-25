import Anthropic from "@anthropic-ai/sdk";
import { getMessages, createMessage, search, getAISession, saveAISession, clearAISession as dbClearAISession, getPage, getNotebookAiInstructions } from "./db";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function isOverloaded(e: unknown): boolean {
  if (e instanceof Anthropic.APIError) return e.status === 529;
  return String(e).includes("overloaded_error");
}

async function streamWithRetry(
  params: Parameters<typeof client.messages.stream>[0],
  onToken: (t: string) => void
): Promise<Anthropic.Message> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const stream = client.messages.stream(params);
      stream.on("text", onToken);
      return await stream.finalMessage();
    } catch (e) {
      if (attempt < MAX_RETRIES - 1 && isOverloaded(e)) {
        await sleep(2 ** attempt * 2000); // 2s → 4s
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable");
}

const SYSTEM_PROMPT = `You are an AI assistant embedded in ClipSpace, a local-network collaborative note-sharing app.
Help the user analyze, summarize, and act on their notes and team discussions.

Guidelines:
- Always respond in the same language as the conversation messages (likely Portuguese)
- Use markdown formatting: headings, bullet lists, bold for names/actions
- @mentions refer to team members — treat them as assignments
- Be concise and actionable
- When summarizing, highlight: decisions made, pending actions (who owns what), open questions
- Format genuinely NEW action items (not yet in the page) as markdown checkboxes: "- [ ] task description @Owner"
- Already completed items should use "- [x] task description"
- NEVER replicate tasks that already have an ID (#XXXX) — reference them inline by ID only, e.g. "#0042" or "#0042 (@Ian)"
- When summarizing, cite existing task IDs instead of copying the full checkbox text
- Use tools proactively when asked to search or record updates

When posting a summary to the conversation:
- Split the summary into its top-level sections/topics
- Call post_to_conversation ONCE PER SECTION — each call creates a separate message bubble
- ALWAYS post Daily standup topics first (if present), before any other sections
- Then post decisions, action items, blockers, open questions — each as its own bubble
- Keep each bubble focused on one topic; do not merge unrelated sections

When the user responds to a summary (e.g. "Ian já fez X"), use post_to_conversation to record the update.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "post_to_conversation",
    description:
      "Post a message or update to the current ClipSpace conversation. Use this to record summaries, status updates, or action-item updates that the user confirms.",
    input_schema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description: "Markdown content to post to the conversation",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "search_conversations",
    description:
      "Search across all conversations and messages. Use this to answer questions about past notes or activities across multiple sessions.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search terms",
        },
      },
      required: ["query"],
    },
  },
];

export interface AIAction {
  type: "posted" | "searched";
  detail: string;
}

export interface AICallbacks {
  onToken: (token: string) => void;
  onAction: (action: AIAction) => void;
  broadcast: (pageId: string, data: unknown) => void;
}

function buildContext(pageId: string): string {
  const msgs = getMessages(pageId);
  if (msgs.length === 0) return "(conversa vazia)";
  return msgs
    .map(
      (m) =>
        `[${m.device_name} @ ${new Date(m.created_at).toLocaleString("pt-BR")}]:\n${m.content}`
    )
    .join("\n\n---\n\n");
}

export async function chatWithAI(
  pageId: string,
  userMessage: string,
  deviceName: string,
  callbacks: AICallbacks
): Promise<void> {
  const history: Anthropic.MessageParam[] = (getAISession(pageId) as Anthropic.MessageParam[] | null) ?? [];

  // Build effective system prompt: base + optional notebook-level instructions
  const page = getPage(pageId);
  const notebookInstructions = page ? getNotebookAiInstructions(page.notebook_id) : "";
  const effectiveSystemPrompt = notebookInstructions.trim()
    ? `${SYSTEM_PROMPT}\n\n---\n\nNotebook-specific instructions:\n${notebookInstructions}`
    : SYSTEM_PROMPT;

  // On first message, prepend the full conversation context
  const content =
    history.length === 0
      ? `Contexto atual da conversa:\n\n${buildContext(pageId)}\n\n---\n\n${userMessage}`
      : userMessage;

  history.push({ role: "user", content });

  // Agentic loop: stream text, handle tool calls, loop until end_turn
  while (true) {
    const response = await streamWithRetry(
      { model: "claude-sonnet-4-6", max_tokens: 2048, system: effectiveSystemPrompt, tools: TOOLS, messages: history },
      callbacks.onToken
    );
    history.push({
      role: "assistant",
      content: response.content as Anthropic.Messages.ContentBlock[],
    });

    if (response.stop_reason === "end_turn") break;

    if (response.stop_reason === "tool_use") {
      const results: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        let result: string;

        if (block.name === "post_to_conversation") {
          const { content: msgContent } = block.input as { content: string };
          const msg = createMessage(pageId, msgContent, "AI ✦");
          callbacks.broadcast(pageId, {
            type: "message",
            payload: { ...msg, clientId: null },
          });
          callbacks.onAction({
            type: "posted",
            detail: msgContent.slice(0, 100),
          });
          result = "Mensagem postada com sucesso.";
        } else if (block.name === "search_conversations") {
          const { query } = block.input as { query: string };
          const found = search(query);
          callbacks.onAction({ type: "searched", detail: query });
          result = JSON.stringify(found);
        } else {
          result = "Ferramenta desconhecida.";
        }

        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }

      history.push({ role: "user", content: results });
    }
  }

  saveAISession(pageId, history);
}

export function clearAISession(pageId: string): void {
  dbClearAISession(pageId);
}

// ── Message improvement ────────────────────────────────────────────────────────

const IMPROVE_SYSTEM_PROMPT = `Você é um editor de notas no ClipSpace.
Melhore a mensagem fornecida seguindo estas diretrizes, nesta ordem:

1. **Correção gramatical** — corrija erros de ortografia, pontuação e gramática (português)
2. **Melhoria textual** — torne o texto mais claro e conciso sem alterar o significado
3. **Novas tasks** — se houver ações implícitas não rastreadas, formate como checkboxes: \`- [ ] descrição\`
   - Não replique tasks que já possuem ID (#TK-XXXX) — referencie pelo ID
4. **Observações** — se houver algo importante a destacar, adicione ao final com **⚠ Observação:** ou **📌 Nota:**

Retorne APENAS o conteúdo markdown melhorado — sem preâmbulo, sem explicação.
Melhore a estrutura e formato, buscando uma padronização das anotações do usuário. O objetivo é criar uma mensagem mais legível, organizada e útil para acompanhamento futuro.`;

export function buildImproveContext(pageId: string, excludeId: string): string {
  const msgs = getMessages(pageId).filter((m) => m.id !== excludeId).slice(-15);
  if (msgs.length === 0) return "";
  return msgs
    .map((m) => `[${m.device_name}]: ${m.content.slice(0, 300)}`)
    .join("\n\n---\n\n");
}

export async function improveMessage(
  content: string,
  pageContext: string,
  notebookInstructions: string,
  onToken: (token: string) => void
): Promise<void> {
  const systemPrompt = notebookInstructions.trim()
    ? `${IMPROVE_SYSTEM_PROMPT}\n\n---\n\nInstruções do notebook:\n${notebookInstructions}`
    : IMPROVE_SYSTEM_PROMPT;

  const userContent = pageContext
    ? `Contexto da page (últimas mensagens):\n\n${pageContext}\n\n---\n\nMensagem a melhorar:\n\n${content}`
    : `Mensagem a melhorar:\n\n${content}`;

  await streamWithRetry(
    {
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    },
    onToken
  );
}

// ── Morning Briefing ───────────────────────────────────────────────────────────

const BRIEFING_SYSTEM_PROMPT = `You are a productivity assistant embedded in ClipSpace.
Generate a concise morning briefing in the same language as the notes (likely Portuguese).

## Estrutura de saída obrigatória

O contexto já está organizado por Notebook. Mantenha essa estrutura na resposta:

- Use \`## [Nome do Notebook]\` como heading de seção para cada notebook presente no contexto
- Dentro de cada seção de notebook, ordene os itens por criticidade:
  1. **⚠ Itens parados/stale** — marcados com "⚠ parado há Nd" ou "Nd sem atualização". Inclua o marcador ⚠ e a contagem de dias.
  2. **Bloqueios e urgências explícitas** — texto contendo: bloqueado, travado, urgente, prazo, deadline, amanhã, essa semana, dependendo de.
  3. **Itens com @menção** — trabalho atribuído a alguém. Cite @Nome e o quê.
  4. **Demais to-dos** — sem sinal de urgência.
- Se houver atividade recente mas sem to-dos, mencione brevemente as páginas ativas.
- Ao final de todas as seções de notebook, adicione uma seção \`## Resumo\` com:
  - Padrões preocupantes globais (ex: mesmo bloqueio em múltiplos projetos), se houver.
  - **Uma única ação sugerida** para o dia — específica, não uma lista.

## Estilo

- Responda no mesmo idioma das notas (provavelmente português)
- Markdown: bullets, **negrito** para nomes e ações-chave
- Máximo 350 palavras no total
- Use os títulos das pages como contexto para inferir prioridade relativa entre itens sem sinal explícito`;

export async function streamBriefing(
  context: string,
  onToken: (token: string) => void
): Promise<void> {
  await streamWithRetry(
    {
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: BRIEFING_SYSTEM_PROMPT,
      messages: [{ role: "user", content: context }],
    },
    onToken
  );
}
