# Unary call

A unary Send against the in-repo echo server returns a Pong. The end state
that proves this works: the response header shows `OK` plus an elapsed time
(`src/features/response/RespMeta.tsx`), and the body text contains the
`echoed` field. For `Ping.id` of `hi`, the server sets `echoed` to `echo: hi`.

## Sub-features

- Address field (`aria-label="draft-address"`, placeholder `host:port`) with `{{var}}` highlighting.
- TLS lock (`aria-label="TLS inherit"` on a new draft, then `TLS on` / `TLS off` as it cycles).
- Method picker. Closed label is `Select a method`. Search placeholder is `Find service.method…`.
- Request / Metadata / Auth tabs. Body editor is the Request tab.
- `▶ Send` (disabled while the method is empty). Ctrl+Enter sends from the body.
- Response tabs Body, Trailers, Headers, Contract. Idle body copy is `Awaiting first call`.

## How to get to it (user POV)

Start the echo server in another terminal:

```sh
cargo run -p handshaker-core --example echo_server -- --port 50051
```

It listens on `127.0.0.1:50051` with reflection. Service `test.Echo`, unary
method `Send` (`Ping { id }` → `Pong { id, echoed }`). TLS stays off.

In the window: sidebar `+` → `New request`. Type `127.0.0.1:50051` in the
address. Open the method dropdown (the control that says `Select a method`),
wait until `Echo` / `Send` appears, click `Send`. The `▶ Send` button enables.
Click it. The right-hand pane leaves `Awaiting first call` and shows `OK`.

## Driving it with Tauri WebDriver

```sh
.cursor/skills/verify-handshaker/scripts/hsdrv.py screenshot unary-before
.cursor/skills/verify-handshaker/scripts/hsdrv.py click "[aria-label='new-item']"
.cursor/skills/verify-handshaker/scripts/hsdrv.py click "[aria-label='new-request']"
.cursor/skills/verify-handshaker/scripts/hsdrv.py screenshot unary-draft
.cursor/skills/verify-handshaker/scripts/hsdrv.py click "[aria-label='draft-address']"
```

The address input is content-managed by `VarHighlightInput`. Set it with a
native value setter and an input event, then blur so React commits:

```sh
.cursor/skills/verify-handshaker/scripts/hsdrv.py eval 'const el=document.querySelector("[aria-label=draft-address]"); const proto=Object.getPrototypeOf(el); const set=Object.getOwnPropertyDescriptor(proto,"value").set; set.call(el,"127.0.0.1:50051"); el.dispatchEvent(new Event("input",{bubbles:true})); el.blur(); return el.value'
.cursor/skills/verify-handshaker/scripts/hsdrv.py screenshot unary-address
```

Open the picker by clicking the button whose text is `Select a method`:

```sh
.cursor/skills/verify-handshaker/scripts/hsdrv.py click "xpath=//button[contains(.,\"Select a method\")]"
```

Reflection status is the footer of that menu (`aria-label="Refresh server reflection"` while idle, `aria-label="Cancel server reflection"` while a probe is in flight). When the row exists:

```sh
.cursor/skills/verify-handshaker/scripts/hsdrv.py click "xpath=//button[contains(@class,\"mp-mrow\")][.//span[contains(@class,\"mp-mname\") and text()=\"Send\"]]"
.cursor/skills/verify-handshaker/scripts/hsdrv.py screenshot unary-method
.cursor/skills/verify-handshaker/scripts/hsdrv.py click "xpath=//button[contains(.,\"Send\") and not(contains(@class,\"mp-mrow\"))]"
```

The second click is the address-bar `▶ Send` button (its accessible name
includes `Send`). Afterwards:

```sh
.cursor/skills/verify-handshaker/scripts/hsdrv.py eval 'return document.body.innerText.includes("OK") && document.body.innerText.includes("echoed")'
.cursor/skills/verify-handshaker/scripts/hsdrv.py screenshot unary-result
```

That last expression is the check for this feature. Run the echo server
yourself in its own tmux session and stop that session by the pid you
started. Do not kill it by process name from cleanup; cleanup only knows the
Handshaker session.

## Gotchas

- `▶ Send` is `disabled` until `step.method` is non-empty. Clicking it early does nothing.
- A new draft's TLS state is inherit, and a new collection's `default_tls` is false, so inherit already means plaintext. Clicking the lock cycles inherit → on → off. On will try TLS against the echo server and fail.
- The method list is empty until reflection returns. The picker footer is the status, not a second address-bar button.
- Server-streaming `ServerStream` still uses `▶ Send`. `▶ Open` is only for client-streaming and bidi. Those are the streaming feature.
- The Send button's tooltip is a portal; the visible label is `▶ Send`. Match the button element, not the tooltip.
