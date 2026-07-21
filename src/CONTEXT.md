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

**Edit buffer (буфер правки)**:
Редактируемый блок Collection Overview (Variables, Links, Auth) держит правку в
локальном буфере: persist на каждое изменение, но обратно из стора буфер
пересеивается только при смене коллекции — эхо persist→reload и внешние изменения
открытую правку не затирают.
_Avoid_: полностью управляемое поле, чьё значение выводится из стора на каждый рендер.

**Empty auth header/prefix**:
Пустой Header name в auth-конфиге — состояние только буфера правки. При persist
пусто → дефолт вида (`authorization` / `x-api-key`); стор пустого header name
не хранит, нормализация — момент сохранения, не момент ввода.
