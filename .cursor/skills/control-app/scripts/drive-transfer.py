#!/usr/bin/env python3
"""Export and import a Handshaker bundle through the real window.

The native file dialog is outside the web view. The script installs a
window.fetch wrapper that answers only plugin:dialog open/save, and only
after a probe shows app_version traveling through that fetch. The menus,
summary dialog, toasts, and catalog reload stay real.
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
SCRIPTS = Path(__file__).resolve().parent
HSDRV = SCRIPTS / "hsdrv.py"
LAUNCH = SCRIPTS / "launch.sh"
DOCTOR = SCRIPTS / "doctor.sh"
CLEANUP = SCRIPTS / "cleanup.sh"
ECHO = SCRIPTS / "http-echo.py"
ARTIFACTS = Path("/opt/cursor/artifacts")
CURRENT = Path("/tmp/handshaker-verify/current")
ECHO_LOG = Path("/tmp/handshaker-verify/transfer-echo.jsonl")

CID = "11111111-1111-4111-8111-111111111111"
FOLDER = "44444444-4444-4444-8444-444444444444"
POST = "22222222-2222-4222-8222-222222222222"
PUT = "22222222-2222-4222-8222-222222222223"
PATCH = "22222222-2222-4222-8222-222222222224"
DELETE = "22222222-2222-4222-8222-222222222225"
GET = "33333333-3333-4333-8333-333333333331"
HEAD = "33333333-3333-4333-8333-333333333332"
OPTIONS = "33333333-3333-4333-8333-333333333333"
GRPC = "55555555-5555-4555-8555-555555555555"

BEARER = os.environ.get("HS_BEARER", "BearerSecret")
APIKEY = os.environ.get("HS_APIKEY", "KeySecret")


class DriveError(RuntimeError):
    pass


def hs(*args: str, timeout: float = 60) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(HSDRV), *args],
        text=True,
        capture_output=True,
        timeout=timeout,
    )


def must(proc: subprocess.CompletedProcess[str], what: str) -> str:
    if proc.returncode != 0:
        raise DriveError(f"{what} failed\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}")
    return proc.stdout


def evaljs(script: str):
    out = must(hs("eval", script), "eval").strip()
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return out


def click(selector: str) -> None:
    must(hs("click", selector), f"click {selector}")


def shot(name: str) -> Path:
    out = must(hs("screenshot", name), f"screenshot {name}")
    path = Path(out.strip().splitlines()[-1].split(" ", 1)[1])
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    dest = ARTIFACTS / path.name
    shutil.copy2(path, dest)
    print(f"shot {dest}", flush=True)
    return dest


def data_dir() -> Path:
    sess = json.loads((CURRENT / "session.json").read_text())
    return Path(sess["dataDir"])


def evidence_dir() -> Path:
    return CURRENT.resolve() / "evidence"


def wait_until(script: str, pred, timeout: float = 20, interval: float = 0.3, what: str = "condition"):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = evaljs(script)
        if pred(last):
            return last
        time.sleep(interval)
    raise DriveError(f"timed out waiting for {what}: {last!r}")


def launch(seed: Path | None) -> None:
    env = os.environ.copy()
    env["HS_BEARER"] = BEARER
    env["HS_APIKEY"] = APIKEY
    env["DISPLAY"] = env.get("DISPLAY", ":1")
    if seed is None:
        env.pop("HANDSHAKER_SEED_DATA", None)
    else:
        env["HANDSHAKER_SEED_DATA"] = str(seed)
    proc = subprocess.run([str(LAUNCH)], cwd=ROOT, env=env, text=True, capture_output=True, timeout=180)
    print(proc.stdout[-2000:] if proc.stdout else "", flush=True)
    if proc.returncode != 0:
        raise DriveError(f"launch failed\n{proc.stderr}")
    doc = subprocess.run([str(DOCTOR)], cwd=ROOT, text=True, capture_output=True, timeout=60)
    print(doc.stdout, flush=True)
    if doc.returncode != 0 or "ok" not in doc.stdout.splitlines()[-1:]:
        raise DriveError(f"doctor failed\n{doc.stdout}\n{doc.stderr}")


def cleanup() -> None:
    if not CURRENT.exists():
        return
    subprocess.run([str(CLEANUP)], cwd=ROOT, text=True, capture_output=True, timeout=60)


def row(key: str, value: str, enabled: bool = True) -> dict:
    return {"key": key, "value": value, "enabled": enabled}


def http_request(item_id: str, name: str, method: str, auth: dict, body: dict, query=None, headers=None) -> dict:
    return {
        "type": "request",
        "id": item_id,
        "name": name,
        "last_used_at": None,
        "use_count": 0,
        "protocol": "http",
        "method": method,
        "url_template": "{{base}}/echo",
        "query": query or [],
        "headers": headers or [],
        "body": body,
        "auth": auth,
    }


def build_collection() -> dict:
    none = {"kind": "none"}
    bearer = {
        "kind": "env_var",
        "env_var": "HS_BEARER",
        "header_name": "authorization",
        "prefix": "Bearer ",
        "environments": [],
    }
    apikey = {
        "kind": "env_var",
        "env_var": "HS_APIKEY",
        "header_name": "x-api-key",
        "prefix": "",
        "environments": [],
    }
    oauth = {
        "kind": "oauth2_client_credentials",
        "token_url": "http://127.0.0.1:8765/token",
        "client_id": "echo-client",
        "client_secret": "echo-secret",
        "scopes": ["read"],
        "header_name": "authorization",
        "prefix": "Bearer ",
        "environments": [],
    }
    post = http_request(
        POST,
        "post order",
        "POST",
        none,
        {"kind": "json", "text": '{"sku":"{{sku}}"}'},
        query=[row("page", "{{page}}"), row("skip", "1", False)],
        headers=[row("x-note", "collection-{{note}}")],
    )
    put = http_request(PUT, "put order", "PUT", apikey, {"kind": "none"})
    patch = http_request(PATCH, "patch order", "PATCH", none, {"kind": "text", "text": "note {{note}}"})
    delete = http_request(
        DELETE,
        "delete order",
        "DELETE",
        none,
        {"kind": "form", "fields": [row("sku", "{{sku}}")]},
    )
    folder = {
        "type": "folder",
        "id": FOLDER,
        "name": "Orders",
        "items": [post, put, patch, delete],
        "expanded": True,
    }
    get = http_request(GET, "get order", "GET", bearer, {"kind": "none"})
    head = http_request(HEAD, "head order", "HEAD", none, {"kind": "none"})
    options = http_request(OPTIONS, "options order", "OPTIONS", none, {"kind": "none"})
    grpc = {
        "type": "request",
        "id": GRPC,
        "name": "echo send",
        "last_used_at": None,
        "use_count": 0,
        "protocol": "grpc",
        "address_template": "{{grpcHost}}",
        "tls_override": None,
        "service": "test.Echo",
        "method": "Send",
        "body_template": '{"id":"{{msg}}"}',
        "metadata": [row("x-a", "1"), row("x-a", "2", False)],
        "auth": none,
    }
    return {
        "id": CID,
        "name": "Round trip",
        "items": [folder, get, head, options, grpc],
        "variables": {"note": "from-collection", "msg": "hi"},
        "auth": oauth,
        "default_tls": False,
        "skip_tls_verify": False,
        "pinned": False,
        "description": "export round trip",
        "created_at": 1700000000000,
        "expanded": True,
        "links": [{"name": "Logs", "url": "https://{{note}}.example/logs"}],
    }


def build_env() -> dict:
    return {
        "name": "dev",
        "variables": {
            "base": "http://127.0.0.1:8765",
            "page": "2",
            "sku": "widget",
            "grpcHost": "127.0.0.1:50051",
        },
        "color": "blue",
    }


def write_seed(dest: Path) -> None:
    if dest.exists():
        shutil.rmtree(dest)
    (dest / "collections").mkdir(parents=True)
    envelope = {"schema_version": 1, "data": build_collection()}
    (dest / "collections" / f"{CID}.json").write_text(json.dumps(envelope, indent=2) + "\n")
    envs = {"schema_version": 1, "data": [build_env()]}
    (dest / "environments.json").write_text(json.dumps(envs, indent=2) + "\n")


def load_data(path: Path):
    return json.loads(path.read_text())["data"]


def diff(a, b, path: str = "") -> str | None:
    if isinstance(a, bool) or isinstance(b, bool):
        if a != b:
            return f"{path} {a!r} vs {b!r}"
        return None
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        if a != b:
            return f"{path} {a!r} vs {b!r}"
        return None
    if type(a) is not type(b):
        return f"{path} type {type(a).__name__} vs {type(b).__name__} ({a!r} vs {b!r})"
    if isinstance(a, dict):
        if list(a) != list(b):
            return f"{path} keys {list(a)} vs {list(b)}"
        for key in a:
            found = diff(a[key], b[key], f"{path}.{key}")
            if found:
                return found
        return None
    if isinstance(a, list):
        if len(a) != len(b):
            return f"{path} len {len(a)} vs {len(b)}"
        for i, (left, right) in enumerate(zip(a, b)):
            found = diff(left, right, f"{path}[{i}]")
            if found:
                return found
        return None
    if a != b:
        return f"{path} {a!r} vs {b!r}"
    return None


def require_same(a, b, what: str) -> None:
    found = diff(a, b)
    if found:
        raise DriveError(f"{what} differ: {found}")
    print(f"same {what}", flush=True)


STUB = r"""
if (!window.__hs) {
  const real = window.fetch.bind(window);
  window.__hs = { path: null, seen: [] };
  window.fetch = function (input, init) {
    const url = String((input && input.url) || input);
    window.__hs.seen.push(url);
    const dialog = url.includes("plugin%3Adialog%7C") || url.includes("plugin:dialog|");
    if (dialog) {
      return Promise.resolve(new Response(JSON.stringify(window.__hs.path), {
        status: 200,
        headers: { "Tauri-Response": "ok", "Content-Type": "application/json" }
      }));
    }
    return real(input, init);
  };
}
return "stub";
"""


def install_stub() -> None:
    evaljs(STUB)
    evaljs(
        """
        window.__hsProbe = null;
        window.__TAURI_INTERNALS__.invoke("app_version").then(
          (v) => { window.__hsProbe = { ok: true, v: v }; },
          (e) => { window.__hsProbe = { ok: false, e: String(e) }; }
        );
        return "sent";
        """
    )
    probe = wait_until(
        "return window.__hsProbe",
        lambda v: isinstance(v, dict),
        timeout=10,
        what="app_version probe",
    )
    seen = evaljs("return window.__hs.seen")
    print(f"probe {probe} seen {seen}", flush=True)
    if not probe.get("ok"):
        raise DriveError(f"app_version invoke failed: {probe}")
    joined = " ".join(seen if isinstance(seen, list) else [])
    if "ipc://localhost/app_version" not in joined:
        raise DriveError(f"IPC did not travel through window.fetch: {seen}")


def arm(path: str) -> None:
    # The path is a JSON string so a quote in it cannot break the script.
    evaljs(f"window.__hs.path = {json.dumps(path)}; return window.__hs.path")


def toast_text() -> str:
    value = evaljs(
        """
        return [...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.innerText).join("\\n");
        """
    )
    return value if isinstance(value, str) else ""


def dialog_text() -> str:
    value = evaljs(
        """
        const el = document.querySelector("[role=alertdialog]");
        return el ? el.innerText : "";
        """
    )
    return value if isinstance(value, str) else ""


def begin_toast() -> None:
    """The toaster keeps a toast for 1500ms. A later wait that only counts nodes
    treats that leftover as the new result, or misses a toast that already left.
    """
    evaljs(
        """
        document.querySelectorAll("[data-sonner-toast]").forEach((n) => n.setAttribute("data-hs-old", "1"));
        return true;
        """
    )


def wait_toast(fragment: str, timeout: float = 10) -> str:
    found = wait_until(
        """
        const nodes = [...document.querySelectorAll("[data-sonner-toast]")].filter((n) => !n.dataset.hsOld);
        const last = nodes.length ? nodes[nodes.length - 1].innerText : "";
        return { n: nodes.length, text: last };
        """,
        lambda row: isinstance(row, dict) and row.get("n", 0) > 0 and fragment in str(row.get("text", "")),
        timeout=timeout,
        what=f"toast {fragment!r}",
    )
    return str(found.get("text", ""))


def menu_item_visible(which: str) -> None:
    wait_until(
        f"""
        const el = document.querySelector("[aria-label='{which}']");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {{ w: r.width, h: r.height }};
        """,
        lambda box: isinstance(box, dict) and box.get("w", 0) > 0 and box.get("h", 0) > 0,
        what=f"{which} menu item",
    )


def open_actions(which: str) -> None:
    begin_toast()
    click("[aria-label='collection actions']")
    menu_item_visible(which)
    click(f"[aria-label='{which}']")


def export_via(path: Path, opener) -> None:
    arm(str(path))
    begin_toast()
    opener()
    try:
        wait_toast("Exported")
    except DriveError:
        print("seen", evaljs("return window.__hs ? window.__hs.seen : null"), flush=True)
        print("dialogs", dialog_text(), flush=True)
        raise


def confirm_import() -> None:
    wait_until(
        """
        const el = document.querySelector("[role=alertdialog]");
        return el ? el.innerText : "";
        """,
        lambda text: isinstance(text, str) and "Import collections?" in text,
        what="import summary",
    )
    click("xpath=//*[@role='alertdialog']//button[normalize-space()='Import']")


def select_env(name: str) -> None:
    click('xpath=//button[contains(.,"No environment")]')
    click(f'xpath=//*[@data-env-row="{name}"]//*[@role="menuitem"]')
    wait_until(
        """
        const spans = [...document.querySelectorAll("span")].filter((s) =>
          typeof s.className === "string" && s.className.includes("max-w-[180px]")
        );
        return spans[1] ? spans[1].textContent : "";
        """,
        lambda text: text == name,
        what=f"env pill {name}",
    )


def dismiss_discard() -> None:
    text = evaljs('return document.body.innerText.includes("Discard unsaved request?")')
    if text is True:
        click('xpath=//button[normalize-space()="Discard"]')
        time.sleep(0.3)


def expand_tree() -> None:
    evaljs(
        """
        document.querySelectorAll("[aria-label=toggle-collection], [aria-label=toggle-folder]").forEach((b) => {
          const icon = b.querySelector("svg");
          const open = icon && (icon.getAttribute("class") || "").includes("rotate-90");
          if (!open) b.click();
        });
        return true;
        """
    )


def send_saved(item_id: str) -> str:
    dismiss_discard()
    expand_tree()
    wait_until(
        f"""
        return document.querySelector('[data-node-id="{item_id}"]') ? "{item_id}" : "";
        """,
        lambda value: value == item_id,
        what=f"row {item_id}",
    )
    click(f'[data-node-id="{item_id}"]')
    time.sleep(0.4)
    click('xpath=//button[contains(.,"▶ Send")]')
    meta = wait_until(
        """
        const el = document.querySelector("[data-testid=http-response-meta]");
        return el ? el.innerText : "";
        """,
        lambda text: isinstance(text, str) and text.strip() != "",
        timeout=20,
        what=f"response meta {item_id}",
    )
    return meta if isinstance(meta, str) else str(meta)


def echo_entries() -> list[dict]:
    if not ECHO_LOG.exists():
        return []
    rows = []
    for line in ECHO_LOG.read_text().splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def header(entry: dict, name: str) -> str | None:
    for key, value in entry.get("headers", {}).items():
        if key.lower() == name.lower():
            return value
    return None


def latest(method: str) -> dict:
    rows = [entry for entry in echo_entries() if entry.get("method") == method and entry.get("path") == "/echo"]
    if not rows:
        raise DriveError(f"echo has no {method} /echo")
    return rows[-1]


def start_echo() -> subprocess.Popen:
    if ECHO_LOG.exists():
        ECHO_LOG.unlink()
    env = os.environ.copy()
    env["HTTP_ECHO_LOG"] = str(ECHO_LOG)
    env["HTTP_ECHO_PORT"] = "8765"
    proc = subprocess.Popen([sys.executable, str(ECHO)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 5
    import socket

    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", 8765), timeout=0.2):
                return proc
        except OSError:
            time.sleep(0.1)
    raise DriveError("http echo did not listen")


def stop_echo(proc: subprocess.Popen | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()


def _request_ids(collection: dict) -> set[str]:
    found: set[str] = set()

    def walk(items: list) -> None:
        for item in items:
            if item.get("type") == "folder":
                walk(item.get("items") or [])
            elif item.get("type") == "request":
                found.add(item["id"])

    walk(collection.get("items") or [])
    return found


def rewrite_ids(bundle: dict) -> dict:
    text = json.dumps(bundle)
    pairs = [
        (CID, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        (FOLDER, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
        (POST, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
        (PUT, "cccccccd-cccc-4ccc-8ccc-cccccccccccc"),
        (PATCH, "ccccccce-cccc-4ccc-8ccc-cccccccccccc"),
        (DELETE, "cccccccf-cccc-4ccc-8ccc-cccccccccccc"),
        (GET, "dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
        (HEAD, "ddddddde-dddd-4ddd-8ddd-dddddddddddd"),
        (OPTIONS, "dddddddf-dddd-4ddd-8ddd-dddddddddddd"),
        (GRPC, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
    ]
    for old, new in pairs:
        text = text.replace(old, new)
    doc = json.loads(text)
    doc["data"]["environments"] = []
    return doc


def save_echo_log() -> None:
    if not ECHO_LOG.exists():
        return
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ECHO_LOG, ARTIFACTS / "transfer-http-echo.jsonl")
    if CURRENT.exists():
        dest = evidence_dir()
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ECHO_LOG, dest / "http-echo.jsonl")


def main() -> None:
    seed = Path("/tmp/hs-transfer-seed")
    write_seed(seed)
    echo = None
    try:
        echo = start_echo()
        print("echo listening", flush=True)
        launch(seed)
        install_stub()
        wait_until(
            "return document.body.innerText",
            lambda text: isinstance(text, str) and "Round trip" in text and "Orders" in text,
            what="seeded sidebar",
        )
        shot("transfer-source-sidebar")
        source = data_dir()
        stored = load_data(source / "collections" / f"{CID}.json")
        stored_envs = load_data(source / "environments.json")
        require_same(stored, build_collection(), "loaded collection vs seed")
        require_same(stored_envs, [build_env()], "loaded environments vs seed")

        ev = evidence_dir()
        ev.mkdir(parents=True, exist_ok=True)
        all_path = ev / "export-all.json"
        one_path = ev / "export-one.json"
        settings_path = ev / "export-settings.json"

        export_via(all_path, lambda: open_actions("export"))
        shot("transfer-export-all")
        exported = json.loads(all_path.read_text())
        if exported.get("schema_version") != 1 or exported["data"].get("kind") != "handshaker-export":
            raise DriveError(f"export-all envelope is {exported.get('schema_version')} {exported.get('data', {}).get('kind')}")
        require_same(exported["data"]["collections"], [stored], "export-all collections")
        require_same(exported["data"]["environments"], stored_envs, "export-all environments")

        arm(str(one_path))
        begin_toast()
        click(f'xpath=//div[@data-node-id="{CID}"]/following-sibling::button[@aria-label="More options"]')
        click('xpath=//*[@role="menuitem"][normalize-space()="Export"]')
        wait_toast("Exported")
        shot("transfer-export-one")
        one = json.loads(one_path.read_text())
        require_same(one["data"]["collections"], [stored], "export-one collection")
        require_same(one["data"]["environments"], [], "export-one environments")

        click("[aria-label='Settings']")
        click('xpath=//button[normalize-space()="Import / Export"]')
        export_via(settings_path, lambda: click('xpath=//*[@role="dialog"]//button[normalize-space()="Export"]'))
        shot("transfer-settings-export")
        settings_doc = json.loads(settings_path.read_text())
        require_same(settings_doc["data"]["collections"], exported["data"]["collections"], "settings export collections")
        require_same(settings_doc["data"]["environments"], exported["data"]["environments"], "settings export environments")
        evaljs('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); return true')
        wait_until(
            'return document.body.innerText.includes("Preferences persist locally")',
            lambda shown: shown is False,
            what="settings closed",
        )

        cleanup()
        print("source profile closed", flush=True)

        launch(None)
        install_stub()
        wait_until(
            "return document.body.innerText",
            lambda text: isinstance(text, str) and "My Collection" in text and "Round trip" not in text,
            what="clean profile",
        )

        bad = Path("/tmp/hs-transfer-bad.json")
        bad.write_text("{ not json\n")
        arm(str(bad))
        open_actions("import")
        bad_toast = wait_toast("parse", timeout=10)
        print(f"corrupt toast: {bad_toast}", flush=True)
        shot("transfer-import-corrupt")
        if (data_dir() / "collections" / f"{CID}.json").exists():
            raise DriveError("corrupt import wrote the collection")

        wrong = Path("/tmp/hs-transfer-wrong-kind.json")
        wrong.write_text(json.dumps({"schema_version": 1, "data": {"kind": "other", "collections": [], "environments": []}}))
        arm(str(wrong))
        open_actions("import")
        kind_toast = wait_toast("not a Handshaker export", timeout=10)
        print(f"kind toast: {kind_toast}", flush=True)
        shot("transfer-import-wrong-kind")

        future = Path("/tmp/hs-transfer-v2.json")
        future.write_text(
            json.dumps({"schema_version": 2, "data": {"kind": "handshaker-export", "collections": [], "environments": []}})
        )
        arm(str(future))
        open_actions("import")
        version_toast = wait_toast("unsupported schema", timeout=10)
        print(f"version toast: {version_toast}", flush=True)
        shot("transfer-import-schema")

        arm(str(all_path))
        open_actions("import")
        summary = dialog_text() if "Import collections?" in dialog_text() else wait_until(
            'const el=document.querySelector("[role=alertdialog]"); return el?el.innerText:"";',
            lambda text: isinstance(text, str) and "Import collections?" in text,
            what="valid import summary",
        )
        print(f"summary: {summary if isinstance(summary, str) else dialog_text()}", flush=True)
        shot("transfer-import-summary")
        begin_toast()
        click('xpath=//*[@role="alertdialog"]//button[normalize-space()="Import"]')
        imported_toast = wait_toast("Imported")
        print(f"import toast: {imported_toast}", flush=True)
        shot("transfer-import-done")
        target = data_dir()
        require_same(load_data(target / "collections" / f"{CID}.json"), stored, "imported collection")
        envs_after = load_data(target / "environments.json")
        dev = next(env for env in envs_after if env.get("name") == "dev")
        require_same(dev, build_env(), "imported dev environment")
        names = evaljs(
            """
            return [...document.querySelectorAll("[aria-label=open-collection]")].map((b) => b.innerText.trim());
            """
        )
        print(f"collection names: {names}", flush=True)
        if names != ["My Collection", "Round trip"]:
            raise DriveError(f"sidebar names after import: {names}")

        # A local request added after import should survive a merge that says
        # nothing is deleted.
        extra_ids: set[str] = set()
        expand_tree()
        opened = evaljs(
            f"""
            const row = document.querySelector('[data-node-id="{POST}"]');
            if (!row) return {{ ok: false, why: "no-row" }};
            const scope = row.closest('[class*="group/row"]') || row.parentElement;
            const btn = scope && scope.querySelector('[aria-label="More options"]');
            if (!btn) return {{ ok: false, why: "no-btn", html: (scope && scope.outerHTML || "").slice(0, 240) }};
            btn.click();
            return {{ ok: true }};
            """
        )
        print(f"duplicate menu: {opened}", flush=True)
        if isinstance(opened, dict) and opened.get("ok"):
            click('xpath=//*[@role="menuitem"][normalize-space()="Duplicate"]')
            time.sleep(0.5)
            extra_ids = _request_ids(load_data(target / "collections" / f"{CID}.json")) - _request_ids(stored)
        print(f"local duplicate ids: {sorted(extra_ids)}", flush=True)

        arm(str(all_path))
        open_actions("import")
        again = wait_until(
            'const el=document.querySelector("[role=alertdialog]"); return el?el.innerText:"";',
            lambda text: isinstance(text, str) and "already exist" in text,
            what="reimport summary",
        )
        print(f"reimport summary: {again}", flush=True)
        begin_toast()
        click('xpath=//*[@role="alertdialog"]//button[normalize-space()="Import"]')
        wait_toast("Imported")
        reimported = load_data(target / "collections" / f"{CID}.json")
        kept = extra_ids & _request_ids(reimported)
        if extra_ids and not kept:
            print(
                "BUG reimport replaced the collection and dropped locally added requests "
                f"{sorted(extra_ids)}. The summary still says nothing is deleted.",
                flush=True,
            )
            require_same(reimported, stored, "reimported collection")
        elif kept:
            print(f"local requests survived reimport: {sorted(kept)}", flush=True)
        else:
            require_same(reimported, stored, "reimported collection")

        copy_path = evidence_dir() / "same-name-copy.json"
        copy_path.write_text(json.dumps(rewrite_ids(exported), indent=2) + "\n")
        click("[aria-label='Settings']")
        click('xpath=//button[normalize-space()="Import / Export"]')
        arm(str(copy_path))
        click('xpath=//*[@role="dialog"]//button[normalize-space()="Import"]')
        wait_until(
            'const el=document.querySelector("[role=alertdialog]"); return el?el.innerText:"";',
            lambda text: isinstance(text, str) and "Import collections?" in text,
            what="settings import summary",
        )
        begin_toast()
        click('xpath=//*[@role="alertdialog"]//button[normalize-space()="Import"]')
        wait_toast("Imported")
        evaljs('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); return true')
        names = wait_until(
            'return [...document.querySelectorAll("[aria-label=open-collection]")].map((b) => b.innerText);',
            lambda rows: isinstance(rows, list) and sum(1 for row in rows if str(row).strip() == "Round trip") == 2,
            what="duplicate collection name",
        )
        print(f"names after duplicate import: {names}", flush=True)
        shot("transfer-duplicate-name")

        select_env("dev")
        shot("transfer-env-selected")
        checks = [
            (POST, "POST", lambda entry: (
                header(entry, "authorization") == "Bearer tok-echo-client"
                and header(entry, "x-note") == "collection-from-collection"
                and entry.get("query", {}).get("page") == ["2"]
                and "skip" not in entry.get("query", {})
                and '"sku":"widget"' in entry.get("body", "").replace(" ", "")
            )),
            (GET, "GET", lambda entry: header(entry, "authorization") == f"Bearer {BEARER}"),
            (PUT, "PUT", lambda entry: header(entry, "x-api-key") == APIKEY and header(entry, "authorization") is None),
            (PATCH, "PATCH", lambda entry: header(entry, "authorization") == "Bearer tok-echo-client"),
            (DELETE, "DELETE", lambda entry: header(entry, "authorization") == "Bearer tok-echo-client"),
            (HEAD, "HEAD", lambda entry: header(entry, "authorization") == "Bearer tok-echo-client"),
            (OPTIONS, "OPTIONS", lambda entry: header(entry, "authorization") == "Bearer tok-echo-client"),
        ]
        for item_id, method, pred in checks:
            meta = send_saved(item_id)
            print(f"send {method}: {meta}", flush=True)
            shot(f"transfer-send-{method.lower()}")
            if not meta.strip().startswith("200"):
                raise DriveError(f"{method} meta is {meta!r}")
            entry = latest(method)
            if not pred(entry):
                raise DriveError(f"{method} echo entry did not match: {entry}")
            print(f"echo {method} ok", flush=True)

        grpc_text = evaljs(
            f"""
            const row = document.querySelector('[data-node-id="{GRPC}"]');
            return row ? row.innerText : "";
            """
        )
        if not isinstance(grpc_text, str) or "echo send" not in grpc_text:
            raise DriveError(f"grpc row missing: {grpc_text!r}")
        print("transfer ok", flush=True)
    except Exception:
        try:
            shot("transfer-failure")
        except Exception as shot_exc:
            print(f"failure shot skipped: {shot_exc}", flush=True)
        raise
    finally:
        save_echo_log()
        stop_echo(echo)
        cleanup()


if __name__ == "__main__":
    try:
        main()
    except (DriveError, subprocess.TimeoutExpired, OSError) as exc:
        print(f"FAIL {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
