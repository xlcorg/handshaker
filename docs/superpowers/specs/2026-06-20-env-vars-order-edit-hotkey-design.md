# Порядок переменных + хоткей открытия Edit environment — дизайн

**Дата:** 2026-06-20 · **Статус:** утверждён (брейншторм в сессии)

## Проблема

Два независимых пункта по окну **Edit environment**:

1. **Порядок переменных не сохраняется.** Если закрыть редактор окружения и
   открыть снова, строки переменных могут идти в другом порядке (выглядит как
   «отсортировано по имени»). Корень — в модели данных, а не в UI:
   `Environment.variables` (и `Collection.variables`) хранятся как
   `HashMap<String, String>` (`crates/handshaker-core/src/env/mod.rs:19`,
   `crates/handshaker-core/src/collections/mod.rs:43`). `HashMap` не хранит
   порядок вставки, а `serde_json` сериализует его в произвольном хеш-порядке —
   поэтому каждый перезапуск/чтение может перетасовать строки. Фронт лишь рендерит
   `Object.entries(...)` как есть (`src/features/envs/VariablesTable.tsx:43`,
   `src/features/catalog/overview/VariablesBlock.tsx`), поэтому починить это на
   фронте нельзя — порядок теряется ещё до прихода данных.

2. **Открытие редактора неудобно.** Сейчас Edit environment открывается только
   через меню свитчера окружений → карандаш
   (`src/features/workflow/WorkflowEnvControl.tsx:111`). Нужен быстрый способ —
   глобальный хоткей.

## Подтверждение фактов (источники)

