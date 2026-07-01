# Спека — имена полей в теле = proto-имена (snake_case), как в контракте

**Статус:** 📝 SPEC (одобрена брейнштормом 2026-07-01) — следующий шаг: план.
**Тип:** бэкенд (core, 2 точки) + фронтенд (1 новый модуль + 3 правки). IPC / bindings
не трогаются (`FieldNodeIpc` уже несёт обе формы имени).

## Проблема

Имена полей в теле запроса **не совпадают с контрактом**. Пример: в Contract-табе поле
называется `tax_registration_code` (snake_case, как в `.proto`), а скелет запроса,
автокомплит и тело ответа показывают его как `taxRegistrationCode` (camelCase).

Причина — три поверхности берут имя из разных источников:

| Поверхность | Имя сейчас | Источник |
|---|---|---|
| Contract-таб | `tax_registration_code` | `field.name()` → `proto_name` ([schema.rs:141](../../../crates/handshaker-core/src/grpc/invoke/schema.rs), рендер [proto.ts:66](../../../src/features/contract/proto.ts)) |
| Скелет запроса | `taxRegistrationCode` | `field.json_name()` ([skeleton.rs:44](../../../crates/handshaker-core/src/grpc/invoke/skeleton.rs)) |
| Автокомплит тела | `taxRegistrationCode` | `json_name` ([completion.ts](../../../src/features/bodyview/completion.ts)) |
| Ghost-хинт (Field hints) | `taxRegistrationCode` | `json_name` ([ghost.ts:54](../../../src/features/bodyview/ghost.ts)) |
| Тело ответа | `taxRegistrationCode` | сериализатор prost-reflect по умолчанию (`use_proto_field_name = false`, [tonic_impl.rs:129](../../../crates/handshaker-core/src/grpc/transport/tonic_impl.rs)) |

Handshaker уже выбрал философию «зеркалим `.proto`» — у него есть Contract-таб, показывающий
proto-исходник в snake_case. Остальные поверхности в camelCase — внутреннее противоречие.

## Решение

Все поверхности приводятся к **snake_case** (proto-имена), как в Contract-табе.

Унификация возможна только в сторону snake_case: Contract-таб — это proto-исходник, менять
его нельзя (иначе он врёт про `.proto`).

### Центральный инвариант

> **«Пишем snake_case (proto-имя), распознаём оба».**

Точное зеркало проводного десериализатора proto3-JSON (который делает симметрично наоборот:
эмитит канонический camelCase, но принимает оба имени на вход). Handshaker **эмитит**
proto-имена (скелет, автокомплит-вставка, ghost-хинт, тело ответа), но при **разборе уже
существующего текста** узнаёт и snake_case, и camelCase.

«Распознаём оба» — не украшение, а необходимость (см. «Легаси»).

### Wire-safety

