# Декодирование base64-значений в ответе

**Статус:** ✅ РЕАЛИЗОВАНА (code-complete 2026-06-16, ветка `claude/busy-sinoussi-ab48fe`,
не влита — под live WebView2-проход). План + статус исполнения:
`docs/superpowers/plans/2026-06-15-base64-value-decoder.md`.
**Ветка:** `claude/busy-sinoussi-ab48fe`
**Дата:** 2026-06-15

## Цель

**base64 может встретиться в ЛЮБОМ строковом значении ответа** — не только в
gRPC-полях `bytes` (которые канонично сериализуются в base64: стандартный с
паддингом, на декоде принимаются и URL-safe, и без паддинга — [ProtoJSON
spec][protojson]), но и в обычных строковых полях (токены, вложенные payload'ы,
подписи…). Такие значения **обычно длинные** и непрозрачные: внутри может лежать
вложенный JSON, текст, или бинарь (картинка, gzip, protobuf-блоб). Сейчас
пользователь видит только base64-простыню (у больших значений — 64-символьный
preview + бейдж размера, см. `elide.ts`) и **никак не может заглянуть внутрь**.
Нужна возможность декодировать **любую** такую строку — **значение целиком**
(подстроку внутри строки не ищем: либо всё значение — base64, либо нет).

Добавляем возможность прямо из вьюера ответа:

1. **посмотреть**, что внутри base64 (например, вложенный JSON — pretty-print);
2. **скопировать** декодированное в буфер обмена;
3. **сохранить декодированное прямо в файл** (нативный «Save As»).

## Не-цели (v1 scope)

- **Инлайн-рендер медиа** (показ PNG/JPEG/PDF картинкой прямо в диалоге) —
  **отложено**. v1 для бинаря показывает метку типа (по magic-bytes) + размер +
  «Save to file…», но не рисует само изображение. Превью — кандидат на v2
  (уровень [ViewJSON][viewjson]).
- **Авто-детект и инлайн-индикация** base64-значений в теле ответа (иконки рядом
  с каждым подходящим значением) — **отвергнуто**: противоречит уже принятому в
  этом приложении решению убрать response-side инлайн-декорации («одна
  каноническая поверхность на знание», см. контракт-таб). Декод — **по запросу**.
- Кодирование (текст→base64) — вне scope (это вьюер ответа, не редактор).

## Исследование и best-practice

Запрос пользователя — «поищи аналоги и best practice». Выводы (источники внизу):

- **Детект типа — magic numbers, не эвристики.** [ViewJSON][viewjson] явно
  *«не угадывает по имени поля или длине строки»* — декодирует первые ~64 байта и
  матчит сигнатуры (`89 50 4E 47`→PNG, `FF D8 FF`→JPEG, `%PDF`, `1F 8B`→gzip).
  Быстро даже на 100 МБ. Берём этот подход (Rust-крейт `infer`).
- **Триггер — явная команда + результат во вьюере + кнопки Copy/Save.** Ближайший
  аналог — [VS Code base64viewer][vscode], живёт в том же редакторе (Monaco), что
  и мы: декод по команде, результат показывается во вьюере, есть **кнопка
  сохранения файла и кнопка копирования**. Postman — анти-baseline: UI-аффорданса
  нет вообще, надо руками писать `atob()` во вкладке Tests ([Postman gRPC
  types][postman]). Мы хотим именно UI-путь.
- **Локальный декод** (приватность) — у нас десктоп, всё локально по дефолту.

## UX