- **`IndexMap` сохраняет порядок вставки** и сериализуется в тот же JSON-объект в
  этом порядке ([indexmap crate](https://docs.rs/indexmap/latest/indexmap/)).
- **`specta` имеет feature `indexmap`** — даёт `Type` для `IndexMap`, экспортируя
  его тем же TS-типом, что и обычная map (`Partial<Record<K, V>>`)
  ([specta external-crate support](https://deepwiki.com/specta-rs/specta/6-external-crate-support)).
  То есть `IndexMap<String,String>` в IPC-DTO должен дать **тот же** `bindings.ts`,
  что и `HashMap<String,String>` ⇒ в идеале без дрейфа.
- **Порядок ключей JS-объекта** (ECMAScript §9.1.12 `[[OwnPropertyKeys]]`):
  целочисленно-подобные ключи идут **первыми по возрастанию**, затем строковые —
  в порядке вставки
  ([TC39 OrdinaryOwnPropertyKeys](https://tc39.es/ecma262/#sec-ordinaryownpropertykeys),
  [stefanjudis TIL](https://www.stefanjudis.com/today-i-learned/property-order-is-predictable-in-javascript-objects-since-es2015/)).
  ⇒ переменная с чисто-числовым именем (`"42"`) всё равно «всплывёт» наверх (см.
  «Известные ограничения»).
- **Хоткей-паттерн** уже отработан в репозитории: Ctrl+E цикл окружений
  (`src/features/envs/cycle.ts`) — матч по физической `e.code`, capture-фаза +
  `stopPropagation`, гарды AltGr/Shift/repeat.

## Решение

Выбор по брейншторму: **бэкенд хранит порядок**, охват — **окружения + коллекции**,
открытие — **хоткей**.

### 1. Порядок переменных — `IndexMap` (а не явное поле `order`)

Меняем тип `variables` с `HashMap<String,String>` на `IndexMap<String,String>`
(crate `indexmap`, feature `serde`) у обоих структов ядра. Порядок становится
свойством самих данных.

**Почему `IndexMap`, а не поле `order: Vec<String>`:**
- Одна и та же правка для `Environment` + `Collection`, без дублирования
  денормализованного поля и без merge-логики «синхронизировать order с ключами»
  в импорте бандла.
- **Фронтенд не меняется**: `VariablesTable`/`VariablesBlock` уже рендерят
  `Object.entries(...)` в порядке свойств, а `fromRows` пересобирает объект в
  порядке строк. Порядок просто перестаёт теряться на бэкенде.
- Порядок едет с экспорт-бандлом автоматически (бандл сериализует тот же
  serde-шейп ядра).

**Блэст-радиус (бэкенд):**
- `crates/handshaker-core`: `Cargo.toml` (+`indexmap` с feature `serde`);
  `Environment.variables` и `Collection.variables` → `IndexMap`. `metadata`
  **не трогаем** (вне запроса).
- **Движок резолва оставляем нетронутым.** `VariableSet`
  (`crates/handshaker-core/src/vars/mod.rs:33`) остаётся на `&HashMap` — резолв
  порядок-агностичен (только `.get`). Конвертация `IndexMap → HashMap` делается на
  границе (в builder'ах контекста резолва), карты крошечные ⇒ клон копеечный.
  Тесты `vars/mod.rs` не меняются — это доказывает, что движок не сломан.
- `src-tauri`: каждый IPC-нос, **персистящий** vars, обязан стать `IndexMap`,
  иначе порядок теряется при десериализации входящего JSON в `HashMap`:
  `EnvironmentIpc.variables` (`src-tauri/src/ipc/env.rs:12`),
  `CollectionIpc.variables` (`src-tauri/src/ipc/collection.rs:224`),
  параметр `collection_set_variables(vars)`
  (`src-tauri/src/commands/collection.rs:54`,257). Резолв-оверлеи
  `collection_vars`/`env_vars` (`src-tauri/src/ipc/vars.rs:16`) — порядок-агностичны,
  остаются `HashMap`.
- `bundle.rs` + file-stores: `.collect()` / `Default::default()` работают на
  `IndexMap` без изменения логики. Merge импорта (env по имени, vars сливаются,
  импорт побеждает на общих ключах) естественно сохраняет порядок — закрепим
  тестом.
- `specta`: добавить feature `indexmap`. Ожидаем **отсутствие дрейфа**
  `bindings.ts` (IndexMap → тот же `Partial<Record<…>>`). Если дрейф всё же есть —
  закоммитить регенерацию вместе с правкой.

**Фронтенд:** изменений по порядку **не требуется** — `IndexMap` round-trip'ит
порядок через весь канал (фронт строит объект в порядке строк → JSON в этом
порядке → IndexMap хранит порядок → диск → чтение → IPC → `Object.entries`).

### 2. Хоткей открытия Edit environment

- Чистый модуль-предикат (зеркало `cycle.ts`): новый
  `src/features/envs/openEditor.ts` с `isEnvEditHotkey(e)` — матч по **физической**
  `e.code === "KeyE"` + `shiftKey` (то есть **Ctrl+Shift+E**, на mac
  **Cmd+Shift+E**), с гардами AltGr (`altKey`)/repeat. Раскладко-независимо.
- Тонкий `useEffect` в `WorkflowEnvControl` (capture-фаза window-листенер +
  `stopPropagation`, как у `cycle.ts`): открывает редактор активного окружения
  (`setEditor({ originalName: activeEnv })`); нет активного → режим создания
  (`originalName: null`).
- Некликабельный хинт «Edit environment · Ctrl+Shift+E» в футере
  `EnvSwitcherMenu` рядом с существующим хинтом цикла.
- На имплементации сверить, что Monaco не биндит Ctrl+Shift+E по умолчанию (Ctrl+E
  у Monaco занят — поэтому Shift). Коллизия → сменить клавишу.

## Тесты (TDD red→green)

- **Ядро:** `IndexMap` round-trip сохраняет порядок через reload file-store
  (env + collection); порядок переживает merge импорта бандла.
- **Резолв:** существующие тесты `vars` зелёные после конвертации на границе.
- **Фронт:** `isEnvEditHotkey` (Ctrl+Shift+E — да; Ctrl+E / AltGr / repeat — нет);
  `WorkflowEnvControl` открывает редактор активного env по хоткею (и create-mode
  без активного).

## Вне scope

- Drag-reorder переменных в таблице (порядок = порядок ввода; ручная перестановка
  — отдельная фича).
- Порядок `metadata` (запрос только про vars).
- Кнопка-иконка открытия (выбран только хоткей).

## Известные ограничения

- Переменная с **чисто-числовым** именем (`"42"`) всё равно «всплывёт» наверх из-за
  правил порядка ключей JS-объекта (ECMAScript §9.1.12). Для имён переменных это
  патология; фиксируем как known-limit, не чиним.

## Гейт

`cargo test --workspace` · `pnpm test` (vitest) · `pnpm lint` (tsc) ·
`pnpm build` (vite) · bindings no-drift.
