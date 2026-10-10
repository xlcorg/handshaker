#!/usr/bin/env python3
"""Drive the Handshaker Tauri window through tauri-driver.

State for the latest launch is the symlink /tmp/handshaker-verify/current.
Override with HANDSHAKER_VERIFY_RUN=/tmp/handshaker-verify/<run>.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "target" / "debug" / "handshaker"
NATIVE_DRIVER = Path("/usr/bin/WebKitWebDriver")
VERIFY_ROOT = Path("/tmp/handshaker-verify")
CURRENT_LINK = VERIFY_ROOT / "current"
IDENTIFIER = "dev.handshaker.app"
TMUX_CONF = Path("/exec-daemon/tmux.portal.conf")


def tmux_cmd() -> list[str]:
    if TMUX_CONF.exists():
        return ["tmux", "-f", str(TMUX_CONF)]
    return ["tmux"]


def fail(msg: str) -> None:
    print(f"hsdrv: {msg}", file=sys.stderr)
    raise SystemExit(1)


def cmdline(pid: int) -> str:
    try:
        raw = Path(f"/proc/{pid}/cmdline").read_bytes()
    except OSError:
        return ""
    return raw.replace(b"\x00", b" ").decode(errors="replace").strip()


def ppid(pid: int) -> int:
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("PPid:"):
                return int(line.split()[1])
    except OSError:
        return 0
    return 0


def descendant_with(root: int, fragment: str) -> int:
    if fragment in cmdline(root):
        return root
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        child = int(entry.name)
        if ppid(child) == root and fragment in cmdline(child):
            return child
    return root


def pids_with(fragment: str) -> set[int]:
    found: set[int] = set()
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        cmd = cmdline(int(entry.name))
        if fragment in cmd:
            found.add(int(entry.name))
    return found


def free_port_pair(start: int = 4444) -> tuple[int, int]:
    port = start
    while port < 4600:
        a = socket.socket()
        b = socket.socket()
        try:
            a.bind(("127.0.0.1", port))
            b.bind(("127.0.0.1", port + 1))
            return port, port + 1
        except OSError:
            port += 2
        finally:
            a.close()
            b.close()
    fail("no free port pair between 4444 and 4600")
    return 0, 0


def wait_port(port: int, timeout: float = 15) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.3):
                return
        except OSError:
            time.sleep(0.15)
    fail(f"tauri-driver did not listen on 127.0.0.1:{port}")


def http(method: str, url: str, body: dict | None = None, timeout: float = 30):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read().decode()
            return res.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        raw = err.read().decode()
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"value": {"message": raw}}
        return err.code, parsed


def session_path(run: Path) -> Path:
    return run / "session.json"


def load_session() -> tuple[Path, dict]:
    env = os.environ.get("HANDSHAKER_VERIFY_RUN")
    if env:
        run = Path(env)
    elif CURRENT_LINK.exists():
        run = CURRENT_LINK.resolve()
    else:
        fail("no verify run. Launch first: .cursor/skills/control-app/scripts/launch.sh")
    path = session_path(run)
    if not path.exists():
        fail(f"missing {path}")
    return run, json.loads(path.read_text())


def base_url(sess: dict) -> str:
    return f"http://127.0.0.1:{sess['port']}/session/{sess['sessionId']}"


def wd(sess: dict, method: str, path: str, body: dict | None = None, timeout: float = 30):
    return http(method, base_url(sess) + path, body, timeout=timeout)


def element_id(payload: dict) -> str:
    value = payload.get("value")
    if not isinstance(value, dict) or "error" in value:
        fail(f"element lookup failed: {payload}")
    return next(iter(value.values()))


def parse_selector(selector: str) -> tuple[str, str]:
    if selector.startswith("xpath="):
        return "xpath", selector[len("xpath=") :]
    if selector.startswith("css="):
        return "css selector", selector[len("css=") :]
    return "css selector", selector


def eval_json(sess: dict, script: str):
    code, payload = wd(
        sess,
        "POST",
        "/execute/sync",
        {"script": script, "args": []},
    )
    if code != 200:
        fail(f"execute/sync failed ({code}): {payload}")
    value = payload.get("value")
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


READY_SCRIPT = r"""
return JSON.stringify({
  splash: !!document.getElementById("splash"),
  filter: !!document.querySelector("[aria-label='collection-filter']"),
  title: document.title,
  text: (document.body && document.body.innerText || "").slice(0, 1200)
});
"""


def wait_ready(sess: dict, timeout: float = 30) -> dict:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            state = eval_json(sess, READY_SCRIPT)
        except SystemExit:
            time.sleep(0.25)
            continue
        last = state
        if (
            isinstance(state, dict)
            and state.get("title") == "Handshaker"
            and not state.get("splash")
            and state.get("filter")
        ):
            return state
        time.sleep(0.25)
    fail(f"window never became ready: {last}")
    return {}


def app_version() -> str:
    pkg = json.loads((ROOT / "package.json").read_text())
    return str(pkg["version"])


def check_build() -> None:
    if not os.environ.get("DISPLAY"):
        fail("DISPLAY is unset. The Handshaker window needs an X server (this machine used DISPLAY=:1).")
    if not NATIVE_DRIVER.exists():
        fail("missing /usr/bin/WebKitWebDriver. Install the webkit2gtk-driver package.")
    if shutil.which("tauri-driver") is None:
        fail("tauri-driver is not on PATH. Install with: cargo install tauri-driver --locked --version 2.0.5")
    prettier = ROOT / "node_modules" / ".bin" / "prettier"
    if not prettier.exists():
        fail("missing node_modules/.bin/prettier. Run pnpm install from the repo root.")
    if not (ROOT / "dist" / "index.html").exists():
        fail("missing dist/index.html. Run pnpm build from the repo root before launching.")
    if not APP.exists():
        fail(f"missing {APP}. Run: cargo build -p handshaker")


def snapshot_bindings(run: Path) -> None:
    src = ROOT / "src" / "ipc" / "bindings.ts"
    if src.exists():
        shutil.copy2(src, run / "bindings.ts.before")
    diff = subprocess.run(
        ["git", "diff", "--quiet", "--", "src/ipc/bindings.ts"],
        cwd=ROOT,
    )
    (run / "bindings-dirty-before").write_text("0" if diff.returncode == 0 else "1")


def restore_bindings(run: Path) -> None:
    flag_path = run / "bindings-dirty-before"
    backup = run / "bindings.ts.before"
    if not flag_path.exists() or not backup.exists():
        return
    if flag_path.read_text().strip() != "0":
        print("hsdrv: src/ipc/bindings.ts was already dirty before launch; left it alone")
        return
    dest = ROOT / "src" / "ipc" / "bindings.ts"
    shutil.copy2(backup, dest)
    print(f"hsdrv: restored {dest.relative_to(ROOT)} from the pre-launch snapshot")


def launch() -> None:
    check_build()
    VERIFY_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    run = VERIFY_ROOT / f"{stamp}-{os.getpid()}"
    for name in ("xdg", "config", "cache", "evidence", "logs"):
        (run / name).mkdir(parents=True)
    seed = os.environ.get("HANDSHAKER_SEED_DATA", "").strip()
    if seed:
        src = Path(seed)
        if not src.is_dir():
            fail(f"HANDSHAKER_SEED_DATA is not a directory: {src}")
        shutil.copytree(src, run / "xdg" / IDENTIFIER, dirs_exist_ok=True)
        print(f"seeded {run / 'xdg' / IDENTIFIER} from {src}")
    snapshot_bindings(run)
    port, native = free_port_pair()
    tmux_name = f"handshaker-verify-{os.getpid()}"
    env = os.environ.copy()
    env["WEBKIT_DISABLE_COMPOSITING_MODE"] = "1"
    env["GDK_BACKEND"] = "x11"
    env["LIBGL_ALWAYS_SOFTWARE"] = "1"
    env["PATH"] = f"{ROOT / 'node_modules' / '.bin'}{os.pathsep}{env.get('PATH', '')}"
    env["XDG_DATA_HOME"] = str(run / "xdg")
    env["XDG_CONFIG_HOME"] = str(run / "config")
    env["XDG_CACHE_HOME"] = str(run / "cache")
    before = pids_with(str(APP))
    driver_pid = 0
    session_id = ""
    subprocess.run(
        tmux_cmd()
        + [
            "new-session",
            "-d",
            "-s",
            tmux_name,
            "-c",
            str(ROOT),
            "--",
            "env",
            f"DISPLAY={env['DISPLAY']}",
            "WEBKIT_DISABLE_COMPOSITING_MODE=1",
            "GDK_BACKEND=x11",
            "LIBGL_ALWAYS_SOFTWARE=1",
            f"PATH={env['PATH']}",
            f"XDG_DATA_HOME={env['XDG_DATA_HOME']}",
            f"XDG_CONFIG_HOME={env['XDG_CONFIG_HOME']}",
            f"XDG_CACHE_HOME={env['XDG_CACHE_HOME']}",
            "tauri-driver",
            "--port",
            str(port),
            "--native-port",
            str(native),
            "--native-driver",
            str(NATIVE_DRIVER),
        ],
        check=True,
    )
    subprocess.run(
        tmux_cmd() + ["pipe-pane", "-t", tmux_name, "-o", f"cat >> {run / 'logs' / 'driver.log'}"],
        check=False,
    )
    try:
        wait_port(port)
        pane = subprocess.run(
            tmux_cmd() + ["list-panes", "-t", tmux_name, "-F", "#{pane_pid}"],
            check=True,
            capture_output=True,
            text=True,
        )
        pane_pid = int(pane.stdout.strip().splitlines()[0])
        driver_pid = descendant_with(pane_pid, "tauri-driver")
        code, payload = http(
            "POST",
            f"http://127.0.0.1:{port}/session",
            {
                "capabilities": {
                    "alwaysMatch": {
                        "browserName": "wry",
                        "tauri:options": {"application": str(APP)},
                    }
                }
            },
            timeout=60,
        )
        if code != 200 or "sessionId" not in payload.get("value", {}):
            log = (run / "logs" / "driver.log").read_text() if (run / "logs" / "driver.log").exists() else ""
            fail(f"session not created ({code}): {payload}\n{log[-2000:]}")
        session_id = payload["value"]["sessionId"]
        # The binary can show up a moment after the session response.
        deadline = time.time() + 5
        app_pids: list[int] = []
        while time.time() < deadline:
            app_pids = sorted(pids_with(str(APP)) - before)
            if app_pids:
                break
            time.sleep(0.1)
        sess = {
            "run": str(run),
            "sessionId": session_id,
            "port": port,
            "nativePort": native,
            "driverPid": driver_pid,
            "appPids": app_pids,
            "tmuxSession": tmux_name,
            "application": str(APP),
            "dataDir": str(run / "xdg" / IDENTIFIER),
            "evidence": str(run / "evidence"),
        }
        session_path(run).write_text(json.dumps(sess, indent=2) + "\n")
        if CURRENT_LINK.exists() or CURRENT_LINK.is_symlink():
            CURRENT_LINK.unlink()
        CURRENT_LINK.symlink_to(run)
        state = wait_ready(sess)
        late = sorted(set(app_pids) | (pids_with(str(APP)) - before))
        if late != app_pids:
            sess["appPids"] = late
            session_path(run).write_text(json.dumps(sess, indent=2) + "\n")
    except BaseException:
        try:
            cleanup_recorded(
                run,
                {
                    "sessionId": session_id,
                    "port": port,
                    "driverPid": driver_pid,
                    "appPids": sorted(pids_with(str(APP)) - before),
                    "tmuxSession": tmux_name,
                    "application": str(APP),
                },
            )
        except Exception as cleanup_err:
            print(f"hsdrv: cleanup after failed launch: {cleanup_err}", file=sys.stderr)
        raise
    excerpt = " ".join((state.get("text") or "").split())
    print(
        f"ready run={run} session={session_id} data={sess['dataDir']} "
        f"title={state.get('title')} filter=yes splash=no"
    )
    print(f"window: {excerpt[:300]}")


def doctor() -> None:
    _run, sess = load_session()
    code, title_payload = wd(sess, "GET", "/title")
    if code != 200:
        fail(f"title request failed ({code}): {title_payload}")
    title = title_payload.get("value")
    code, url_payload = wd(sess, "GET", "/url")
    url = url_payload.get("value") if code == 200 else ""
    state = eval_json(sess, READY_SCRIPT)
    version = app_version()
    text = state.get("text") or ""
    problems = []
    if title != "Handshaker":
        problems.append(f"title is {title!r}")
    if not str(url).startswith("tauri://"):
        problems.append(f"url is {url!r}")
    if state.get("splash"):
        problems.append("splash overlay is still in the DOM")
    if not state.get("filter"):
        problems.append("collection filter is missing")
    if f"v{version}" not in text:
        problems.append(f"version badge v{version} is missing from the window text")
    if "COLLECTIONS" not in text:
        problems.append("sidebar label COLLECTIONS is missing")
    print(f"title: {title}")
    print(f"url: {url}")
    print(f"splash: {state.get('splash')}")
    print(f"collectionFilter: {state.get('filter')}")
    print(f"versionBadge: v{version}")
    print("excerpt: " + " ".join(text.split())[:400])
    if problems:
        fail("doctor: " + "; ".join(problems))
    print("ok")


def click(sess: dict, selector: str) -> None:
    using, value = parse_selector(selector)
    deadline = time.time() + 10
    last = None
    eid = ""
    while time.time() < deadline:
        code, payload = wd(sess, "POST", "/element", {"using": using, "value": value})
        last = payload
        if code == 200 and isinstance(payload.get("value"), dict) and "error" not in payload["value"]:
            eid = element_id(payload)
            break
        time.sleep(0.2)
    if not eid:
        fail(f"selector not found: {selector} last={last}")
    code, payload = wd(sess, "POST", f"/element/{eid}/click", {})
    if code != 200:
        fail(f"click failed ({code}): {payload}")


def screenshot(sess: dict, dest: Path) -> None:
    code, payload = wd(sess, "GET", "/screenshot", timeout=30)
    if code != 200 or not isinstance(payload.get("value"), str):
        fail(f"screenshot failed ({code}): {str(payload)[:300]}")
    dest.write_bytes(base64.b64decode(payload["value"]))


def drive_collections() -> None:
    run, sess = load_session()
    wait_ready(sess)
    data = Path(sess["dataDir"]) / "collections"
    if not str(data).startswith(str(run / "xdg")):
        fail(f"refusing to drive; data dir is outside this run: {data}")
    before = {p.name for p in data.glob("*.json")} if data.exists() else set()
    click(sess, "[aria-label='new-item']")
    click(sess, "[aria-label='new-collection']")
    deadline = time.time() + 10
    created = None
    while time.time() < deadline:
        state = eval_json(
            sess,
            r"""
            const input = document.querySelector("[aria-label='rename-input']");
            const row = input && input.closest("[data-node-id]");
            return JSON.stringify({
              value: input ? input.value : null,
              id: row ? row.getAttribute("data-node-id") : null,
              text: (document.body.innerText || "").slice(0, 1500)
            });
            """,
        )
        if state.get("value") == "New collection" and state.get("id"):
            created = state
            break
        time.sleep(0.2)
    if not created:
        fail("New collection rename field did not appear")
    path = data / f"{created['id']}.json"
    if not path.exists():
        fail(f"collection file missing: {path}")
    doc = json.loads(path.read_text())
    name = doc.get("data", {}).get("name")
    if name != "New collection":
        fail(f"{path} name is {name!r}")
    if path.name in before:
        fail(f"{path.name} already existed before the click")
    evidence = Path(sess["evidence"])
    evidence.mkdir(parents=True, exist_ok=True)
    shot = evidence / "collections-new.png"
    screenshot(sess, shot)
    (evidence / "collections-dom.txt").write_text(created.get("text") or "")
    shutil.copy2(path, evidence / "new-collection.json")
    result = {
        "feature": "collections",
        "renameInput": created["value"],
        "collectionId": created["id"],
        "collectionFile": str(path),
        "name": name,
        "screenshot": str(shot),
    }
    (evidence / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(f"proved collections: rename-input={created['value']!r} file={path}")
    print(f"evidence: {evidence}")


def kill_pid(pid: int, must_contain: str) -> None:
    if pid <= 0:
        return
    cmd = cmdline(pid)
    if not cmd:
        print(f"hsdrv: pid {pid} already gone")
        return
    if must_contain not in cmd:
        print(f"hsdrv: refuse to kill pid {pid}; cmdline does not contain {must_contain!r}: {cmd[:140]}")
        return
    print(f"hsdrv: stopping pid {pid}")
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    for _ in range(25):
        if not cmdline(pid):
            return
        time.sleep(0.2)
    if must_contain in cmdline(pid):
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            return


def cleanup_recorded(run: Path, sess: dict) -> None:
    session_id = sess.get("sessionId") or ""
    port = sess.get("port")
    if session_id and port:
        try:
            http("DELETE", f"http://127.0.0.1:{port}/session/{session_id}", timeout=15)
            print(f"hsdrv: deleted webdriver session {session_id}")
        except Exception as err:
            print(f"hsdrv: session delete failed ({err}); continuing with recorded pids")
    app = sess.get("application") or str(APP)
    for pid in sess.get("appPids") or []:
        kill_pid(int(pid), app)
    kill_pid(int(sess.get("driverPid") or 0), "tauri-driver")
    tmux_name = sess.get("tmuxSession")
    if tmux_name:
        # The session often exits when its driver pid is signaled, so a second
        # kill-session can report "no server running". That is the same outcome.
        subprocess.run(
            tmux_cmd() + ["kill-session", "-t", tmux_name],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    restore_bindings(run)


def cleanup() -> None:
    run, sess = load_session()
    cleanup_recorded(run, sess)
    evidence = Path(sess.get("evidence") or (run / "evidence"))
    if CURRENT_LINK.exists() and CURRENT_LINK.resolve() == run.resolve():
        CURRENT_LINK.unlink()
    print(f"cleaned run={run}")
    print(f"evidence kept at {evidence}")
    if evidence.exists():
        for path in sorted(evidence.iterdir()):
            print(f"  {path.name} ({path.stat().st_size} bytes)")


def cmd_click() -> None:
    if len(sys.argv) != 3:
        fail("usage: hsdrv.py click <css selector|xpath=...>")
    _run, sess = load_session()
    click(sess, sys.argv[2])
    print(f"clicked {sys.argv[2]}")


def cmd_eval() -> None:
    if len(sys.argv) != 3:
        fail("usage: hsdrv.py eval <javascript>")
    _run, sess = load_session()
    value = eval_json(sess, sys.argv[2])
    if isinstance(value, str):
        print(value)
    else:
        print(json.dumps(value, indent=2))


def cmd_text() -> None:
    _run, sess = load_session()
    value = eval_json(sess, "return document.body ? document.body.innerText : ''")
    print(value if isinstance(value, str) else json.dumps(value))


def evidence_png_name(raw: str) -> str:
    name = raw.strip()
    if not name or name in {".", ".."} or "/" in name or "\\" in name:
        fail("usage: hsdrv.py screenshot <name>")
    if not name.endswith(".png"):
        name = f"{name}.png"
    return name


def cmd_screenshot() -> None:
    if len(sys.argv) != 3:
        fail("usage: hsdrv.py screenshot <name>")
    _run, sess = load_session()
    evidence = Path(sess["evidence"])
    evidence.mkdir(parents=True, exist_ok=True)
    dest = (evidence / evidence_png_name(sys.argv[2])).resolve()
    if dest.parent != evidence.resolve():
        fail("screenshot name must stay inside the evidence directory")
    screenshot(sess, dest)
    print(f"screenshot {dest}")


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    commands = {
        "launch": launch,
        "doctor": doctor,
        "drive-collections": drive_collections,
        "cleanup": cleanup,
        "click": cmd_click,
        "eval": cmd_eval,
        "text": cmd_text,
        "screenshot": cmd_screenshot,
    }
    if cmd not in commands:
        fail("usage: hsdrv.py launch|doctor|drive-collections|cleanup|click|eval|text|screenshot")
    commands[cmd]()


if __name__ == "__main__":
    main()