> **АМЕНДМЕНТ (2026-06-16, live-фидбек): диалог убран.** «Decode base64» больше
> **не открывает модалку**, а декодирует значение **на бэкенде** и кладёт
> **декодированный текст в буфер обмена** (тост-подтверждение); бинарь (у `info`
> нет `text`) → тост «используйте Save to file…». **Copy value** и **Save decoded
> to file…** — без изменений. Причина: нужен быстрый «задекодь → в буфер», модалка
> избыточна. **Важно:** копируется декод **полного** значения из JSON-дерева
> (в редакторе оно может быть элидировано) — берём не видимый текст, а `node.value`.
> Реализация: чистый `copyDecodedBase64` (`base64_inspect` → `copyToClipboard`,
> бинарь → тост), зовётся из `attachDecodeActions.onDecode` в `BodyView`;
> `DecodeDialog` **удалён** (вместе с drill-down и бинарь-сводкой). Описание
> диалога ниже — **историческое** (как было задумано изначально), оставлено для
> контекста.
>
> **АМЕНДМЕНТ #2 (2026-06-16, live-фидбек): перекомпоновка меню + убран built-in
> Copy.** Итоговое ПКМ-меню (best practice — клипборд-группа над файл-группой,
> «декод» перед «сырым» в каждой, лёгкое перед открывающим диалог, с разделителем):
> - **Copy decoded base64** (быв. «Decode base64») — декод на бэкенде → буфер
>   (бинарь → тост→Save). Гейт `hsValueIsB64`.
> - **Copy value** — сырая строка → буфер. Гейт **`hsValueIsString`** (а не base64),
>   чтобы у не-base64 строки оставался копир в меню после удаления built-in Copy.
> - *(разделитель)*
> - **Save decoded base64 to file…** — декод → нативный Save As. Гейт `hsValueIsB64`.
> - **Save base64 to file…** (НОВОЕ) — **сырой** base64 verbatim в файл (IPC
>   `base64_save_encoded` → `base64.txt`; общий хелпер `save_bytes_via_dialog`).
>   Гейт `hsValueIsB64`.
>
> Две Monaco-группы `9_cutcopypaste` / `9_cutcopypaste_file` (Monaco сортирует
> группы по `localeCompare`, префикс — раньше) дают разделитель между клипбордом и
> файлами. **Built-in «Copy» Monaco** убран из **read-only** (response) редактора —
> он дублировал «Copy value» (Ctrl+C-биндинг жив; в request-редакторе нативные
> Cut/Copy/Paste нетронуты). `contextMenuCleanup` обобщён до
> `stripMenuItems(set)` + `installContextMenuCleanup(editor,{stripCopy})`.

Полный визуал согласован на брейншторме (макет `base64_decode_response_flow`).
Три состояния:

**Триггер — контекстное меню (ПКМ) по ЛЮБОМУ строковому значению в табе Body
ответа.** Не привязано ни к `bytes`-полям, ни к большим/элидированным значениям:
base64 может лежать в **любой** строке (часто длинной, но не обязательно).
Декодируем **значение целиком** — подстроку не ищем. Пункты:
- **Decode base64** — декодирует **всё** значение под курсором **на бэкенде** и
  **копирует декодированный текст в буфер обмена** (см. амендмент выше; диалога
  больше нет). Показывается на строковых значениях, прошедших charset-гейт (ниже);
- **Copy value** — копирует сырую строку (дублирует существующий
  Ctrl+dblclick-копир, но даёт дискаверабилити); **не гейтится** — доступно на
  любом строковом значении;
- **Save decoded to file…** — декодирует **всё** значение и сразу открывает
  нативный «Save As» (без открытия диалога-вьюера); под **тем же** charset-гейтом,
  что и Decode (сохранять «декод» не-base64 строки бессмысленно).

**Диалог декода (текст / JSON).** Шапка: `Decoded` + чип типа (`JSON`/`Text`) +
размер (`1.2 KB`) + закрытие. Тело — **переиспользуем `BodyView` (mode=response,
read-only Monaco)**: JSON автоматически pretty-print + фолдинг, и **вложенный
base64 внутри декодированного JSON снова доступен на ПКМ→Decode — бесплатно**
(та же машинерия). Футер: **Copy** + **Save to file…**.

**Диалог декода (бинарь).** magic-bytes даёт метку (`PNG image`, `gzip`, `PDF`…)
+ MIME + размер; тело — компактная сводка (`image/png · 1024×768 · N bytes`, без
рендера картинки в v1); футер ведёт **Save to file…** (primary), **Copy base64**
(копирует исходную строку — бинарь нельзя положить в буфер как текст).

**Гейт «похоже на base64»** (фронт, для показа пунктов Decode/Save) — чистая
функция над **всем** значением: charset `^[A-Za-z0-9+/_-]+={0,2}$` (стандартный
**и** URL-safe алфавит), длина ≥ 4 (минимум для одного байта), **минус
исключение hex+дефис**. **Без верхнего/жёсткого порога длины** — пользователь
явно сказал «декодировать *любую* строку»; «обычно длинные» — наблюдение, не
ограничение. Charset-чек убирает явный шум (строки с пробелами/`:`/прозой).

