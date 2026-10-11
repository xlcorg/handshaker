#!/usr/bin/env python3

from __future__ import annotations

import argparse
import ctypes
import json
import os
import re
import shutil
import signal
import statistics
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

IDENTIFIER = "dev.handshaker.app"
BG = (0x0A, 0x0A, 0x0A)
LIGHT_MIN = 140
WINDOW_BG_PLUS_NOISE = 18
CLIENT_ROW_MIN_DARK_SHARE = 0.75
CLIENT_MIN_CROP_SHARE = 0.5
PREROLL_SLACK_MS = 50
GRABBER_READY = b"Press [q] to stop"


@dataclass(frozen=True)
class LogoVersusSidebar:
    logo_samples: int
    sidebar_samples: int
    fade_center: int
    sidebar_width: float
    title_height: float
    center_x0: float
    center_x1: float
    center_y0: float
    center_y1: float


LOGO_VERSUS_SIDEBAR = LogoVersusSidebar(
    logo_samples=8,
    sidebar_samples=8,
    fade_center=100,
    sidebar_width=0.22,
    title_height=0.06,
    center_x0=0.35,
    center_x1=0.65,
    center_y0=0.30,
    center_y1=0.70,
)


def fail(msg: str) -> None:
    print(f"cold-start: {msg}", file=sys.stderr)
    raise SystemExit(1)


def screen_size() -> tuple[int, int]:
    out = subprocess.check_output(["xdpyinfo"], text=True)
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("dimensions:"):
            dims = line.split()[1]
            w, h = dims.split("x")
            return int(w), int(h)
    fail("xdpyinfo did not report dimensions")
    return 0, 0


def loadavg() -> str:
    return Path("/proc/loadavg").read_text().strip()


def process_start_wall(pid: int) -> float:
    stat = Path(f"/proc/{pid}/stat").read_text()
    after = stat.rsplit(")", 1)[1].split()
    # Field 22 is starttime in clock ticks since boot. After the comm
    # field, index 19 is that value.
    start_ticks = int(after[19])
    ticks = os.sysconf("SC_CLK_TCK")
    mono_ns = time.clock_gettime_ns(time.CLOCK_MONOTONIC)
    wall_ns = time.time_ns()
    boot_wall = wall_ns - mono_ns
    return (boot_wall + (start_ticks / ticks) * 1_000_000_000) / 1e9


class XSetWindowAttributes(ctypes.Structure):
    _fields_ = [
        ("background_pixmap", ctypes.c_ulong),
        ("background_pixel", ctypes.c_ulong),
        ("border_pixmap", ctypes.c_ulong),
        ("border_pixel", ctypes.c_ulong),
        ("bit_gravity", ctypes.c_int),
        ("win_gravity", ctypes.c_int),
        ("backing_store", ctypes.c_int),
        ("backing_planes", ctypes.c_ulong),
        ("backing_pixel", ctypes.c_ulong),
        ("save_under", ctypes.c_int),
        ("event_mask", ctypes.c_long),
        ("do_not_propagate_mask", ctypes.c_long),
        ("override_redirect", ctypes.c_int),
        ("colormap", ctypes.c_ulong),
        ("cursor", ctypes.c_ulong),
    ]


class XColor(ctypes.Structure):
    _fields_ = [
        ("pixel", ctypes.c_ulong),
        ("red", ctypes.c_ushort),
        ("green", ctypes.c_ushort),
        ("blue", ctypes.c_ushort),
        ("flags", ctypes.c_char),
        ("pad", ctypes.c_char * 3),
    ]


