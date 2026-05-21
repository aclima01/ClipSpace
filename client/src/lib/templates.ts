export interface Template {
  id: string;
  label: string;
  emoji: string;
  content: () => string;
}

function today(): string {
  return new Date().toLocaleDateString("pt-BR");
}

export const TEMPLATES: Template[] = [
  {
    id: "standup",
    label: "Daily Standup",
    emoji: "📋",
    content: () => `## Standup · ${today()}

**Feito**
-

**Fazendo**
-

**Bloqueios**
- nenhum

**Tasks abertas**
- [ ] @`,
  },
  {
    id: "reuniao",
    label: "Reunião",
    emoji: "🗓",
    content: () => `## Reunião · ${today()}

**Participantes:** @

**Pauta**
1.

**Decisões**
-

**Ações**
- [ ] @

**Próxima reunião:** `,
  },
  {
    id: "feature",
    label: "Feature / Entrega",
    emoji: "⚙️",
    content: () => `## Feature:

**Objetivo:**

**Critérios de aceite**
- [ ]
- [ ]

**Dependências:**

**Tasks**
- [ ] @
- [ ] @

**Status:** em andamento`,
  },
  {
    id: "bug",
    label: "Bug / Incidente",
    emoji: "🐛",
    content: () => `## Bug:

**Severidade:** médio
**Ambiente:**
**Reportado por:** @

**Descrição**


**Passos para reproduzir**
1.

**Impacto**


**Correção**
- [ ] @

**Status:** aberto`,
  },
  {
    id: "decisao",
    label: "Decisão",
    emoji: "✅",
    content: () => `## Decisão: · ${today()}

**Contexto**


**Opções consideradas**
- Opção A —
- Opção B —

**Decisão**
>

**Consequências**
- ✓
- ✗

**Responsável:** @`,
  },
  {
    id: "retro",
    label: "Retrospectiva",
    emoji: "🔁",
    content: () => `## Retrospectiva · ${today()}

**O que foi bem**
-

**O que pode melhorar**
-

**Ações para o próximo ciclo**
- [ ] @
- [ ] @`,
  },
  {
    id: "analise",
    label: "Investigação",
    emoji: "🔬",
    content: () => `## Análise:

**Hipótese**


**Evidências**
-

**Conclusão**


**Próximos passos**
- [ ] @`,
  },
];