**Исключение hex+дефис** (`^[0-9a-fA-F-]+$`) — добавлено по live-фидбеку
(2026-06-16): UUID (`0ef5085e-…`), hex-хэши (md5/sha) и hex-id состоят только из
hex-цифр и дефисов, а это всё валидные символы URL-safe base64 → по charset'у
неотличимы (очень частый ложный плюс на `id`-полях). Настоящий base64 осмысленных
данных практически никогда не бывает целиком hex+дефис (почти всегда есть
`g`–`z`/`G`–`Z`/`+`/`/`), поэтому фильтр снимает шум без практических ложных
**минусов**.

Оставшиеся false-positive (enum-слова, слаги без hex) **не страшны**: источник
истины — бэкенд. Если значение прошло гейт, но не декодируется → IPC `Err` → тост
«Not valid base64»; если декодируется в мусор → покажется как `Binary` со сводкой.
«Слишком широкий» гейт безопасен (максимум — лишний пункт меню).

## Архитектура

Декод+сниффинг+сохранение — в **Rust** (ядро/`src-tauri`). Причины: корректная
работа с бинарём (JS `atob`→binary-string→`Uint8Array` хрупок и легко бьёт
не-ASCII), magic-bytes удобнее в Rust (`infer`), а нативный «Save As» **в любом
случае** требует `tauri-plugin-dialog`. Один владелец логики — меньше рассинхрона.

> **Альтернатива (отвергнута):** декод во фронте (`atob` + `TextDecoder({fatal})`
> + `JSON.parse`, magic-байты мини-таблицей в JS). Даже она тянет
> `tauri-plugin-dialog` для Save и `tauri-plugin-fs` (или Rust-команду) для
> записи — выигрыша по зависимостям нет, а бинарь-корректность хуже. Поэтому
> backend-first.

### Декодирование (лениентность — критично)

Принимаем **оба алфавита и любой паддинг** (см. [protojson][protojson]):
перед декодом срезаем пробелы/переносы и опциональный `data:<mime>;base64,`
префикс; пробуем `STANDARD` с `DecodePaddingMode::Indifferent`, при неудаче —
`URL_SAFE` indifferent. Крейт `base64` (Engine API). Пустой результат → состояние
«Empty».

### Классификация после декода

1. Валидный **UTF-8**? → пробуем `serde_json::from_slice` → если парсится:
   `kind = Json`; иначе `kind = Text`. В обоих случаях `text = Some(<сырой
   декодированный UTF-8>)` — pretty-print JSON делает `BodyView` на фронте, бэк
   отдаёт сырой текст.
2. Не UTF-8 → `kind = Binary`; `infer::get(&bytes)` → `mime`/`extension`
   (при отсутствии матча — `application/octet-stream` / `bin`). `text = None`.

### IPC-поверхность (новый модуль, specta-bindings)

```rust
#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum Base64KindIpc { Json, Text, Binary }

#[derive(serde::Serialize, specta::Type)]
pub struct Base64InspectIpc {
    pub kind: Base64KindIpc,
    pub size_bytes: u32,          // specta режет u64 → u32 (ответы << 4 ГБ; saturate)
    pub text: Option<String>,     // Some для Json/Text; None для Binary
    pub mime: Option<String>,     // Some для Binary
    pub extension: Option<String>,// предлагаемое расширение (json/txt/png/…)
}

// Ошибка = строка не валидный base64 → фронт показывает тост.
#[tauri::command] #[specta::specta]
async fn base64_inspect(input: String) -> Result<Base64InspectIpc, String>;

// Декодирует, открывает нативный Save As (имя `decoded.<ext>` + фильтр по типу),
// пишет байты. Ok(Some(path)) — сохранено; Ok(None) — отменён; Err — сбой.
#[tauri::command] #[specta::specta]
async fn base64_save(input: String) -> Result<Option<String>, String>;
```

`base64_save` сам сниффит тип и подбирает имя/фильтр (чтобы пункт меню «Save
decoded to file…» работал без предварительного `inspect`). Нативный диалог —
`app.dialog().file().set_file_name(..).add_filter(..).blocking_save_file()`
([Tauri 2 dialog][tauridialog]), запись — `std::fs::write` (плагин-fs не нужен).

`src/ipc/bindings.ts` — **git-tracked**, регенерируем `export-bindings` и
коммитим вместе с IPC-изменением.

### Регистрация плагина