class ClockMarker:
    """A 16x16 magenta window used to align x11grab pts to unix time.

    xsetroot is invisible here because a desktop window covers the root.
    Mapping a real X window changes pixels ffmpeg actually grabs.
    """

    def __init__(self, screen: tuple[int, int]) -> None:
        self.x11 = ctypes.CDLL("libX11.so.6")
        self.x11.XOpenDisplay.restype = ctypes.c_void_p
        self.x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
        self.x11.XDefaultScreen.argtypes = [ctypes.c_void_p]
        self.x11.XDefaultScreen.restype = ctypes.c_int
        self.x11.XRootWindow.argtypes = [ctypes.c_void_p, ctypes.c_int]
        self.x11.XRootWindow.restype = ctypes.c_ulong
        self.x11.XDefaultColormap.argtypes = [ctypes.c_void_p, ctypes.c_int]
        self.x11.XDefaultColormap.restype = ctypes.c_ulong
        self.x11.XAllocColor.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(XColor)]
        self.x11.XAllocColor.restype = ctypes.c_int
        self.x11.XCreateSimpleWindow.argtypes = [
            ctypes.c_void_p,
            ctypes.c_ulong,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_uint,
            ctypes.c_uint,
            ctypes.c_uint,
            ctypes.c_ulong,
            ctypes.c_ulong,
        ]
        self.x11.XCreateSimpleWindow.restype = ctypes.c_ulong
        self.x11.XChangeWindowAttributes.argtypes = [
            ctypes.c_void_p,
            ctypes.c_ulong,
            ctypes.c_ulong,
            ctypes.c_void_p,
        ]
        self.x11.XMapWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        self.x11.XFlush.argtypes = [ctypes.c_void_p]
        self.x11.XDestroyWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        self.x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
        self.dpy = self.x11.XOpenDisplay(None)
        if not self.dpy:
            fail("XOpenDisplay failed for the clock marker")
        screen_i = self.x11.XDefaultScreen(self.dpy)
        root = self.x11.XRootWindow(self.dpy, screen_i)
        cmap = self.x11.XDefaultColormap(self.dpy, screen_i)
        color = XColor()
        color.red = 65535
        color.green = 0
        color.blue = 65535
        color.flags = 7
        if self.x11.XAllocColor(self.dpy, cmap, ctypes.byref(color)) == 0:
            fail("XAllocColor failed for the clock marker")
        self.size = 16
        self.x = screen[0] - self.size - 8
        self.y = screen[1] - self.size - 8
        self.win = self.x11.XCreateSimpleWindow(
            self.dpy, root, self.x, self.y, self.size, self.size, 0, color.pixel, color.pixel
        )

    def show(self) -> float:
        # Without override-redirect the window manager recenters the marker
        # and the pts alignment looks at the wrong pixels.
        attrs = XSetWindowAttributes()
        attrs.override_redirect = 1
        self.x11.XChangeWindowAttributes(self.dpy, self.win, 1 << 9, ctypes.byref(attrs))
        self.x11.XMapWindow(self.dpy, self.win)
        self.x11.XFlush(self.dpy)
        return time.time()

    def close(self) -> None:
        if self.dpy:
            self.x11.XDestroyWindow(self.dpy, self.win)
            self.x11.XCloseDisplay(self.dpy)
            self.dpy = None


def parse_xwininfo_line(line: str) -> dict | None:
    """Client size plus absolute screen position from one xwininfo -tree line.

    xwininfo prints `WxH+relX+relY` (inside the parent frame) and then a
    separate `+absX+absY`. The crop has to use the absolute corner. A line
    with only the relative token falls back to that corner.
    """
    line = line.strip()
    if "handshaker" not in line.lower():
        return None
    parts = line.split()
    if not parts or not parts[0].startswith("0x"):
        return None
    size = None
    for token in parts:
        if "x" in token and "+" in token and not token.startswith(("+", "-")):
            size = token
            break
    if size is None:
        return None
    try:
        wh, rel_x, rel_y = size.split("+", 2)
        w_s, h_s = wh.split("x")
        w, h = int(w_s), int(h_s)
        fallback = (int(rel_x), int(rel_y))
    except ValueError:
        return None
    absolute = None
    for token in parts:
        match = re.fullmatch(r"([+-]\d+)([+-]\d+)", token)
        if match:
            absolute = (int(match.group(1)), int(match.group(2)))
    x, y = absolute or fallback
    if w < 400 or h < 300:
        return None
    return {"id": parts[0], "w": w, "h": h, "x": x, "y": y}


def settled_window(samples: list[dict]) -> dict | None:
    if not samples:
        return None
    counts: dict[tuple, int] = {}
    for sample in samples:
        key = (sample["x"], sample["y"], sample["w"], sample["h"], sample["id"])
        counts[key] = counts.get(key, 0) + 1
    x, y, w, h, wid = max(counts, key=counts.get)
    return {"id": wid, "w": w, "h": h, "x": x, "y": y}


