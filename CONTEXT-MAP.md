# Context Map

Handshaker — один Cargo+pnpm воркспейс, три контекста. Подробности конвенции —
`docs/agents/domain.md`.

## Contexts

- [gRPC Core](./crates/handshaker-core/CONTEXT.md) — OS-независимое ядро:
  reflection, invoke, коллекции, окружения, auth, резолв переменных
- [IPC](./src-tauri/CONTEXT.md) — Tauri-слой: команды, specta-биндинги, стейт
- **Frontend** (`src/`) — React 18 UI; своего `CONTEXT.md` пока нет (создать
  лениво при первом разрешённом термине)

## Relationships

- **Core → IPC**: команды `src-tauri` оборачивают модули ядра; ядро specta-free,
  проводные типы — `*Ipc`-зеркала в `src-tauri/src/ipc/`
- **IPC → Frontend**: `src/ipc/bindings.ts` генерируется tauri-specta;
  фронт потребляет его только через фасад `src/ipc/client.ts`