`tauri-plugin-dialog` в `src-tauri/Cargo.toml` + `.plugin(tauri_plugin_dialog::
init())` + permission в capability (`dialog:allow-save`). JS-обёртка плагина в v1
не нужна (диалог дёргаем из Rust), но npm-пакет можно не ставить.

### Фронтенд

- **`src/features/bodyview/decode.ts`** (новый, чистый): `looksLikeBase64(s)` —
  charset-гейт над всем значением (`^[A-Za-z0-9+/_-]+={0,2}$`, длина ≥ 4, **без**
  верхнего порога). Юнит-тестируемо.
- **`src/features/bodyview/valueAtOffset.ts`** (или дополнить `copyAtOffset`):
  `stringValueAtOffset(tree, spans, offset): string | null` — отдаёт **полное**
  значение string-ноды под курсором (у элидированной ноды в дереве лежит полный
  `value`, не preview — большие base64 берутся целиком). Не-string → null.
- **Контекстное меню в `BodyView` (mode=response).** В `onMount` регистрируем
  `editor.addAction(...)` для пунктов **без keybinding** (только
  `contextMenuGroupId`/`contextMenuOrder`) — это обходит известную ловушку
  «Monaco `addCommand` глобален/last-wins» (она про keybinding-реестр; чистый
  пункт меню scoped на инстанс). Видимость Decode/Save гейтим контекст-ключом
  `hsValueIsB64`, выставляемым в `onContextMenu` по значению под кликом (прошло
  `looksLikeBase64`); фолбэк — показывать всегда и на `run` при не-base64 кидать
  тост. Действия (`run`):
  - Decode base64 → `props.onDecode?.(wholeValue)`;
  - Copy value → `copyToClipboard(wholeValue)` (как сейчас);
  - Save decoded to file… → `base64_save(wholeValue)` + тост по результату.
  Регистрируем **только** в response-mode; диспозим на unmount. `onDecode`
  принимает строку-значение целиком.
- **`src/features/response/DecodeDialog.tsx`** (новый): Radix-диалог (наш
  `ui/dialog`). На открытие зовёт `base64_inspect(value)`; рендерит шапку (чип
  kind + размер), тело (`BodyView` для Json/Text; сводку для Binary), футер
  (Copy / Save to file…). Copy: текст для Json/Text, исходная строка для Binary.
  Save: `base64_save(value)`. Ошибка inspect → тост + закрытие.
- **Проводка состояния** в `ResponseBody`/`ResponsePanel`: владелец `decodeTarget`
  (строка | null), `<DecodeDialog>` рендерится при наличии; `onDecode` из
  `BodyView` ставит цель. (Диалог — app-level, поэтому состояние выше `BodyView`.)

Буфер обмена — переиспользуем существующий `copyToClipboard` (`@/lib/clipboard`,
`navigator.clipboard`), которым уже пользуется body-копир ответа.

## Затрагиваемые файлы

| Файл | Изменение |
| --- | --- |
| `crates/handshaker-core/src/base64/mod.rs` | **новый** — лениентный декод + классификация (UTF-8/JSON) + `infer`-сниффинг; чисто/OS-независимо; юнит-тесты |
| `crates/handshaker-core/src/lib.rs` | `pub mod base64;` |
| `crates/handshaker-core/Cargo.toml` | + `base64`, `infer` (детект — чистый, место в ядре) |
| `src-tauri/src/ipc/base64.rs` | **новый** — `Base64InspectIpc` / `Base64KindIpc` DTO (specta) |
| `src-tauri/src/commands/base64.rs` | **новые** команды `base64_inspect`, `base64_save` (Save As + запись — Tauri-слой) |
| `src-tauri/Cargo.toml` | + `tauri-plugin-dialog` |
| `src-tauri/src/lib.rs` | `mod`-ы; `.plugin(tauri_plugin_dialog::init())`; обе команды в `collect_commands!` и обработчик |
| `src-tauri/capabilities/default.json` | permission `dialog:allow-save` |
| `src/ipc/bindings.ts` | регенерация (tracked) |
| `src/features/bodyview/decode.ts` (+ `.test.ts`) | **новый** — `looksLikeBase64` (charset-гейт, без порога длины), хелперы |
| `src/features/bodyview/valueAtOffset.ts` (+ `.test.ts`) | **новый** — `stringValueAtOffset` |
| `src/features/bodyview/BodyView.tsx` | контекст-меню действия (response-mode), `onDecode` проп |
| `src/features/response/DecodeDialog.tsx` (+ `.test.tsx`) | **новый** — диалог |
| `src/features/response/ResponseBody.tsx` / `ResponsePanel.tsx` | проводка `decodeTarget` + рендер диалога |

