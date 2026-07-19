# Frontend (`src/`) — контекст

React 18 UI. Говорит с ядром только через фасад `src/ipc/client.ts`
(единственный потребитель генерируемого `src/ipc/bindings.ts`).

## Language

**Body completion**:
Чистый ответ на вопрос «что покажет suggest-виджет в этой позиции тела запроса» —
`computeCompletion(fullText, caretOffset, {schema, vars})` в
`src/features/bodyview/completion.ts`. Единственный дом ветвления var-vs-schema,
range-математики и правил вставки; Monaco-регистрация и auto-trigger в BodyView —
только потребители (`source: "vars" | "schema" | null`).
_Avoid_: повторная реализация ветвления в провайдере или обработчиках клавиш.
