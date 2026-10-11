use objc2::runtime::AnyObject;
use objc2::{AllocAnyThread, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSColor, NSFont, NSFontWeightSemibold, NSImage, NSImageScaling,
    NSImageView, NSTextAlignment, NSTextField, NSView, NSWindowOrderingMode,
};
use objc2_foundation::{ns_string, NSData, NSNumber, NSObjectNSKeyValueCoding, NSRect, NSString};
use objc2_web_kit::WKWebView;
use tauri::WebviewWindow;

use crate::splash_metrics::{splash_word, MARK_PNG, MARK_PX, WORD};

pub fn install(window: &WebviewWindow) {
    let Some(word) = splash_word() else {
        eprintln!("boot logo: #splash .splash-word has no margin or font size");
        return;
    };
    let fallback = window.inner_size().ok().and_then(|px| {
        let scale = window.scale_factor().ok()?;
        if scale <= 0.0 {
            return None;
        }
        Some((px.width as f64 / scale, px.height as f64 / scale))
    });
    match window.ns_view() {
        Ok(view) if !view.is_null() => unsafe {
            place_mark(view, word.gap_px, word.size_px, fallback);
        },
        Ok(_) => eprintln!("boot logo: content view is null"),
        Err(err) => eprintln!("boot logo: content view unavailable: {err}"),
    }
    let _ = window.with_webview(|webview| unsafe {
        punch_webview(webview.inner());
    });
}

unsafe fn place_mark(
    view: *mut std::ffi::c_void,
    gap: f64,
    word_px: f64,
    fallback: Option<(f64, f64)>,
) {
    let Some(mtm) = MainThreadMarker::new() else {
        eprintln!("boot logo: window setup left the main thread");
        return;
    };
    let content: &NSView = &*view.cast();
    let mut bounds = content.bounds();
    if bounds.size.width < 1.0 || bounds.size.height < 1.0 {
        if let Some((width, height)) = fallback {
            bounds.size.width = width;
            bounds.size.height = height;
        }
    }
    let mark = MARK_PX as f64;
    let block = mark + gap + word_px;
    let top = bounds.origin.y + ((bounds.size.height - block) / 2.0).max(0.0);
    let mark_x = bounds.origin.x + ((bounds.size.width - mark) / 2.0).max(0.0);
    let (mark_y, text_y) = if content.isFlipped() {
        (top, top + mark + gap)
    } else {
        (top + gap + word_px, top)
    };
    let mark_frame = NSRect::new(
        objc2_foundation::NSPoint::new(mark_x, mark_y),
        objc2_foundation::NSSize::new(mark, mark),
    );
    let text_frame = NSRect::new(
        objc2_foundation::NSPoint::new(bounds.origin.x, text_y),
        objc2_foundation::NSSize::new(bounds.size.width, word_px + 4.0),
    );

    let data = NSData::dataWithBytes_length(MARK_PNG.as_ptr().cast(), MARK_PNG.len());
    let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) else {
        eprintln!("boot logo: PNG loader produced no image");
        return;
    };
    image.setSize(objc2_foundation::NSSize::new(mark, mark));

    let image_view = NSImageView::initWithFrame(NSImageView::alloc(mtm), mark_frame);
    image_view.setImage(Some(&image));
    image_view.setImageScaling(NSImageScaling::ScaleAxesIndependently);
    image_view.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewMinXMargin
            | NSAutoresizingMaskOptions::ViewMaxXMargin
            | NSAutoresizingMaskOptions::ViewMinYMargin
            | NSAutoresizingMaskOptions::ViewMaxYMargin,
    );

    let label = NSTextField::labelWithString(&NSString::from_str(WORD), mtm);
    label.setFrame(text_frame);
    label.setFont(Some(&NSFont::systemFontOfSize_weight(
        word_px,
        NSFontWeightSemibold,
    )));
    label.setTextColor(Some(&NSColor::colorWithSRGBRed_green_blue_alpha(
        0xFA as f64 / 255.0,
        0xFA as f64 / 255.0,
        0xFA as f64 / 255.0,
        1.0,
    )));
    label.setAlignment(NSTextAlignment::Center);
    label.setDrawsBackground(false);
    label.setBordered(false);
    label.setBezeled(false);
    label.setEditable(false);
    label.setSelectable(false);
    label.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable
            | NSAutoresizingMaskOptions::ViewMinYMargin
            | NSAutoresizingMaskOptions::ViewMaxYMargin,
    );

    // Below every current subview, including the webview. Later siblings stack above.
    content.addSubview_positioned_relativeTo(&image_view, NSWindowOrderingMode::Below, None);
    content.addSubview_positioned_relativeTo(&label, NSWindowOrderingMode::Below, None);
    content.setNeedsDisplay(true);
}

/// `drawsBackground` is the same private KVC wry uses for a transparent webview.
/// The public background color stays opaque until this is set, so the native mark
/// behind the view would never show.
unsafe fn punch_webview(webview: *mut std::ffi::c_void) {
    if webview.is_null() {
        eprintln!("boot logo: WKWebView is null");
        return;
    }
    let wk: &WKWebView = &*webview.cast();
    let no = NSNumber::numberWithBool(false);
    let value: &AnyObject = &no;
    wk.setValue_forKey(Some(value), ns_string!("drawsBackground"));
    let clear = NSColor::colorWithSRGBRed_green_blue_alpha(0.0, 0.0, 0.0, 0.0);
    wk.setUnderPageBackgroundColor(Some(&clear));
}