def find_window() -> dict | None:
    try:
        out = subprocess.check_output(["xwininfo", "-root", "-tree"], text=True, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        return None
    best = None
    for line in out.splitlines():
        rect = parse_xwininfo_line(line)
        if rect is not None:
            best = rect
    return best


def luma(r: int, g: int, b: int) -> int:
    return (r * 54 + g * 183 + b * 19) >> 8


def pixel_is_client(r: int, g: int, b: int) -> bool:
    return r <= WINDOW_BG_PLUS_NOISE and g <= WINDOW_BG_PLUS_NOISE and b <= WINDOW_BG_PLUS_NOISE


def content_box(buf: bytes, w: int, h: int, stride: int = 4) -> tuple[int, int, int, int] | None:
    dark_rows = []
    for y in range(0, h, stride):
        row = y * w * 3
        dark = 0
        total = 0
        for x in range(0, w, stride):
            i = row + x * 3
            total += 1
            if pixel_is_client(buf[i], buf[i + 1], buf[i + 2]):
                dark += 1
        if total and dark / total >= CLIENT_ROW_MIN_DARK_SHARE:
            dark_rows.append(y)
    if not dark_rows or (dark_rows[-1] - dark_rows[0]) < h * CLIENT_MIN_CROP_SHARE:
        return None
    y0 = dark_rows[0]
    y1 = min(h, dark_rows[-1] + stride)
    y = dark_rows[len(dark_rows) // 2]
    row = y * w * 3
    xs = []
    for x in range(0, w, stride):
        i = row + x * 3
        if pixel_is_client(buf[i], buf[i + 1], buf[i + 2]):
            xs.append(x)
    if not xs:
        return None
    x0 = xs[0]
    x1 = min(w, xs[-1] + stride)
    if x1 - x0 < 400 or y1 - y0 < 300:
        return None
    return x0, y0, x1 - x0, y1 - y0


def classify_frame(buf: bytes, w: int, h: int, stride: int = 4, src_w: int | None = None, ox: int = 0, oy: int = 0) -> dict:
    src_w = w if src_w is None else src_w
    if w <= 0 or h <= 0 or len(buf) < (oy + h - 1) * src_w * 3 + (ox + w) * 3:
        return {
            "label": "invalid",
            "light": 0,
            "light_left": 0,
            "light_center": 0,
            "light_top": 0,
            "mean_rgb": [0, 0, 0],
            "samples": 0,
        }
    rule = LOGO_VERSUS_SIDEBAR
    left_x = int(w * rule.sidebar_width)
    top_y = max(1, int(h * rule.title_height))
    cx0, cx1 = int(w * rule.center_x0), int(w * rule.center_x1)
    cy0, cy1 = int(h * rule.center_y0), int(h * rule.center_y1)
    light = light_left = light_center = light_top = 0
    samples = 0
    sum_r = sum_g = sum_b = 0
    row_bytes = src_w * 3
    for y in range(oy, oy + h, stride):
        row = y * row_bytes
        for x in range(ox, ox + w, stride):
            i = row + x * 3
            r, g, b = buf[i], buf[i + 1], buf[i + 2]
            samples += 1
            sum_r += r
            sum_g += g
            sum_b += b
            if luma(r, g, b) < LIGHT_MIN:
                continue
            light += 1
            ly = y - oy
            lx = x - ox
            if ly < top_y:
                light_top += 1
            if lx < left_x and ly >= top_y:
                light_left += 1
            if cx0 <= lx < cx1 and cy0 <= ly < cy1:
                light_center += 1
    mean = [round(sum_r / samples), round(sum_g / samples), round(sum_b / samples)] if samples else [0, 0, 0]
    sidebar_lit = light_left >= rule.sidebar_samples or light_top >= rule.sidebar_samples
    if light < rule.logo_samples:
        label = "empty"
    elif not sidebar_lit and light_center >= rule.logo_samples:
        label = "splash"
    elif light_center >= rule.fade_center and sidebar_lit:
        label = "transition"
    elif sidebar_lit:
        label = "app"
    else:
        label = "other"
    return {
        "label": label,
        "light": light,
        "light_left": light_left,
        "light_center": light_center,
        "light_top": light_top,
        "mean_rgb": mean,
        "samples": samples,
    }


def self_test() -> None:
    w, h = 320, 200
    stride = 4

    def paint(fill, marks):
        buf = bytearray(fill * (w * h))
        for x, y, color in marks:
            i = (y * w + x) * 3
            buf[i : i + 3] = bytes(color)
        return bytes(buf)

    dark = (0x0A, 0x0A, 0x0A)
    white = (0xFA, 0xFA, 0xFA)
    empty = classify_frame(paint(dark, []), w, h, stride)
    assert empty["label"] == "empty", empty
    assert empty["mean_rgb"] == [0x0A, 0x0A, 0x0A], empty

    black = classify_frame(paint((0, 0, 0), []), w, h, stride)
    assert black["label"] == "empty", black
    assert black["mean_rgb"] == [0, 0, 0], black

    marks = []
    for y in range(80, 120, 4):
        for x in range(140, 180, 4):
            marks.append((x, y, white))
    splash = classify_frame(paint(dark, marks), w, h, stride)
    assert splash["label"] == "splash", splash

    left = []
    for y in range(40, 160, 4):
        for x in range(8, 40, 4):
            left.append((x, y, white))
    app = classify_frame(paint(dark, left), w, h, stride)
    assert app["label"] == "app", app

    both = classify_frame(paint(dark, marks + left), w, h, stride)
    assert both["label"] == "transition", both

    tall, wide = 400, 500
    framed = bytearray()
    for y in range(tall):
        color = (200, 200, 200) if y < 20 else dark
        framed.extend(color * wide)
    box = content_box(bytes(framed), wide, tall, stride)
    assert box is not None and box[1] >= 16, box

    absolute = parse_xwininfo_line(
        '0x1e00003 "Handshaker": ("handshaker" "Handshaker")  1280x800+0+0  +1+57'
    )
    assert absolute == {"id": "0x1e00003", "w": 1280, "h": 800, "x": 1, "y": 57}, absolute
    relative_only = parse_xwininfo_line('0x1 "Handshaker": ()  1280x800+320+200')
    assert relative_only is not None and relative_only["x"] == 320 and relative_only["y"] == 200, relative_only
    tiny = parse_xwininfo_line('0x2 "handshaker-hidden": ()  10x10+0+0  +4+4')
    assert tiny is None, tiny
    settled = settled_window(
        [
            {"id": "0x1", "w": 1280, "h": 800, "x": 0, "y": 0},
            {"id": "0x1", "w": 1280, "h": 800, "x": 1, "y": 57},
            {"id": "0x1", "w": 1280, "h": 800, "x": 1, "y": 57},
        ]
    )
    assert settled == {"id": "0x1", "w": 1280, "h": 800, "x": 1, "y": 57}, settled
    print("self-test ok")


def percentile_summary(values: list[float]) -> dict:
    ordered = sorted(values)
    return {
        "n": len(ordered),
        "min": ordered[0],
        "median": statistics.median(ordered),
        "max": ordered[-1],
    }


def tee_ffmpeg_log(stream, log_path: Path, ready: threading.Event) -> None:
    with log_path.open("wb") as log:
        while True:
            line = stream.readline()
            if not line:
                break
            log.write(line)
            log.flush()
            if GRABBER_READY in line:
                ready.set()


def wait_for_grabber(ff: subprocess.Popen, ready: threading.Event) -> None:
    deadline = time.time() + 5
    while time.time() < deadline:
        if ready.is_set():
            return
        if ff.poll() is not None:
            break
        time.sleep(0.02)
    ff.kill()
    if ff.poll() is not None:
        fail("ffmpeg exited before x11grab was recording")
    fail("ffmpeg did not report that x11grab is recording")


def run_once(binary: Path, run_dir: Path, fps: int, after_window_s: float, screen: tuple[int, int]) -> dict:
    for name in ("xdg", "config", "cache", "logs"):
        (run_dir / name).mkdir(parents=True)
    video = run_dir / "capture.mkv"
    sw, sh = screen
    ffmpeg_log = run_dir / "logs" / "ffmpeg.log"
    app_log = run_dir / "logs" / "app.log"
    ff = subprocess.Popen(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "info",
            "-f",
            "x11grab",
            "-draw_mouse",
            "0",
            "-framerate",
            str(fps),
            "-video_size",
            f"{sw}x{sh}",
            "-i",
            os.environ.get("DISPLAY", ":1"),
            "-c:v",
            "libx264rgb",
            "-preset",
            "ultrafast",
            "-qp",
            "0",
            str(video),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    assert ff.stderr is not None
    grabber_ready = threading.Event()
    log_thread = threading.Thread(
        target=tee_ffmpeg_log, args=(ff.stderr, ffmpeg_log, grabber_ready), daemon=True
    )
    log_thread.start()
    if find_window() is not None:
        ff.kill()
        fail("a Handshaker window is already mapped; refuse to measure a stale window")
    t_ffmpeg = time.time()
    wait_for_grabber(ff, grabber_ready)
    marker = ClockMarker(screen)
    t_marker = marker.show()
    env = os.environ.copy()
    env["GDK_BACKEND"] = "x11"
    env["XDG_DATA_HOME"] = str(run_dir / "xdg")
    env["XDG_CONFIG_HOME"] = str(run_dir / "config")
    env["XDG_CACHE_HOME"] = str(run_dir / "cache")
    app_out = app_log.open("w")
    app = subprocess.Popen(
        [str(binary)],
        env=env,
        stdout=app_out,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    try:
        start_wall = process_start_wall(app.pid)
    except OSError:
        start_wall = time.time()
    window = None
    window_poll_wall = None
    deadline = time.time() + 20
    while time.time() < deadline:
        if app.poll() is not None:
            break
        found = find_window()
        if found:
            window = found
            window_poll_wall = time.time()
            break
        time.sleep(0.01)
    try:
        if window is None:
            return {"error": "window did not appear", "app_exit": app.poll(), "log": app_log.read_text()[-2000:]}
        samples = [{"t_ms": round((window_poll_wall - start_wall) * 1000, 1), **window}]
        deadline_geo = time.time() + after_window_s
        next_sample = 0.0
        while time.time() < deadline_geo:
            now = time.time()
            if now >= next_sample:
                found = find_window()
                if found:
                    samples.append({"t_ms": round((now - start_wall) * 1000, 1), **found})
                next_sample = now + 0.05
            time.sleep(0.01)
        (run_dir / "window.json").write_text(
            json.dumps(
                {
                    "window": window,
                    "t_ffmpeg": t_ffmpeg,
                    "t_marker": t_marker,
                    "start_wall": start_wall,
                    "geometry": samples,
                },
                indent=2,
            )
            + "\n"
        )
    finally:
        stop_app(app)
        ff.send_signal(signal.SIGINT)
        try:
            ff.wait(timeout=15)
        except subprocess.TimeoutExpired:
            ff.kill()
            ff.wait(timeout=5)
        app_out.close()
        marker.close()
        log_thread.join(timeout=2)
    if window is None:
        return {"error": "window did not appear", "app_exit": app.poll(), "log": app_log.read_text()[-2000:]}
    frames = analyze(
        video, settled_window(samples) or window, start_wall, t_ffmpeg, t_marker, marker, fps, run_dir, screen
    )
    frames["window_poll_ms"] = round((window_poll_wall - start_wall) * 1000, 1) if window_poll_wall else None
    frames["window"] = window
    frames["pid"] = app.pid
    return frames


def stop_app(app: subprocess.Popen) -> None:
    if app.poll() is not None:
        return
    try:
        os.killpg(app.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.time() + 3
    while time.time() < deadline and app.poll() is None:
        time.sleep(0.05)
    if app.poll() is None:
        try:
            os.killpg(app.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        app.wait(timeout=3)


def is_marker_magenta(r: int, g: int, b: int) -> bool:
    return r > 200 and g < 40 and b > 200


def marker_frame_index(video: Path, marker: ClockMarker) -> int | None:
    decode = subprocess.Popen(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(video),
            "-vf",
            f"crop={marker.size}:{marker.size}:{marker.x}:{marker.y}",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    assert decode.stdout is not None
    nbytes = marker.size * marker.size * 3
    index = 0
    found = None
    while True:
        buf = decode.stdout.read(nbytes)
        if len(buf) < nbytes:
            break
        for i in range(0, nbytes, 3):
            if is_marker_magenta(buf[i], buf[i + 1], buf[i + 2]):
                found = index
                break
        if found is not None:
            break
        index += 1
    decode.kill()
    decode.wait()
    return found


def clamp_window_to_screen(window: dict, screen: tuple[int, int]) -> tuple[int, int, int, int] | None:
    w, h, x, y = window["w"], window["h"], window["x"], window["y"]
    sw, sh = screen
    if x < 0:
        w += x
        x = 0
    if y < 0:
        h += y
        y = 0
    if x + w > sw:
        w = sw - x
    if y + h > sh:
        h = sh - y
    if w < 64 or h < 64:
        return None
    return w, h, x, y


def analyze(
    video: Path,
    window: dict,
    start_wall: float,
    t_ffmpeg: float,
    t_marker: float,
    marker: ClockMarker,
    fps: int,
    run_dir: Path,
    screen: tuple[int, int],
) -> dict:
    probe = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "frame=best_effort_timestamp_time",
            "-of",
            "csv=p=0",
            str(video),
        ],
        text=True,
    )
    pts = []
    for line in probe.splitlines():
        line = line.strip().rstrip(",")
        if not line or line == "N/A":
            pts.append(None)
        else:
            pts.append(float(line))
    crop = clamp_window_to_screen(window, screen)
    if crop is None:
        return {"error": f"window crop is degenerate: {window}"}
    w, h, x, y = crop
    decode = subprocess.Popen(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(video),
            "-vf",
            f"crop={w}:{h}:{x}:{y}",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    assert decode.stdout is not None
    frame_bytes = w * h * 3
    rows = []
    index = 0
    saved = {"empty": False, "splash": False, "transition": False, "app": False, "first_paint": False}
    while True:
        buf = decode.stdout.read(frame_bytes)
        if len(buf) < frame_bytes:
            break
        box = content_box(buf, w, h)
        if box is None:
            info = {
                "label": "desktop",
                "light": 0,
                "light_left": 0,
                "light_center": 0,
                "light_top": 0,
                "mean_rgb": [0, 0, 0],
                "samples": 0,
            }
            png_buf, png_w, png_h = None, 0, 0
        else:
            bx, by, bw, bh = box
            info = classify_frame(buf, bw, bh, src_w=w, ox=bx, oy=by)
            png_buf, png_w, png_h = crop_rgb(buf, w, bx, by, bw, bh), bw, bh
        pts_s = pts[index] if index < len(pts) else None
        row = {"i": index, "pts": pts_s, **info}
        rows.append(row)
        label = info["label"]
        if png_buf is not None and label in saved and not saved[label]:
            write_png(png_buf, png_w, png_h, run_dir / f"frame-{label}.png")
            saved[label] = True
        if png_buf is not None and label not in ("empty", "invalid", "desktop") and not saved["first_paint"]:
            write_png(png_buf, png_w, png_h, run_dir / "frame-first-paint.png")
            saved["first_paint"] = True
        index += 1
    decode.wait()
    midx = marker_frame_index(video, marker)
    if midx is None or midx >= len(pts) or pts[midx] is None:
        offset = 0.0
        clock_ok = False
    else:
        offset = t_marker - (t_ffmpeg + pts[midx])
        clock_ok = True
    for row in rows:
        if row["pts"] is None:
            row["t_ms"] = None
        else:
            row["t_ms"] = round((t_ffmpeg + row["pts"] + offset - start_wall) * 1000, 1)
    (run_dir / "frames.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    summary = summarize(rows, start_wall, fps, len(pts))
    summary["clock_ok"] = clock_ok
    summary["clock_offset_ms"] = round(offset * 1000, 1)
    summary["marker_frame"] = midx
    return summary


def crop_rgb(buf: bytes, src_w: int, x: int, y: int, w: int, h: int) -> bytes:
    out = bytearray(w * h * 3)
    row_bytes = w * 3
    for row in range(h):
        src = ((y + row) * src_w + x) * 3
        dst = row * row_bytes
        out[dst : dst + row_bytes] = buf[src : src + row_bytes]
    return bytes(out)


def write_png(buf: bytes, w: int, h: int, dest: Path) -> None:
    proc = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-s",
            f"{w}x{h}",
            "-i",
            "-",
            str(dest),
        ],
        input=buf,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if proc.returncode != 0:
        dest.write_bytes(b"")


def first_where(rows: list[dict], pred) -> dict | None:
    for row in rows:
        if pred(row):
            return row
    return None


def summarize(rows: list[dict], start_wall: float, fps: int, probed: int) -> dict:
    timed = [r for r in rows if r["t_ms"] is not None]
    timed = [r for r in timed if r["t_ms"] >= -PREROLL_SLACK_MS]
    labels = {}
    for row in timed:
        labels[row["label"]] = labels.get(row["label"], 0) + 1
    content_labels = ("empty", "splash", "app", "transition", "other")
    window_row = first_where(timed, lambda r: r["t_ms"] >= 0 and r["label"] in content_labels)
    paint = first_where(timed, lambda r: r["t_ms"] >= 0 and r["label"] in ("splash", "app", "transition", "other"))
    splash = first_where(timed, lambda r: r["label"] in ("splash", "transition"))
    app = first_app(timed)
    empty_rows = [r for r in timed if r["label"] == "empty" and (window_row is None or r["t_ms"] >= window_row["t_ms"])]
    empty_mean = empty_rows[0]["mean_rgb"] if empty_rows else None
    def ms(row: dict | None) -> float | None:
        return None if row is None else row["t_ms"]

    window_ms = ms(window_row)
    paint_ms = ms(paint)
    splash_ms = ms(splash)
    app_ms = ms(app)
    black_ms = None
    if window_ms is not None and paint_ms is not None:
        black_ms = round(paint_ms - window_ms, 1)
    splash_hold_ms = None
    if splash_ms is not None and app_ms is not None:
        splash_hold_ms = round(app_ms - splash_ms, 1)
    return {
        "process_start_unix": start_wall,
        "frames": len(rows),
        "probed_frames": probed,
        "fps": fps,
        "labels": labels,
        "empty_mean_rgb": empty_mean,
        "window_created_ms": window_ms,
        "first_paint_ms": paint_ms,
        "splash_shown_ms": splash_ms,
        "app_ready_ms": app_ms,
        "black_ms": black_ms,
        "splash_hold_ms": splash_hold_ms,
        "clock": "magenta marker frame pins x11grab pts to unix time; process start from /proc starttime",
    }


def first_app(rows: list[dict]) -> dict | None:
    for i, row in enumerate(rows):
        if row["label"] != "app":
            continue
        if i + 1 >= len(rows):
            return row
        if rows[i + 1]["label"] in ("app", "transition"):
            return row
    return None


def aggregate(runs: list[dict]) -> dict:
    keys = [
        "window_created_ms",
        "first_paint_ms",
        "splash_shown_ms",
        "app_ready_ms",
        "black_ms",
        "splash_hold_ms",
        "window_poll_ms",
    ]
    out = {}
    for key in keys:
        vals = [r[key] for r in runs if r.get(key) is not None and "error" not in r]
        out[key] = percentile_summary(vals) if vals else None
    errors = [r.get("error") for r in runs if r.get("error")]
    return {"errors": errors, "phases_ms": out}


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure Handshaker cold start from a screen recording")
    parser.add_argument("--binary", type=Path, default=Path("target/release/handshaker"))
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--fps", type=int, default=60)
    parser.add_argument("--after-window", type=float, default=8.0)
    parser.add_argument("--out", type=Path, required=False)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    binary = args.binary.resolve()
    if not binary.is_file():
        fail(f"binary not found: {binary}")
    if not os.access(binary, os.X_OK):
        fail(f"binary is not executable: {binary}")
    if not os.environ.get("DISPLAY"):
        fail("DISPLAY is unset")
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    out = args.out or Path("/tmp/handshaker-cold-start") / stamp
    out.mkdir(parents=True, exist_ok=True)
    screen = screen_size()
    meta = {
        "binary": str(binary),
        "fps": args.fps,
        "runs": args.runs,
        "screen": list(screen),
        "nproc": os.cpu_count(),
        "loadavg_before": loadavg(),
        "uname": os.uname().machine + " " + os.uname().release,
    }
    results = []
    for i in range(args.runs):
        print(f"run {i + 1}/{args.runs} load={loadavg()}", flush=True)
        run_dir = out / f"run-{i + 1}"
        run_dir.mkdir()
        result = run_once(binary, run_dir, args.fps, args.after_window, screen)
        result["run"] = i + 1
        results.append(result)
        brief = {k: result.get(k) for k in ("window_created_ms", "first_paint_ms", "splash_shown_ms", "app_ready_ms", "black_ms", "splash_hold_ms", "empty_mean_rgb", "error", "labels")}
        print(json.dumps(brief), flush=True)
    summary = {"meta": meta, "loadavg_after": loadavg(), "aggregate": aggregate(results), "runs": results}
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(f"summary: {out / 'summary.json'}")
    print(json.dumps(summary["aggregate"], indent=2))


if __name__ == "__main__":
    main()