По спецификации proto3-JSON парсер **обязан** принимать оба имени поля — canonical
camelCase и оригинальное snake_case ([ProtoJSON](https://protobuf.dev/programming-guides/json/)).
prost-reflect это соблюдает. Значит отправка snake_case полностью валидна на проводе, а
десериализатор запроса ([mod.rs:129](../../../crates/handshaker-core/src/grpc/invoke/mod.rs))
**не трогаем** — он уже принимает оба. `SerializeOptions::use_proto_field_name(true)`
переключает сериализатор ответа на proto-имена
([docs.rs](https://docs.rs/prost-reflect/latest/prost_reflect/struct.SerializeOptions.html)).

### Ресёрч конкурентов

- **Postman (gRPC)** требует **snake_case** для полей запроса; camelCase — открытый
  feature-request ([#12404](https://github.com/postmanlabs/postman-app-support/issues/12404)).
  То есть массовый инструмент уже зеркалит `.proto`.
- **grpcurl** принимает оба; JSON-вывод по умолчанию camelCase, `-format=text` — snake_case.
- Стиль protobuf: поля в `.proto` — snake_case
  ([Style Guide](https://protobuf.dev/programming-guides/style/)).

Единственная цена snake_case-по-умолчанию — расхождение с дефолтным JSON-выводом grpcurl и
серверными логами (часто camelCase). Косметика: оба валидны на проводе.

## Архитектура

**Эмиттеры** имени (скелет, тело ответа, автокомплит-вставка, ghost-хинт) переходят на
snake_case; **читатели** текста (descendSchema, present-проверки автокомплита и ghost-хинта,
validate) узнают обе формы.

### Бэкенд — 2 точки (core)

1. **Скелет запроса** — [skeleton.rs:44](../../../crates/handshaker-core/src/grpc/invoke/skeleton.rs):
   `field.json_name()` → `field.name()`. Ключи скелета — snake_case.
2. **Сериализатор ответа** — [tonic_impl.rs:129](../../../crates/handshaker-core/src/grpc/transport/tonic_impl.rs):
   к `SerializeOptions::new().skip_default_fields(false)` добавить `.use_proto_field_name(true)`
   (+ обновить доккоммент `message_to_pretty_json`). Тело ответа — snake_case.

### Фронтенд — 1 новый модуль + 3 правки

**Новый** `src/features/bodyview/fieldName.ts` — единственный источник инварианта, чистое ядро:

```
bodyFieldKey(field: FieldNodeIpc): string          // → field.proto_name (что вставляем/пишем)
matchesField(field: FieldNodeIpc, key: string)     // → key === proto_name || key === json_name
fieldPresent(field: FieldNodeIpc, keys: ReadonlySet<string>)  // → любая форма ∈ keys
```

Через хелперы правятся:

1. **`completion.ts`** (автокомплит):
   - `descendSchema` (матч сегмента пути) — `matchesField` вместо `fl.json_name === path[i]`;
   - фильтр «поле уже есть» и oneof-taken — `fieldPresent` вместо `presentKeys.has(fl.json_name)`;
   - `buildValueSuggestions` (поиск поля по `ctx.valueField`) — `matchesField`;
   - `label` и `insertText` подсказки-ключа — `bodyFieldKey(field)` (snake_case).
2. **`ghost.ts`** (ghost / Field hints):
   - «missing» ([ghost.ts:30](../../../src/features/bodyview/ghost.ts)) — `fieldPresent`
     (узнаёт camelCase-ключ ⇒ не дублирует уже введённое поле);
   - видимая строка хинта ([ghost.ts:54](../../../src/features/bodyview/ghost.ts)) —
     `"${bodyFieldKey(fl)}": ${fl.type_label}` (snake_case).
3. **`validate.ts`** (подсветка неизвестных ключей):
   - «известное поле?» ([validate.ts:64](../../../src/features/bodyview/validate.ts)) —
     `matchesField` (camelCase-ключ в легаси-теле не флагается как unknown).

**Contract-таб ([proto.ts](../../../src/features/contract/proto.ts)) — без изменений.** Уже
snake_case; тултип `json_name` у имени поля оставляем (полезен — показывает canonical camelCase).

### Наглядно (для `tax_registration_code`)

```
Скелет:          "tax_registration_code": ""
Автокомплит:     вставляет "tax_registration_code": …
Ghost-хинт:      "tax_registration_code": string
Тело ответа:     "tax_registration_code": "…"
Contract-таб:    string tax_registration_code = N;   (без изменений)
```

## Легаси и совместимость

- **Старые сохранённые запросы (camelCase-тело)** отправляются как раньше (десериализатор
  принимает оба). При открытии: `matchesField`/`fieldPresent` узнают camelCase-ключи ⇒
  **нет** ложных «unknown field» в валидации; **нет** дублирующих подсказок ghost/автокомплита
  (`taxRegistrationCode` уже есть ⇒ `tax_registration_code` не предлагается, две формы одного
  поля в одном объекте не появляются). Миграции тел не требуется.
- Копипейст в grpcurl-JSON (camelCase) будет отличаться именами — оба валидны на проводе.

## Тестирование (TDD, red→green)

**Core:**
- Скелет поля `tax_registration_code` даёт snake_case-ключ и round-trip через
  `DynamicMessage::deserialize` (репро-тест в стиле существующего
  `int64value_skeleton_deserializes_against_descriptor`).
- Многословное поле ответа сериализуется в snake_case; проверить/поправить существующий
  `response_json_emits_default_valued_fields` ([tonic_impl.rs:336](../../../crates/handshaker-core/src/grpc/transport/tonic_impl.rs)).

**Фронт** — в фикстуры добавить поле, где `proto_name != json_name`
(`tax_registration_code` / `taxRegistrationCode`), и доказать:
- `fieldName` (юнит): `bodyFieldKey` → proto_name; `matchesField` истинно для обеих форм;
  `fieldPresent` находит любую форму.
- `completion`: подсказка-ключ вставляет snake_case; `descendSchema` резолвит путь по обеим
  формам; поле не предлагается, если в объекте есть его camelCase-форма.
- `ghost`: видимая строка хинта — snake_case; camelCase-ключ в теле не даёт дублирующего хинта.
- `validate`: camelCase-ключ известного поля не флагается как unknown.

**Гейт:** `cargo test --workspace` · vitest · `tsc -b` · `vite build` · bindings no-drift.

**Live (WebView2):** метод с многословными полями — скелет snake_case, автокомплит вставляет
snake_case, ghost-хинт snake_case, Send проходит, тело ответа snake_case; легаси-запрос с
camelCase-телом всё ещё уходит без ложных предупреждений и дублей.

## Вне scope (YAGNI)

- Pref/тумблер «proto-имена ↔ JSON-имена» (Option D) — отклонён.
- Десериализатор запроса, IPC/bindings, Contract-таб — не трогаются.
- Функции base64-decode / save-response / copy-value — работают со значениями, не ключами.
- Миграция существующих тел на snake_case — не нужна (обе формы уходят на провод).

## Затронутые файлы

- `crates/handshaker-core/src/grpc/invoke/skeleton.rs` — `json_name()` → `name()` + тест.
- `crates/handshaker-core/src/grpc/transport/tonic_impl.rs` — `use_proto_field_name(true)` +
  доккоммент + тест.
- `src/features/bodyview/fieldName.ts` (+ `.test.ts`) — новый, инвариант именования.
- `src/features/bodyview/completion.ts` (+ тест) — эмит snake_case, матч обеих форм.
- `src/features/bodyview/ghost.ts` (+ тест) — snake_case-хинт, present через обе формы.
- `src/features/bodyview/validate.ts` (+ тест) — known-поле через обе формы.

Строк, видимых пользователю (кроме имён полей из `.proto`), нет ⇒ `messages.ts` не трогается.
