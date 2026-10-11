use std::sync::OnceLock;

use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Controller, ICoreWebView2Controller2, COREWEBVIEW2_COLOR,
};
use windows::core::Interface;
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateFontW, CreateSolidBrush, DeleteObject, DrawTextW, FillRect, InvalidateRect, SelectObject,
    SetBkMode, SetTextColor, StretchDIBits, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    CLEARTYPE_QUALITY, CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DIB_RGB_COLORS, DT_CENTER,
    DT_SINGLELINE, DT_TOP, FW_SEMIBOLD, HDC, OUT_DEFAULT_PRECIS, SRCCOPY, TRANSPARENT,
};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass, SUBCLASSPROC};
use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, WM_ERASEBKGND, WM_SIZE};

use crate::splash_metrics::{splash_word, MARK_PNG, MARK_PX, WORD};

struct Mark {
    px: i32,
    bgra: Vec<u8>,
}

pub fn install(window: &WebviewWindow) {
    if splash_word().is_none() {
        eprintln!("boot logo: #splash .splash-word has no margin or font size");
        return;
    }
    match window.hwnd() {
        Ok(hwnd) if !hwnd.0.is_null() => unsafe { subclass(hwnd) },
        Ok(_) => eprintln!("boot logo: hwnd is null"),
        Err(err) => eprintln!("boot logo: hwnd unavailable: {err}"),
    }
    let _ = window.with_webview(|webview| unsafe {
        punch_and_paint(webview.controller());
    });
}

unsafe fn punch_and_paint(controller: ICoreWebView2Controller) {
    // Alpha 0 stays a hole. Any other alpha is forced to 255 by WebView2, which
    // would paint the flat background over the parent logo.
    if let Ok(controller2) = controller.cast::<ICoreWebView2Controller2>() {
        let _ = controller2.SetDefaultBackgroundColor(COREWEBVIEW2_COLOR {
            R: 0,
            G: 0,
            B: 0,
            A: 0,
        });
    }
    let mut parent = HWND::default();
    if controller.ParentWindow(&mut parent).is_err() || parent.0.is_null() {
        eprintln!("boot logo: webview has no parent window");
        return;
    }
    subclass(parent);
}

unsafe fn subclass(hwnd: HWND) {
    let proc: SUBCLASSPROC = Some(paint_proc);
    let _ = SetWindowSubclass(hwnd, proc, 1, 0);
    let _ = InvalidateRect(Some(hwnd), None, true);
}

fn mark() -> Option<&'static Mark> {
    static MARK: OnceLock<Option<Mark>> = OnceLock::new();
    MARK.get_or_init(|| {
        let img = image::load_from_memory(MARK_PNG).ok()?.into_rgba8();
        let (w, h) = (img.width(), img.height());
        if w == 0 || w != h {
            return None;
        }
        let mut bgra = Vec::with_capacity((w * h * 4) as usize);
        for px in img.pixels() {
            let src = px.0;
            let a = src[3] as f32 / 255.0;
            let r = src[0] as f32 * a + 0x0A as f32 * (1.0 - a);
            let g = src[1] as f32 * a + 0x0A as f32 * (1.0 - a);
            let b = src[2] as f32 * a + 0x0A as f32 * (1.0 - a);
            bgra.extend_from_slice(&[b as u8, g as u8, r as u8, 255]);
        }
        Some(Mark { px: w as i32, bgra })
    })
    .as_ref()
}

unsafe extern "system" fn paint_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    if msg == WM_ERASEBKGND && paint(hwnd, HDC(wparam.0 as *mut _)) {
        return LRESULT(1);
    }
    if msg == WM_SIZE {
        let _ = InvalidateRect(Some(hwnd), None, true);
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

unsafe fn paint(hwnd: HWND, hdc: HDC) -> bool {
    let Some(mark) = mark() else {
        return false;
    };
    let Some(word) = splash_word() else {
        return false;
    };
    let mut client = RECT::default();
    if GetClientRect(hwnd, &raw mut client).is_err() {
        return false;
    }
    let width = client.right - client.left;
    let height = client.bottom - client.top;
    let brush = CreateSolidBrush(COLORREF(0x000A_0A0A));
    if brush.is_invalid() {
        return false;
    }
    FillRect(hdc, &raw const client, brush);
    let _ = DeleteObject(brush.into());

    let dpi = GetDpiForWindow(hwnd).max(96) as f64;
    let scale = dpi / 96.0;
    let mark_px = (MARK_PX as f64 * scale).round() as i32;
    let gap = (word.gap_px * scale).round() as i32;
    let word_px = (word.size_px * scale).round().max(1.0) as i32;
    let block = mark_px + gap + word_px;
    let top = ((height - block) / 2).max(0);
    let left = ((width - mark_px) / 2).max(0);

    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: mark.px,
            biHeight: -mark.px,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..BITMAPINFOHEADER::default()
        },
        ..BITMAPINFO::default()
    };
    let _ = StretchDIBits(
        hdc,
        left,
        top,
        mark_px,
        mark_px,
        0,
        0,
        mark.px,
        mark.px,
        Some(mark.bgra.as_ptr().cast()),
        &raw const info,
        DIB_RGB_COLORS,
        SRCCOPY,
    );

    let font = CreateFontW(
        -word_px,
        0,
        0,
        0,
        FW_SEMIBOLD.0 as i32,
        0,
        0,
        0,
        DEFAULT_CHARSET,
        OUT_DEFAULT_PRECIS,
        CLIP_DEFAULT_PRECIS,
        CLEARTYPE_QUALITY,
        0,
        windows::core::w!("Segoe UI"),
    );
    if font.is_invalid() {
        return true;
    }
    let previous = SelectObject(hdc, font.into());
    SetBkMode(hdc, TRANSPARENT);
    let _ = SetTextColor(hdc, COLORREF(0x00FA_FAFA));
    let mut text_rect = RECT {
        left: 0,
        top: top + mark_px + gap,
        right: width,
        bottom: top + mark_px + gap + word_px + 4,
    };
    let mut wide: Vec<u16> = WORD.encode_utf16().collect();
    DrawTextW(
        hdc,
        &mut wide,
        &raw mut text_rect,
        DT_CENTER | DT_TOP | DT_SINGLELINE,
    );
    SelectObject(hdc, previous);
    let _ = DeleteObject(font.into());
    true
}
