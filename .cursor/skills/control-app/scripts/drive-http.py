#!/usr/bin/env python3
"""Drive HTTP auth and environment substitution against the local echo.

Requires a healthy control-app session (`launch.sh` then `doctor.sh`) and
`http-echo.py` already listening. Launch the app with the OS variables the
Bearer and API key configs name:

    HS_BEARER=BearerSecret HS_APIKEY=KeySecret \\
      .cursor/skills/control-app/scripts/launch.sh

`hsdrv.py launch` forwards HS_BEARER and HS_APIKEY into the app process.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
HSDRV = SCRIPTS / "hsdrv.py"
ECHO_LOG = Path(os.environ.get("HTTP_ECHO_LOG", "/tmp/handshaker-verify/http-echo.jsonl"))
ARTIFACTS = Path("/opt/cursor/artifacts")
BEARER_SECRET = os.environ.get("HS_BEARER", "BearerSecret")
APIKEY_SECRET = os.environ.get("HS_APIKEY", "KeySecret")

LOCAL = {
    "baseUrl": "http://127.0.0.1:8765",
    "pathSeg": "echo",
    "qKey": "q",
    "qVal": "from-local",
    "hdr": "alpha",
    "bodyVal": "ada",
    "oauthId": "id-local",
    "oauthSecret": "sec-local",
    "oauthScope": "scope.local",
    "blank": "",
}
OTHER = {
    "baseUrl": "http://127.0.0.1:8765",
    "pathSeg": "echo",
    "qKey": "q",
    "qVal": "from-other",
    "hdr": "beta",
    "bodyVal": "bea",
    "oauthId": "id-other",
    "oauthSecret": "sec-other",
    "oauthScope": "scope.other",
    "blank": "",
}


class DriveError(RuntimeError):
    pass


def hs(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(HSDRV), *args],
        text=True,
        capture_output=True,
    )


def must(proc: subprocess.CompletedProcess[str], what: str) -> str:
    if proc.returncode != 0:
        raise DriveError(f"{what} failed\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}")
    return proc.stdout


def click(selector: str) -> None:
    must(hs("click", selector), f"click {selector}")


def evaljs(script: str):
    out = must(hs("eval", script), "eval").strip()
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return out


def shot(name: str) -> Path:
    out = must(hs("screenshot", name), f"screenshot {name}")
    # "screenshot /path" is the last line.
    path = Path(out.strip().splitlines()[-1].split(" ", 1)[1])
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    dest = ARTIFACTS / path.name
    shutil.copy2(path, dest)
    print(f"shot {dest}", flush=True)
    return dest


def session() -> dict:
    current = Path("/tmp/handshaker-verify/current")
    return json.loads((current / "session.json").read_text())


def data_dir() -> Path:
    return Path(session()["dataDir"])


def log_entries() -> list[dict]:
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


def wait_until(script: str, pred, timeout: float = 15, interval: float = 0.3):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = evaljs(script)
        if pred(last):
            return last
        time.sleep(interval)
    raise DriveError(f"timed out waiting; last={last!r}")


def page_text() -> str:
    value = evaljs("return document.body ? document.body.innerText : ''")
    return value if isinstance(value, str) else json.dumps(value)


SET_NATIVE = r"""
function setNative(el, value) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
"""


def set_labeled(aria: str, value: str) -> None:
    script = (
        SET_NATIVE
        + f"""
        const el = document.querySelector('[aria-label="{aria}"]');
        if (!el) return JSON.stringify({{ok:false, reason:'missing {aria}'}});
        setNative(el, {json.dumps(value)});
        el.blur();
        return JSON.stringify({{ok:true, value:el.value}});
        """
    )
    result = evaljs(script)
    if not isinstance(result, dict) or not result.get("ok"):
        raise DriveError(f"set {aria}: {result}")


def add_env_var(key: str, value: str) -> None:
    click('[data-field="add"]')
    wait_until(
        "return !!document.querySelector('[aria-label=\"Variable name\"]')",
        lambda v: v is True,
        timeout=5,
    )
    script = (
        SET_NATIVE
        + f"""
        const keyInput = document.querySelector('[aria-label="Variable name"]');
        const area = document.querySelector('textarea[aria-label="Value"]');
        if (!keyInput || !area) return JSON.stringify({{ok:false, reason:'draft missing'}});
        setNative(keyInput, {json.dumps(key)});
        setNative(area, {json.dumps(value)});
        return JSON.stringify({{ok:true, key:keyInput.value, value:area.value}});
        """
    )
    result = evaljs(script)
    if not isinstance(result, dict) or not result.get("ok") or result.get("key") != key or result.get("value") != value:
        raise DriveError(f"add env var {key}: {result}")
    # The toolbar button's accessible name is also "Add variable". The commit
    # control is the only one with that aria-label attribute.
    click('[aria-label="Add variable"]')
    shown = json.dumps(key)
    wait_until(
        f"""
        const draft = document.querySelector('[aria-label="Variable name"]');
        const row = [...document.querySelectorAll('[data-field^="key:"]')].some((el) => (el.innerText || "").includes({shown}));
        return !draft && row;
        """,
        lambda v: v is True,
        timeout=5,
    )


def create_env(name: str, variables: dict[str, str]) -> None:
    envs = data_dir() / "environments.json"
    if envs.exists() and f'"name": "{name}"' in envs.read_text() or (
        envs.exists() and f'"name":"{name}"' in envs.read_text()
    ):
        print(f"env {name} already stored", flush=True)
        return
    click_pill()
    wait_until(
        "return !!document.querySelector('[aria-label=\"New environment\"]')",
        lambda v: v is True,
        timeout=5,
    )
    click("[aria-label='New environment']")
    wait_until(
        "return !!document.querySelector(\"[role='dialog'] [aria-label='Environment name']\")",
        lambda v: v is True,
    )
    set_labeled("Environment name", name)
    for key, value in variables.items():
        add_env_var(key, value)
    click('xpath=//div[@role="dialog"]//button[normalize-space()="Create"]')
    deadline = time.time() + 10
    while time.time() < deadline:
        raw = envs.read_text() if envs.exists() else ""
        if f'"name": "{name}"' in raw or f'"name":"{name}"' in raw:
            break
        time.sleep(0.25)
    else:
        raise DriveError(f"env {name} did not persist; pill={pill_label()!r}")
    # Create keeps the editor open on the stored environment. Done closes it.
    if evaljs("return !!document.querySelector(\"[role='dialog']\")"):
        click('xpath=//div[@role="dialog"]//button[normalize-space()="Done"]')
    wait_until(
        "return !!document.querySelector(\"[role='dialog']\")",
        lambda v: v is False,
        timeout=5,
    )
    wait_until(
        f"const spans = {env_pill_spans()}; return spans[1] ? spans[1].textContent : '';",
        lambda value: value == name,
    )
    release_scroll_lock(f"after creating env {name}")
    print(f"created env {name}", flush=True)


def env_pill_spans() -> str:
    # The titlebar draws the workflow name and the env pill with the same
    # max-w-[180px] truncate class. The env pill is the second of those spans.
    return """
        [...document.querySelectorAll('span')].filter((s) =>
          typeof s.className === 'string' && s.className.includes('max-w-[180px]')
        )
    """


def pill_label() -> str:
    value = evaljs(f"const spans = {env_pill_spans()}; return spans[1] ? spans[1].textContent : '';")
    return value if isinstance(value, str) else ""


def release_scroll_lock(where: str) -> None:
    """The env editor unmounts on close and can leave Radix's scroll lock behind.

    `document.body` keeps `style="pointer-events: none"` and
    `data-scroll-locked`, so every later WebDriver click is "element not
    interactable". Record that and clear the stuck inline style. This does
    not fix the app; it only lets the rest of this drive reach the window.
    """
    state = evaljs(
        """
        return JSON.stringify({
          pe: document.body.style.pointerEvents || "",
          locked: document.body.getAttribute("data-scroll-locked")
        });
        """
    )
    stuck = isinstance(state, dict) and (state.get("pe") == "none" or state.get("locked"))
    if not stuck:
        return
    print(f"BUG scroll-lock stuck {where}: {state}", flush=True)
    evaljs(
        """
        document.body.style.pointerEvents = "";
        document.body.removeAttribute("data-scroll-locked");
        return document.body.style.pointerEvents || "cleared";
        """
    )


def click_pill() -> None:
    # WebDriver's click (pointer sequence) opens the Radix menu. element.click()
    # from eval does not. The env pill is the second titlebar control with the
    # shared max-w-[180px] label; the first is the workflow name.
    click('xpath=(//button[.//span[contains(@class,"max-w-[180px]")]])[2]')


def activate_env(name: str) -> None:
    if pill_label() == name:
        return
    click_pill()
    click(f'xpath=//*[@data-env-row="{name}"]//*[@role="menuitem"][contains(.,"{name}")]')
    wait_until(
        f"const spans = {env_pill_spans()}; return spans[1] ? spans[1].textContent : '';",
        lambda value: value == name,
    )
    print(f"active env {name}", flush=True)


def maybe_discard() -> None:
    if "Discard unsaved request?" in page_text():
        click('xpath=//*[@role="alertdialog"]//button[normalize-space()="Discard"]')
        time.sleep(0.4)


def open_http_draft() -> None:
    click("[aria-label='new-item']")
    click("[aria-label='new-http-request']")
    maybe_discard()
    wait_until(
        "return !!document.querySelector('[aria-label=\"Request URL\"]')",
        lambda v: v is True,
        timeout=10,
    )


def set_metadata(key: str, value: str) -> None:
    if not evaljs("return !!document.querySelector('[aria-label=\"metadata-key-0\"]')"):
        click("[aria-label='add metadata row']")
        wait_until(
            "return !!document.querySelector('[aria-label=\"metadata-key-0\"]')",
            lambda v: v is True,
        )
    set_labeled("metadata-key-0", key)
    set_labeled("metadata-value-0", value)


def insert_body(text: str) -> None:
    # view-lines is empty in the same turn as insertText; Monaco paints it after.
    script = f"""
        const ta = document.querySelector('textarea.inputarea');
        if (!ta) return JSON.stringify({{ok:false, reason:'no monaco'}});
        ta.focus();
        document.execCommand('selectAll', false, null);
        const inserted = document.execCommand('insertText', false, {json.dumps(text)});
        return JSON.stringify({{ok:inserted}});
        """
    result = evaljs(script)
    if not isinstance(result, dict) or not result.get("ok"):
        raise DriveError(f"monaco insert failed: {result}")
    shown = wait_until(
        """
        const ta = document.querySelector('textarea.inputarea');
        const lines = document.querySelector('.view-lines');
        const text = (ta && ta.value) || (lines && lines.innerText) || '';
        return JSON.stringify({shown: text});
        """,
        lambda value: isinstance(value, dict) and "bodyVal" in str(value.get("shown")),
        timeout=5,
    )
    if not isinstance(shown, dict) or "bodyVal" not in str(shown.get("shown")):
        raise DriveError(f"monaco did not show the body: {shown!r}")


def send_and_wait() -> dict:
    before = len(log_entries())
    click('xpath=//button[normalize-space()="▶ Send"]')
    script = r"""
        const meta = document.querySelector('[data-testid="http-response-meta"]');
        return JSON.stringify({
          meta: meta ? meta.innerText : '',
          text: (document.body.innerText || '').slice(0, 4000)
        });
        """

    def done(value):
        if not isinstance(value, dict):
            return False
        meta = value.get("meta") or ""
        text = value.get("text") or ""
        if meta.strip():
            return True
        return any(
            needle in text
            for needle in (
                "Service unavailable",
                "Request failed",
                "Unresolved variables",
                "Invalid URL",
                "Authentication failed",
            )
        )

    view = wait_until(script, done, timeout=20)
    view["log_before"] = before
    view["log"] = log_entries()
    return view


def last_path(entries: list[dict], path: str, after: int) -> dict | None:
    fresh = entries[after:]
    hits = [row for row in fresh if row.get("path") == path]
    return hits[-1] if hits else None


def assert_no_new_requests(before: int, why: str) -> None:
    now = len(log_entries())
    if now != before:
        raise DriveError(f"{why}: echo log grew {before} -> {now}: {log_entries()[before:]}")


def save_request(name: str) -> None:
    click("[aria-label='Save']")
    wait_until(
        "return !!document.querySelector('[aria-label=\"Request name\"]')",
        lambda v: v is True,
    )
    set_labeled("Request name", name)
    click(
        "xpath=//*[@aria-label='save-destination']//*[@role='treeitem'][.//span[normalize-space()='My Collection']]"
    )
    click('xpath=//*[@data-slot="dialog-footer"]//button[normalize-space()="Save"]')
    wait_until(
        "return (document.body.innerText || '').includes('Echo probe')",
        lambda v: v is True,
        timeout=10,
    )
    # Origin bind is what makes collection auth apply on the next Send.
    deadline = time.time() + 8
    while time.time() < deadline:
        for path in (data_dir() / "collections").glob("*.json"):
            doc = json.loads(path.read_text())
            data = doc.get("data") or {}
            items = data.get("items") or []
            for item in items:
                if item.get("type") == "request" and item.get("name") == name:
                    protocol = item.get("protocol") or (item.get("template") or {}).get("protocol")
                    if protocol == "http":
                        release_scroll_lock("after save dialog")
                        print(f"saved {name} in {path.name}", flush=True)
                        return
        time.sleep(0.25)
    raise DriveError(f"{name} was not written into a collection file")


def open_my_collection_auth() -> None:
    click('xpath=//button[@aria-label="open-collection"][normalize-space()="My Collection"]')
    wait_until(
        "return (document.body.innerText || '').includes('Authorization')",
        lambda v: v is True,
    )
    if "Token URL" not in page_text() and "BEARER_TOKEN_VAR" not in page_text() and "No authentication" not in page_text():
        click('xpath=//button[normalize-space()="Authorization"]')
    wait_until(
        """
        const labels = ['None', 'Bearer', 'API key', 'OAuth2'];
        return labels.every((label) => document.querySelector(`[aria-label="${label}"]`));
        """,
        lambda v: v is True,
    )


def close_overview() -> None:
    click("[aria-label='close-overview']")
    wait_until(
        "return !!document.querySelector('[aria-label=\"Request URL\"]')",
        lambda v: v is True,
    )


def collection_auth() -> dict:
    for path in (data_dir() / "collections").glob("*.json"):
        doc = json.loads(path.read_text())
        data = doc.get("data") or {}
        if data.get("name") == "My Collection":
            return data.get("auth") or {}
    raise DriveError("My Collection file missing")


def wait_auth(pred) -> dict:
    deadline = time.time() + 8
    last = None
    while time.time() < deadline:
        last = collection_auth()
        if pred(last):
            return last
        time.sleep(0.2)
    raise DriveError(f"collection auth did not update: {last}")


def set_input_placeholder(placeholder: str, value: str) -> None:
    script = (
        SET_NATIVE
        + f"""
        const el = document.querySelector('input[placeholder={json.dumps(placeholder)}]');
        if (!el) return JSON.stringify({{ok:false, reason:'missing placeholder {placeholder}'}});
        setNative(el, {json.dumps(value)});
        return JSON.stringify({{ok:true, value:el.value}});
        """
    )
    result = evaljs(script)
    if not isinstance(result, dict) or not result.get("ok"):
        raise DriveError(f"placeholder {placeholder}: {result}")


def configure_bearer() -> None:
    open_my_collection_auth()
    click('[aria-label="Bearer"]')
    wait_until(
        "return !!document.querySelector('input[placeholder=\"BEARER_TOKEN_VAR\"]')",
        lambda v: v is True,
    )
    set_input_placeholder("BEARER_TOKEN_VAR", "HS_BEARER")
    wait_auth(lambda auth: auth.get("kind") == "env_var" and auth.get("env_var") == "HS_BEARER" and auth.get("prefix") == "Bearer ")
    close_overview()


def configure_apikey() -> None:
    open_my_collection_auth()
    click('[aria-label="API key"]')
    wait_until(
        "return !!document.querySelector('input[placeholder=\"API_KEY_VAR\"]')",
        lambda v: v is True,
    )
    set_input_placeholder("x-api-key", "x-api-key")
    # Prefix placeholder is "Bearer " and must end empty so the header value is the secret alone.
    script = (
        SET_NATIVE
        + r"""
        const inputs = [...document.querySelectorAll("[role='main'] input, input")];
        const prefix = inputs.find((el) => el.placeholder === 'Bearer ' || el.getAttribute('aria-label') === 'Prefix');
        const byPh = document.querySelector('input[placeholder="Bearer "]');
        const el = byPh;
        if (!el) return JSON.stringify({ok:false, reason:'no prefix input', placeholders: inputs.map(i => i.placeholder)});
        setNative(el, '');
        return JSON.stringify({ok:true, value:el.value});
        """
    )
    result = evaljs(script)
    if not isinstance(result, dict) or not result.get("ok"):
        raise DriveError(f"api key prefix: {result}")
    set_input_placeholder("API_KEY_VAR", "HS_APIKEY")
    wait_auth(
        lambda auth: auth.get("kind") == "env_var"
        and auth.get("env_var") == "HS_APIKEY"
        and auth.get("header_name") == "x-api-key"
        and auth.get("prefix") == ""
    )
    close_overview()


def configure_oauth() -> None:
    open_my_collection_auth()
    click('[aria-label="OAuth2"]')
    wait_until(
        "return !!document.querySelector('[aria-label=\"Token URL\"]')",
        lambda v: v is True,
    )
    set_labeled("Token URL", "{{baseUrl}}/token")
    set_labeled("Client ID", "{{oauthId}}")
    set_labeled("Client secret", "{{oauthSecret}}")
    set_labeled("Scope", "{{oauthScope}}")
    wait_auth(
        lambda auth: auth.get("kind") == "oauth2_client_credentials"
        and auth.get("token_url") == "{{baseUrl}}/token"
        and auth.get("client_id") == "{{oauthId}}"
        and auth.get("client_secret") == "{{oauthSecret}}"
        and auth.get("scopes") == ["{{oauthScope}}"]
    )
    close_overview()


def configure_none() -> None:
    open_my_collection_auth()
    click('[aria-label="None"]')
    wait_auth(lambda auth: auth.get("kind") == "none")
    close_overview()


def assert_exchange(entry: dict, *, method: str, path: str, query_key: str, query_val: str, hdr: str, body_val: str, auth_header: str | None, auth_value: str | None) -> None:
    problems = []
    if entry.get("method") != method:
        problems.append(f"method {entry.get('method')!r}")
    if entry.get("path") != path:
        problems.append(f"path {entry.get('path')!r}")
    got_q = (entry.get("query") or {}).get(query_key)
    if got_q != [query_val]:
        problems.append(f"query {entry.get('query')!r}")
    got_hdr = header(entry, "X-Env")
    if got_hdr != hdr:
        problems.append(f"X-Env {got_hdr!r}")
    if body_val not in (entry.get("body") or ""):
        problems.append(f"body {entry.get('body')!r}")
    if auth_header is None:
        if header(entry, "authorization") is not None:
            problems.append(f"unexpected authorization {header(entry, 'authorization')!r}")
        if header(entry, "x-api-key") is not None:
            problems.append(f"unexpected x-api-key {header(entry, 'x-api-key')!r}")
    else:
        got = header(entry, auth_header)
        if got != auth_value:
            problems.append(f"{auth_header} {got!r} != {auth_value!r}")
    if problems:
        raise DriveError("echo mismatch: " + "; ".join(problems) + f" entry={json.dumps(entry)[:1500]}")


def form_value(entry: dict, key: str) -> str:
    import urllib.parse

    return (urllib.parse.parse_qs(entry.get("body") or "", keep_blank_values=True).get(key) or [""])[0]


def main() -> None:
    doctor = hs("doctor")
    if doctor.returncode != 0:
        raise DriveError(f"doctor failed before HTTP drive\n{doctor.stdout}\n{doctor.stderr}")
    print(doctor.stdout.strip(), flush=True)
    release_scroll_lock("at HTTP drive start")

    # App process must see the OS secrets. launch forwards them; check the recorded pid.
    app_pids = session().get("appPids") or []
    if not app_pids:
        raise DriveError("no app pid recorded")
    environ = Path(f"/proc/{app_pids[0]}/environ").read_bytes().split(b"\0")
    seen = {row.split(b"=", 1)[0].decode() for row in environ if b"=" in row}
    missing = [name for name in ("HS_BEARER", "HS_APIKEY") if name not in seen]
    if missing:
        raise DriveError(f"app process is missing OS auth env {missing}; relaunch after the forward fix")
    values = {}
    for row in environ:
        if row.startswith(b"HS_BEARER=") or row.startswith(b"HS_APIKEY="):
            key, value = row.split(b"=", 1)
            values[key.decode()] = value.decode()
    if values.get("HS_BEARER") != BEARER_SECRET or values.get("HS_APIKEY") != APIKEY_SECRET:
        raise DriveError(f"app OS auth env mismatch: {values}")

    create_env("other", OTHER)
    create_env("local", LOCAL)
    activate_env("local")

    open_http_draft()
    set_labeled("Request URL", "{{baseUrl}}/echo")
    click('xpath=//button[normalize-space()="Params"]')
    set_metadata("q", "ping")
    view = send_and_wait()
    if "200" not in view["meta"]:
        raise DriveError(f"GET echo meta: {view['meta']!r} text={view['text'][:500]}")
    got = last_path(view["log"], "/echo", view["log_before"])
    if not got or got.get("method") != "GET" or (got.get("query") or {}).get("q") != ["ping"]:
        raise DriveError(f"GET echo log: {got}")
    if header(got, "authorization") or header(got, "x-api-key"):
        raise DriveError(f"GET unexpectedly carried auth: {got['headers']}")
    shot("http-get-200")
    print("pass get 200", flush=True)

    set_labeled("Request URL", "{{baseUrl}}/missing")
    view = send_and_wait()
    if "404" not in view["meta"] or "Not Found" not in view["meta"]:
        raise DriveError(f"404 meta: {view['meta']!r}")
    missing = last_path(view["log"], "/missing", view["log_before"])
    if not missing:
        raise DriveError("404 was not received by the echo")
    print("pass 404", flush=True)

    before = len(log_entries())
    set_labeled("Request URL", "http://127.0.0.1:9/down")
    view = send_and_wait()
    if "Service unavailable" not in view["text"] or "Connection refused" not in view["text"]:
        raise DriveError(f"refused text missing: {view['text'][:800]}")
    assert_no_new_requests(before, "connection refused")
    shot("http-refused")
    print("pass refused", flush=True)

    set_labeled("Request URL", "{{baseUrl}}/{{pathSeg}}")
    click('xpath=//button[normalize-space()="Params"]')
    set_metadata("{{qKey}}", "{{qVal}}")
    click('xpath=//button[normalize-space()="Headers"]')
    set_metadata("X-Env", "{{hdr}}")
    click("[aria-label='HTTP method']")
    click("xpath=//div[@role='menuitemradio'][normalize-space()='POST']")
    click('xpath=//button[normalize-space()="Body"]')
    click('xpath=//button[@role="radio" and normalize-space()="JSON"]')
    time.sleep(0.4)
    insert_body('{"item":"{{bodyVal}}"}')
    save_request("Echo probe")
    # A previous drive may have left OAuth2 on the collection. Request auth
    # `{kind: none}` does not block that: pick skips None and uses the collection.
    configure_none()
    view = send_and_wait()
    if "200" not in view["meta"]:
        raise DriveError(f"none/local meta: {view['meta']!r}\n{view['text'][:800]}")
    got = last_path(view["log"], "/echo", view["log_before"])
    if not got:
        raise DriveError(f"none/local produced no /echo line: {view['log'][view['log_before']:]}")
    assert_exchange(
        got,
        method="POST",
        path="/echo",
        query_key="q",
        query_val="from-local",
        hdr="alpha",
        body_val="ada",
        auth_header=None,
        auth_value=None,
    )
    shot("http-auth-none")
    shot("http-env-local")
    print("pass auth none + local substitution", flush=True)

    configure_bearer()
    click('xpath=//button[normalize-space()="Auth"]')
    auth_text = page_text()
    if "kind: env_var" not in auth_text or "variable: HS_BEARER" not in auth_text:
        raise DriveError(f"auth tab did not show bearer: {auth_text[:800]}")
    inherited = "Auth is inherited from the service (configured in the service panel)."
    print(f"auth-tab-inherited-copy={inherited in auth_text}", flush=True)
    view = send_and_wait()
    if "200" not in view["meta"]:
        raise DriveError(f"bearer meta: {view['meta']!r}\n{view['text'][:800]}")
    got = last_path(view["log"], "/echo", view["log_before"])
    if not got:
        raise DriveError("bearer produced no /echo")
    assert_exchange(
        got,
        method="POST",
        path="/echo",
        query_key="q",
        query_val="from-local",
        hdr="alpha",
        body_val="ada",
        auth_header="authorization",
        auth_value=f"Bearer {BEARER_SECRET}",
    )
    shot("http-auth-bearer")
    print("pass bearer", flush=True)

    configure_apikey()
    view = send_and_wait()
    if "200" not in view["meta"]:
        raise DriveError(f"apikey meta: {view['meta']!r}\n{view['text'][:800]}")
    got = last_path(view["log"], "/echo", view["log_before"])
    if not got:
        raise DriveError("apikey produced no /echo")
    assert_exchange(
        got,
        method="POST",
        path="/echo",
        query_key="q",
        query_val="from-local",
        hdr="alpha",
        body_val="ada",
        auth_header="x-api-key",
        auth_value=APIKEY_SECRET,
    )
    if header(got, "authorization"):
        raise DriveError(f"api key request still had authorization: {header(got, 'authorization')}")
    shot("http-auth-apikey")
    print("pass api key", flush=True)

    configure_oauth()
    view = send_and_wait()
    if "200" not in view["meta"]:
        raise DriveError(f"oauth meta: {view['meta']!r}\n{view['text'][:800]}")
    token = last_path(view["log"], "/token", view["log_before"])
    got = last_path(view["log"], "/echo", view["log_before"])
    if not got:
        raise DriveError(f"oauth log missing echo: {view['log'][view['log_before']:]}")
    if token:
        if form_value(token, "grant_type") != "client_credentials":
            raise DriveError(f"grant_type {token.get('body')!r}")
        if form_value(token, "client_id") != "id-local" or form_value(token, "client_secret") != "sec-local":
            raise DriveError(f"oauth client fields {token.get('body')!r}")
        if form_value(token, "scope") != "scope.local":
            raise DriveError(f"oauth scope {token.get('body')!r}")
        print("oauth fetched a token", flush=True)
    else:
        # Same client id/secret/scope is cached for the process. The header
        # check below is what the server still receives.
        print("oauth used the process token cache", flush=True)
    assert_exchange(
        got,
        method="POST",
        path="/echo",
        query_key="q",
        query_val="from-local",
        hdr="alpha",
        body_val="ada",
        auth_header="authorization",
        auth_value="Bearer tok-id-local",
    )
    shot("http-auth-oauth2")
    print("pass oauth2", flush=True)

    activate_env("other")
    shot("http-env-switched-pill")
    view = send_and_wait()
    if "200" not in view["meta"]:
        raise DriveError(f"switched env meta: {view['meta']!r}\n{view['text'][:800]}")
    token = last_path(view["log"], "/token", view["log_before"])
    got = last_path(view["log"], "/echo", view["log_before"])
    if not got:
        raise DriveError(f"switched env log: {view['log'][view['log_before']:]}")
    if token:
        if form_value(token, "client_id") != "id-other" or form_value(token, "client_secret") != "sec-other":
            raise DriveError(f"switched oauth fields {token.get('body')!r}")
        if form_value(token, "scope") != "scope.other":
            raise DriveError(f"switched oauth scope {token.get('body')!r}")
        if form_value(token, "grant_type") != "client_credentials":
            raise DriveError(f"switched grant_type {token.get('body')!r}")
        print("switched env fetched a new token", flush=True)
    else:
        print("switched env used the process token cache", flush=True)
    assert_exchange(
        got,
        method="POST",
        path="/echo",
        query_key="q",
        query_val="from-other",
        hdr="beta",
        body_val="bea",
        auth_header="authorization",
        auth_value="Bearer tok-id-other",
    )
    shot("http-env-other")
    print("pass env switch", flush=True)

    configure_none()
    view = send_and_wait()
    if "200" not in view["meta"]:
        raise DriveError(f"none-after-switch meta: {view['meta']!r}\n{view['text'][:800]}")
    got = last_path(view["log"], "/echo", view["log_before"])
    if not got:
        raise DriveError("none-after-switch produced no /echo")
    assert_exchange(
        got,
        method="POST",
        path="/echo",
        query_key="q",
        query_val="from-other",
        hdr="beta",
        body_val="bea",
        auth_header=None,
        auth_value=None,
    )
    print("pass none clears the header", flush=True)

    before = len(log_entries())
    set_labeled("Request URL", "{{noSuchVar}}")
    view = send_and_wait()
    if "Unresolved variables: {{noSuchVar}}" not in view["text"]:
        raise DriveError(f"missing var text: {view['text'][:800]}")
    assert_no_new_requests(before, "missing variable")
    shot("http-env-missing")
    print("pass missing variable", flush=True)

    before = len(log_entries())
    set_labeled("Request URL", "{{blank}}/echo")
    view = send_and_wait()
    if "Invalid URL: start it with http:// or https://" not in view["text"]:
        raise DriveError(f"empty var text: {view['text'][:800]}")
    assert_no_new_requests(before, "empty variable")
    shot("http-env-empty")
    print("pass empty variable", flush=True)

    set_labeled("Request URL", "{{baseUrl}}/{{pathSeg}}")
    before = len(log_entries())
    click('xpath=(//button[@data-testid="history-row-open"][contains(.,"POST") and contains(.,"200")])[1]')
    time.sleep(0.6)
    url = evaljs('return document.querySelector(\'[aria-label="Request URL"]\')?.value || ""')
    if url != "{{baseUrl}}/{{pathSeg}}":
        raise DriveError(f"history reopen url {url!r}")
    assert_no_new_requests(before, "history reopen")
    click('xpath=//div[@data-node-id][.//span[normalize-space()="Echo probe"]]')
    time.sleep(0.4)
    assert_no_new_requests(before, "sidebar reopen")
    shot("http-reopen")
    print("pass history and sidebar reopen", flush=True)
    print("http drive ok", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print(f"DRIVE FAILED: {err}", file=sys.stderr, flush=True)
        try:
            shot("http-failure")
            text = page_text()
            Path("/tmp/handshaker-verify/http-failure.txt").write_text(text)
            print(text[:1500], file=sys.stderr)
        except Exception as shot_err:
            print(f"could not capture failure: {shot_err}", file=sys.stderr)
        raise
