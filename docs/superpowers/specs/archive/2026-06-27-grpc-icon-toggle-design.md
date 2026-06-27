# Выключение иконок gRPC — дизайн

**Статус:** 🎉 DONE 2026-06-27 (ff в `main`; коммиты `4d5928b` + `36e9c4b`)
**Дата:** 2026-06-27
**Ветка:** `claude/practical-elgamal-75693f`

## Задача

Дать возможность полностью выключить gRPC-иконку у сохранённых запросов в списке
коллекций. При выключении текст (имя/метод запроса) должен сдвинуться влево, заняв
освободившееся место.

## Текущее состояние

- Pref `grpcIcon: GrpcIconStyle` (`"solid" | "letter" | "outline" | "circle"`),
  дефолт `"solid"`, хранится в localStorage (`handshaker.prefs.v1`),
  `src/lib/use-prefs.ts`.
- Презентационный компонент `GrpcIcon` (`src/features/catalog/GrpcIcon.tsx`) рисует
  16px-индикатор по `variant`. Эти четыре варианта — его контракт.
- Единственное место показа иконки — `RequestRow.tsx`, два места рендера: ветка
  inline-переименования и обычная ветка строки (подтверждено grep'ом — других
  поверхностей с `<GrpcIcon>` нет).
- Настройка — ряд «gRPC icon» в группе «Display» (`AppearancePane.tsx`), контрол —
  `ToggleGroup` с опциями `["solid", "letter", "outline", "circle"]`.

## Решение

Единый контрол: в существующий `ToggleGroup` добавляется опция **`off`** первой —
`off / solid / letter / outline / circle`. Отдельного тумблера нет — «выкл» это
просто ещё одно значение того же pref.

«Off» моделируется отдельным union поверх стиля, чтобы не загрязнять презентационный
компонент значением, которое он не умеет рисовать.

### 1. Модель данных — `src/lib/use-prefs.ts`

- `GrpcIconStyle` остаётся без изменений: `"solid" | "letter" | "outline" | "circle"`
  (контракт `GrpcIcon`).
- Новый тип: `export type GrpcIconPref = GrpcIconStyle | "off";`
- Поле `Prefs.grpcIcon` меняет тип с `GrpcIconStyle` на `GrpcIconPref`.
- Дефолт `PREFS_DEFAULTS.grpcIcon` остаётся `"solid"` — поведение по умолчанию не
  меняется, иконки включены.
- Миграция не требуется: union только расширяется; persisted-значения старых
  пользователей (`"solid"` и т.п.) мёржатся через spread `{ ...PREFS_DEFAULTS,
  ...parsed }` как раньше.

### 2. Рендер — `src/features/catalog/RequestRow.tsx`

- Деструктуризация `const [{ grpcIcon }] = usePrefs();` не меняется (тип теперь
  `GrpcIconPref`).
- Оба места рендера оборачиваются гейтом:
  `{grpcIcon !== "off" && <GrpcIcon variant={grpcIcon} className="flex-none" />}`.
  После проверки `!== "off"` TypeScript сужает `grpcIcon` до `GrpcIconStyle`, так что
  проп `variant` остаётся типобезопасным.
- Сдвиг текста — автоматический: иконка является flex-соседом лейбла с `gap-0.5`/
  `gap-0.5!`. При отсутствии элемента иконки gap схлопывается, лейбл занимает место.
  Правок CSS/вёрстки не требуется.

### 3. Настройка — `src/features/settings/AppearancePane.tsx`

- Тот же ряд «gRPC icon», тот же `ToggleGroup`.
- Опции: `["off", "solid", "letter", "outline", "circle"]`. Лейблы строчные для
  консистентности с существующими (`off`, как `solid`/`letter`).
- `onValueChange` приводит значение к `GrpcIconPref` (вместо `GrpcIconStyle`).
- Хинт ряда уточняется: указывает, что `off` скрывает индикатор.

## Тесты (TDD)

- `src/lib/use-prefs.test.ts`:
  - дефолт `PREFS_DEFAULTS.grpcIcon === "solid"` (существующий тест сохраняется);
  - мёрж persisted `grpcIcon: "off"` поверх дефолтов.
- `src/features/settings/AppearancePane.test.tsx`:
  - клик по опции `off` в ряду «gRPC icon» ставит `readPrefs().grpcIcon === "off"`;
  - при `grpcIcon === "off"` рендер `RequestRow` не содержит `getByLabelText("grpc")`,
    но лейбл запроса остаётся в документе (текст занял место);
  - живое переключение `off → circle` возвращает иконку с `data-variant="circle"`;
  - хелпер `resetPrefs` сбрасывает `grpcIcon` к `"solid"` между тестами.
- `src/features/catalog/GrpcIcon.test.tsx` — без изменений; компонент и его четыре
  варианта не трогаются.

## Границы

- Бэкенд / IPC / `bindings.ts` не затрагиваются — чистый фронтовый pref в localStorage,
  переживает рестарт.
- Строки настроек остаются inline, как и все соседние ряды в `AppearancePane`.
  Централизация всего пейна в `messages.ts` — отдельная задача, вне скоупа.

## Гейт

vitest · `tsc` · `vite build`. Bindings без дрейфа (бэкенд не тронут).
Остаток после кода — живой проход в WebView2: переключение на `off` скрывает иконку и
сдвигает текст; обратное переключение возвращает выбранный стиль; переживает рестарт.
