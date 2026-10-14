#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
SCRIPTS = Path(__file__).resolve().parent

NEW_ID = "66666666-6666-4666-8666-666666666666"
EDITED_NAME = "get order edited"
FILE_NEW_NAME = "from file"
LOCAL_NAME = "local only"
FILE_DESCRIPTION = "updated from file"


def load_transfer():
    spec = importlib.util.spec_from_file_location("drive_transfer", SCRIPTS / "drive-transfer.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load drive-transfer.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


dt = load_transfer()


def shot(name: str) -> Path:
    return dt.shot(name)


def names_of(items: list) -> list[str]:
    found = []
    for item in items:
        found.append(item.get("name", ""))
        if item.get("type") == "folder":
            found.extend(names_of(item.get("items") or []))
    return found


def walk(items: list):
    for item in items:
        yield item
        if item.get("type") == "folder":
            yield from walk(item.get("items") or [])


def find_name(items: list, name: str) -> dict | None:
    for item in walk(items):
        if item.get("name") == name:
            return item
    return None


def open_row_menu(item_id: str) -> None:
    dt.expand_tree()
    shown = dt.evaljs(
        f"""
        const row = document.querySelector('[data-node-id="{item_id}"]');
        if (!row) return {{ ok: false, why: "no-row" }};
        const scope = row.closest('[class*="group/row"]');
        const btn = scope && scope.querySelector('[aria-label="More options"]');
        if (!btn) return {{ ok: false, why: "no-btn" }};
        btn.style.opacity = "1";
        return {{ ok: true }};
        """
    )
    if not isinstance(shown, dict) or not shown.get("ok"):
        raise dt.DriveError(f"no row menu for {item_id}: {shown}")
    dt.click(
        f'xpath=//div[@data-node-id="{item_id}"]/ancestor::div[contains(@class,"group/row")][1]//button[@aria-label="More options"]'
    )


def rename_local(item_id: str) -> None:
    open_row_menu(item_id)
    dt.click('xpath=//*[@role="menuitem"][normalize-space()="Rename"]')
    dt.wait_until(
        'const i=document.querySelector("[aria-label=rename-input]"); return i?i.value:"";',
        lambda value: isinstance(value, str) and value != "",
        what="rename input",
    )
    renamed = dt.evaljs(
        f"""
        const input = document.querySelector("[aria-label=rename-input]");
        const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
        proto.set.call(input, {json.dumps(LOCAL_NAME)});
        input.dispatchEvent(new Event("input", {{ bubbles: true }}));
        input.blur();
        return input.value;
        """
    )
    print(f"renamed input: {renamed}", flush=True)
    dt.wait_until(
        f"""
        const row = document.querySelector('[data-node-id="{item_id}"]');
        return row ? row.innerText : "";
        """,
        lambda text: isinstance(text, str) and LOCAL_NAME in text,
        what="renamed row",
    )


def edit_export(path: Path) -> None:
    doc = json.loads(path.read_text())
    collections = doc["data"]["collections"]
    target = next(c for c in collections if c["id"] == dt.CID)
    target["description"] = FILE_DESCRIPTION
    get = find_name(target["items"], "get order")
    if get is None:
        raise dt.DriveError("exported collection has no get order request")
    get["name"] = EDITED_NAME
    target["items"].append(
        {
            "type": "request",
            "id": NEW_ID,
            "name": FILE_NEW_NAME,
            "last_used_at": None,
            "use_count": 0,
            "protocol": "http",
            "method": "GET",
            "url_template": "http://127.0.0.1:8765/from-file",
            "query": [],
            "headers": [],
            "body": {"kind": "none"},
            "auth": {"kind": "none"},
        }
    )
    path.write_text(json.dumps(doc, indent=2) + "\n")


def assert_merged(collection: dict, local_id: str) -> None:
    items = collection["items"]
    names = names_of(items)
    print(f"names after reimport: {names}", flush=True)
    if collection.get("description") != FILE_DESCRIPTION:
        raise dt.DriveError(f"description is {collection.get('description')!r}")
    local = next((item for item in walk(items) if item.get("id") == local_id), None)
    if local is None:
        raise dt.DriveError(f"local-only request {local_id} was deleted")
    if local.get("name") != LOCAL_NAME:
        raise dt.DriveError(f"local request name is {local.get('name')!r}")
    edited = find_name(items, EDITED_NAME)
    if edited is None or edited.get("id") != dt.GET:
        raise dt.DriveError(f"edited request missing: {edited}")
    if find_name(items, "get order") is not None:
        raise dt.DriveError("old get order name still present")
    added = find_name(items, FILE_NEW_NAME)
    if added is None or added.get("id") != NEW_ID:
        raise dt.DriveError(f"file-only request missing: {added}")
    folder = next(item for item in items if item.get("id") == dt.FOLDER)
    folder_ids = [child.get("id") for child in folder.get("items") or []]
    if dt.POST not in folder_ids or local_id not in folder_ids:
        raise dt.DriveError(f"folder children lost their place: {folder_ids}")
    if folder_ids.index(local_id) != folder_ids.index(dt.POST) + 1:
        raise dt.DriveError(f"local duplicate not beside its source: {folder_ids}")
    root_ids = [item.get("id") for item in items]
    if root_ids[-1] != NEW_ID:
        raise dt.DriveError(f"new file request was not appended: {root_ids}")
    if dt.GET not in root_ids or dt.HEAD not in root_ids or dt.GRPC not in root_ids:
        raise dt.DriveError(f"exported root items missing: {root_ids}")
    print("merge ok", flush=True)


def main() -> None:
    seed = Path("/tmp/hs-reimport-seed")
    dt.write_seed(seed)
    try:
        dt.launch(seed)
        doctor = subprocess.run([str(SCRIPTS / "doctor.sh")], cwd=ROOT, text=True, capture_output=True, timeout=60)
        print(doctor.stdout, flush=True)
        if doctor.returncode != 0:
            raise dt.DriveError(f"doctor failed\n{doctor.stderr}")
        dt.install_stub()
        dt.expand_tree()
        shot("reimport-before")

        export_path = dt.evidence_dir() / "reimport-export.json"
        dt.export_via(export_path, lambda: dt.open_actions("export"))
        shot("reimport-exported")

        before = dt.load_data(dt.data_dir() / "collections" / f"{dt.CID}.json")
        before_ids = dt._request_ids(before)
        open_row_menu(dt.POST)
        dt.click('xpath=//*[@role="menuitem"][normalize-space()="Duplicate"]')
        time.sleep(0.4)
        after_add = dt.load_data(dt.data_dir() / "collections" / f"{dt.CID}.json")
        extra = dt._request_ids(after_add) - before_ids
        if len(extra) != 1:
            raise dt.DriveError(f"expected one new local request, got {sorted(extra)}")
        local_id = next(iter(extra))
        rename_local(local_id)
        shot("reimport-local-added")

        edit_export(export_path)
        dt.arm(str(export_path))
        dt.open_actions("import")
        summary = dt.wait_until(
            'const el=document.querySelector("[role=alertdialog]"); return el?el.innerText:"";',
            lambda text: isinstance(text, str) and "Import collections?" in text and "already exist" in text,
            what="reimport summary",
        )
        print(f"summary: {summary}", flush=True)
        shot("reimport-dialog")
        dt.begin_toast()
        dt.click('xpath=//*[@role="alertdialog"]//button[normalize-space()="Import"]')
        toast = dt.wait_toast("Imported")
        print(f"toast: {toast}", flush=True)
        dt.expand_tree()
        time.sleep(0.4)
        shot("reimport-after")
        merged = dt.load_data(dt.data_dir() / "collections" / f"{dt.CID}.json")
        assert_merged(merged, local_id)
        sidebar = dt.evaljs(
            f"""
            const ids = {json.dumps([local_id, dt.GET, NEW_ID])};
            return Object.fromEntries(ids.map((id) => {{
              const row = document.querySelector('[data-node-id="' + id + '"]');
              return [id, row ? row.innerText : ""];
            }}));
            """
        )
        print(f"sidebar rows: {sidebar}", flush=True)
        if not isinstance(sidebar, dict):
            raise dt.DriveError(f"sidebar probe failed: {sidebar}")
        if LOCAL_NAME not in str(sidebar.get(local_id, "")):
            raise dt.DriveError(f"sidebar lost local request: {sidebar}")
        if EDITED_NAME not in str(sidebar.get(dt.GET, "")):
            raise dt.DriveError(f"sidebar did not show edited name: {sidebar}")
        if FILE_NEW_NAME not in str(sidebar.get(NEW_ID, "")):
            raise dt.DriveError(f"sidebar did not show file request: {sidebar}")
        if "only on this machine" not in str(summary).lower():
            raise dt.DriveError(f"dialog does not say local items are kept: {summary}")
        print("reimport merge ok", flush=True)
    except Exception:
        try:
            shot("reimport-failure")
        except Exception as shot_exc:
            print(f"failure shot skipped: {shot_exc}", flush=True)
        raise
    finally:
        dt.cleanup()


if __name__ == "__main__":
    try:
        main()
    except (dt.DriveError, subprocess.TimeoutExpired, OSError) as exc:
        print(f"FAIL {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
