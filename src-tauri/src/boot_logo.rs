use gtk::gdk;
use gtk::gdk::prelude::GdkContextExt;
use gtk::gdk_pixbuf::{InterpType, PixbufLoader};
use gtk::glib::Propagation;
use gtk::prelude::*;
use tauri::WebviewWindow;
use webkit2gtk::WebViewExt;

use crate::splash_metrics::{splash_word, SplashWord, MARK_PX, WORD};

const MARK_SVG: &str = include_str!("splash-mark.svg");

pub fn install(window: &WebviewWindow) {
    let Ok(gtk_window) = window.gtk_window() else {
        return;
    };
    let Some(mark) = load_mark() else {
        eprintln!("boot logo: SVG loader produced no image");
        return;
    };
    let Some(word) = splash_word() else {
        eprintln!("boot logo: #splash .splash-word has no margin or font size");
        return;
    };
    punch_webview_hole(window);
    gtk_window.set_app_paintable(true);
    gtk_window.connect_draw(move |widget, cr| {
        let w = widget.allocated_width() as f64;
        let h = widget.allocated_height() as f64;
        paint_at(cr, &mark, w, h, &word);
        Propagation::Proceed
    });
    gtk_window.queue_draw();
}

fn punch_webview_hole(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| {
        webview
            .inner()
            .set_background_color(&gdk::RGBA::new(0.0, 0.0, 0.0, 0.0));
    });
}

fn load_mark() -> Option<gtk::gdk_pixbuf::Pixbuf> {
    let loader = PixbufLoader::with_type("svg").ok()?;
    loader.write(MARK_SVG.as_bytes()).ok()?;
    loader.close().ok()?;
    let pix = loader.pixbuf()?;
    if pix.width() == MARK_PX && pix.height() == MARK_PX {
        Some(pix)
    } else {
        pix.scale_simple(MARK_PX, MARK_PX, InterpType::Bilinear)
    }
}

fn paint_at(
    cr: &gtk::cairo::Context,
    mark: &gtk::gdk_pixbuf::Pixbuf,
    w: f64,
    h: f64,
    word: &SplashWord,
) {
    if w < 1.0 || h < 1.0 {
        return;
    }
    cr.set_source_rgb(
        0x0A as f64 / 255.0,
        0x0A as f64 / 255.0,
        0x0A as f64 / 255.0,
    );
    let _ = cr.paint();

    let mark_px = MARK_PX as f64;
    let block = mark_px + word.gap_px + word.size_px;
    let top = ((h - block) / 2.0).max(0.0);
    let left = ((w - mark_px) / 2.0).max(0.0);
    cr.save().ok();
    cr.translate(left, top);
    cr.set_source_pixbuf(mark, 0.0, 0.0);
    cr.rectangle(0.0, 0.0, mark_px, mark_px);
    let _ = cr.fill();
    cr.restore().ok();

    cr.set_source_rgb(
        0xFA as f64 / 255.0,
        0xFA as f64 / 255.0,
        0xFA as f64 / 255.0,
    );
    cr.select_font_face(
        "sans",
        gtk::cairo::FontSlant::Normal,
        gtk::cairo::FontWeight::Bold,
    );
    cr.set_font_size(word.size_px);
    let Ok(ext) = cr.text_extents(WORD) else {
        return;
    };
    cr.move_to(
        (w - ext.width()) / 2.0 - ext.x_bearing(),
        top + mark_px + word.gap_px - ext.y_bearing(),
    );
    let _ = cr.show_text(WORD);
}