## Тестирование

**Rust (ядро, юнит):**
- Декод-лениентность: стандартный+паддинг, URL-safe, без паддинга, с
  пробелами/переносами, с `data:…;base64,` префиксом, мусор → `Err`.
- Классификация: base64 от `{"a":1}` → `Json` + сырой текст; от `"hello"`-текста
  → `Text`; от PNG-сигнатуры → `Binary` + `image/png`/`png`; от gzip → `gzip`;
  не-UTF-8 без матча → `Binary`/`octet-stream`. Пустой вход → размер 0.
- `size_bytes` = длина декодированных байт.

**Фронт (vitest):**
- `looksLikeBase64`: стандартный/URL-safe → true; короткая валидная (`aGk=`,
  4 симв.) → true (порога длины нет); `<4` симв. → false;
  пробелы/кириллица/`{}`/`:` → false; «==» хвост — ок.
- `stringValueAtOffset`: оффсет в string-ноде (в т.ч. элидированной) → полное
  значение; в object/number → null.
- `DecodeDialog` (мок IPC `base64_inspect`): Json → BodyView с pretty-JSON + чип
  `JSON`; Text → чип `Text`; Binary → сводка + `Save to file…` + нет BodyView;
  `Err` → тост. Copy (мок `copyToClipboard`); Save (мок `base64_save`) для обеих
  кнопок. Полный прогон suite (новый экспорт ломает частичные `vi.mock`).
- `BodyView` response-mode: ПКМ-экшены зарегистрированы; `onDecode` зовётся с
  полным значением строки; request-mode их **не** регистрирует.

Гейт: vitest · tsc · vite build · `cargo test --workspace` · bindings no-drift.

## Риски

| Риск | Митигация |
| --- | --- |
| Monaco `addAction` и глобальные команды (память: addCommand last-wins) | Регистрируем **без keybinding** (только contextMenu) → keybinding-реестр не трогаем; scoped на инстанс; только response-mode; диспоз на unmount. |
| Контекст-ключ `hsValueIsB64` не успевает выставиться до показа меню | Фолбэк: показывать «Decode» всегда, на `run` при не-base64 — тост. Решаем живьём. |
| `navigator.clipboard` за permission-промптом в WebView2 (память) | Переиспользуем `copyToClipboard`, которым **уже** работает body-копир ответа; если всплывёт — перевести на `tauri-plugin-clipboard-manager` (уже в проекте). |
| Большой декодированный текст | `BodyView` уже элидит строки >4096 и имеет 50 МБ-потолок — наследуется. |
| `tauri-plugin-dialog` capability не добавлен → диалог молча не открывается | Явный permission `dialog:allow-save` в capability + ручной live-чек. |
| Двойной декод (inspect + save) на больших значениях | Декод дешёв относительно интеракции с диалогом; стейтлес — без кеша. |

## Live-проход (после имплементации)

В WebView2: вызвать gRPC-метод с `bytes`-полем, где лежит (а) вложенный JSON —
ПКМ→Decode показывает pretty-JSON, Copy и Save (`.json`) работают; (б) текст;
(в) PNG/бинарь — метка типа + Save пишет валидный файл. Проверить URL-safe
base64, отмену Save (None, без ошибки), пункт «Decode» скрыт на не-base64
значении.

---

Источники:
[protojson]: https://protobuf.dev/programming-guides/json/ — ProtoJSON: `bytes`
как стандартный base64 с паддингом; на декоде принимаются стандартный/URL-safe,
с паддингом и без.
[viewjson]: https://viewjson.net/blog/how-to-debug-base64-images-in-json/ —
magic-number детект (первые 64 байта), инлайн-превью медиа.
[vscode]: https://github.com/JasonMejane/vscode-base64viewer — декод в редакторе,
кнопки save-file и copy, авто-детект типа.
[postman]: https://learning.postman.com/docs/sending-requests/grpc/understanding-grpc-types
— bytes как base64 JSON-строка; декод — скриптом в Tests (анти-baseline).
[tauridialog]: https://v2.tauri.app/plugin/dialog/ — `save()` (JS) и
`app.dialog().file()…blocking_save_file()` (Rust) возвращают выбранный путь.
