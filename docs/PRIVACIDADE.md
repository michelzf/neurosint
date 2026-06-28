# Privacidade — nuvem vs. local, e o que é enviado a quem

> Você está lidando com **dados de saúde sensíveis de um ente querido.** Leia isto antes de usar.
> Ver também o [DISCLAIMER.md](../DISCLAIMER.md).

## O princípio

O template é construído para que **os dados reais do seu familiar fiquem só na sua máquina**.
O `.gitignore` ignora as pastas de dados (`exames/`, `consultas/`, `DBS/`, `*.dcm`, `*.pdf`…) e
os segredos (`.env`, `*secret*`…). **Trabalhe sempre em um repositório privado** ao usar dados reais.

Mas há um ponto inescapável: **assim que você manda um dado para uma API em nuvem, ele sai da
sua máquina** e passa pela política de privacidade do provedor.

## O que é enviado a quem (modo nuvem — padrão)

| Componente | Provedor | O que sai da sua máquina |
|------------|----------|--------------------------|
| Agentes (Camada 0) | Anthropic (Claude) | O conteúdo dos exames/consultas que o agente lê para responder |
| Evidência (Camada 3) | PubMed/serviços dos MCPs | As **consultas** de busca (não os dados do paciente, em geral) |
| Assistente — raciocínio (Camada 4) | Anthropic | Contexto clínico + mensagens do grupo |
| Assistente — transcrição/visão | OpenAI (Whisper/visão) | Áudios e imagens enviados no grupo |
| Assistente — voz | ElevenLabs | O **texto** da resposta (para virar áudio) |
| Banco de dados | Supabase (seu projeto) | Histórico, sintomas, medicação (no SEU projeto) |
| WhatsApp | Evolution API (sua instância) | As mensagens do grupo |

Provedores podem registrar requisições conforme suas políticas e cruzar jurisdições. Em troca,
você ganha o raciocínio clínico dos modelos de fronteira — onde os prompts foram afinados.

## Modo local (experimental)

Para quem prioriza privacidade total, dá para manter o processamento na máquina:

- **Raciocínio:** [Ollama](https://ollama.com) rodando um modelo local.
- **Transcrição:** [whisper.cpp](https://github.com/ggerganov/whisper.cpp) no lugar do Whisper.

**Trade-off honesto:** modelos locais pequenos (7–8B) **não igualam** os modelos de fronteira em
raciocínio clínico complexo. São adequados para resumo e organização; **arriscados** para
raciocínio diagnóstico. Use com ceticismo redobrado. (Na **Camada 4** — assistente de WhatsApp —
este modo é documentado, mas não plug-and-play: requer adaptar os clientes. Já no **produto**
(preview), o modo 100% local é um runbook de um comando, com guard anti-egress — ver
[EXECUCAO.md](EXECUCAO.md).)

## Sua responsabilidade legal

- **LGPD (Brasil) / GDPR (UE) e leis equivalentes são responsabilidade do usuário.** Você é o
  controlador desses dados.
- Não compartilhe dados de saúde de terceiros sem base legal/consentimento.
- Se um segredo vazar, **rotacione a credencial imediatamente** (ver [SECURITY.md](../SECURITY.md)).
- Prefira chaves de API com escopo mínimo e vida curta. Guarde-as em `.env`/Secret Manager,
  nunca no código versionado.

## Resumo da decisão

- Prioriza **qualidade de raciocínio** → modo nuvem (ciente de que dados vão a terceiros).
- Prioriza **privacidade total** → modo local (ciente de que o raciocínio é mais fraco).
- Em ambos os casos: **dados reais em repo privado**, segredos fora do versionamento, e o
  médico sempre no comando.
