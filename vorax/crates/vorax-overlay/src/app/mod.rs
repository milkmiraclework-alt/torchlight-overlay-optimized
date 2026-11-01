mod capture;
pub(crate) mod ocr;
#[path = "host-sys.rs"] mod sys;
mod window;
mod host;
pub use host::run;

// One requested window, one fresh GPU capture, no overlay/log/input loop.
pub fn capture_window(args: &[String]) -> Result<(), String> {
    use std::io::Write;
    let hwnd = crate::arg::<isize>(args, "--capture-window").filter(|h| *h != 0).ok_or("Missing capture window")?;
    unsafe {
        let _ = windows::Win32::UI::HiDpi::SetProcessDpiAwarenessContext(windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        windows::Win32::System::WinRT::RoInitialize(windows::Win32::System::WinRT::RO_INIT_MULTITHREADED).map_err(|e| e.to_string())?;
    }
    if sys::client_rect(sys::Hwnd(hwnd)).is_none() { return Err("Capture window is unavailable or minimized".into()); }
    let capture = capture::Capturer::new().map_err(|e| e.to_string())?;
    let image = capture.grab_fresh(sys::Hwnd(hwnd)).map_err(|e| e.to_string())?.ok_or("No Windows Graphics Capture frame")?;
    if image.width < 64 || image.height < 64 || image.width * image.height > 16_777_216 { return Err("Unsupported capture size".into()); }
    let mut out = std::io::stdout().lock();
    out.write_all(b"TLRG").and_then(|_|out.write_all(&(image.width as u32).to_le_bytes())).and_then(|_|out.write_all(&(image.height as u32).to_le_bytes())).and_then(|_|out.write_all(&image.data)).and_then(|_|out.flush()).map_err(|e|e.to_string())
}
