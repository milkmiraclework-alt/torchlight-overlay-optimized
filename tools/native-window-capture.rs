// Window-client capture only. No desktop DC, hooks, game input or disk writes.
use core::ffi::c_void;
type Handle = *mut c_void;
#[repr(C)]
#[derive(Default)]
struct Rect { left: i32, top: i32, right: i32, bottom: i32 }
#[repr(C)]
struct BitmapInfo { size: u32, width: i32, height: i32, planes: u16, bits: u16,
    compression: u32, image_size: u32, x: i32, y: i32, used: u32, important: u32, colors: u32 }
#[link(name = "user32")]
extern "system" {
    fn IsWindow(window: Handle) -> i32;
    fn IsIconic(window: Handle) -> i32;
    fn IsWindowVisible(window: Handle) -> i32;
    fn GetClientRect(window: Handle, rect: *mut Rect) -> i32;
    fn GetDC(window: Handle) -> Handle;
    fn ReleaseDC(window: Handle, dc: Handle) -> i32;
    fn SetThreadDpiAwarenessContext(context: isize) -> isize;
}
#[link(name = "gdi32")]
extern "system" {
    fn CreateCompatibleDC(dc: Handle) -> Handle;
    fn CreateDIBSection(dc: Handle, info: *const BitmapInfo, usage: u32, bits: *mut *mut u8, section: Handle, offset: u32) -> Handle;
    fn SelectObject(dc: Handle, object: Handle) -> Handle;
    fn DeleteObject(object: Handle) -> i32;
    fn DeleteDC(dc: Handle) -> i32;
    fn BitBlt(dst: Handle, x: i32, y: i32, width: i32, height: i32, src: Handle, sx: i32, sy: i32, rop: u32) -> i32;
    fn GdiFlush() -> i32;
}
pub struct Capture { window: Handle, dc: Handle, bitmap: Handle, previous: Handle, pixels: *mut u8, width: i32, height: i32 }
impl Drop for Capture {
    fn drop(&mut self) { unsafe {
        if !self.previous.is_null() { SelectObject(self.dc, self.previous); }
        if !self.bitmap.is_null() { DeleteObject(self.bitmap); }
        if !self.dc.is_null() { DeleteDC(self.dc); }
    } }
}
unsafe fn dimensions(window: Handle) -> Option<(i32, i32)> {
    if window.is_null() || IsWindow(window) == 0 || IsIconic(window) != 0 || IsWindowVisible(window) == 0 { return None; }
    let mut r = Rect::default();
    if GetClientRect(window, &mut r) == 0 { return None; }
    let (w, h) = (r.right - r.left, r.bottom - r.top);
    // Larger screens use the established Chromium downscaler instead of
    // changing interpolation/recognition in this path.
    if !(64..=2600).contains(&w) || !(64..=2600).contains(&h) { return None; }
    Some((w, h))
}
#[no_mangle]
pub unsafe extern "C" fn capture_create(window: Handle) -> *mut Capture {
    SetThreadDpiAwarenessContext(-4);
    if dimensions(window).is_none() { return core::ptr::null_mut(); }
    window.cast()
}
#[no_mangle]
pub unsafe extern "C" fn capture_size(c: *mut Capture, out: *mut i32) -> i32 {
    let Some((w, h)) = dimensions(c.cast()) else { return 0 };
    *out = w; *out.add(1) = h; 1
}
#[no_mangle]
pub unsafe extern "C" fn capture_grab(c: *mut Capture, output: *mut u8, capacity: usize) -> usize {
    // All GDI objects live within this call. Terminating an idle Node worker
    // cannot leak a persistent bitmap/DC or a Rust heap allocation.
    let mut local = Capture { window: c.cast(), dc: core::ptr::null_mut(), bitmap: core::ptr::null_mut(),
        previous: core::ptr::null_mut(), pixels: core::ptr::null_mut(), width: 0, height: 0 };
    let c = &mut local;
    let Some((w, h)) = dimensions(c.window) else { return 0 };
    let n = w as usize * h as usize * 4;
    if capacity < n || output.is_null() { return 0; }
    let source = GetDC(c.window);
    if source.is_null() { return 0; }
    if c.width != w || c.height != h {
        if !c.previous.is_null() { SelectObject(c.dc, c.previous); }
        if !c.bitmap.is_null() { DeleteObject(c.bitmap); }
        if !c.dc.is_null() { DeleteDC(c.dc); }
        c.dc = CreateCompatibleDC(source); c.bitmap = core::ptr::null_mut(); c.previous = core::ptr::null_mut();
        let info = BitmapInfo { size: 40, width: w, height: -h, planes: 1, bits: 32,
            compression: 0, image_size: 0, x: 0, y: 0, used: 0, important: 0, colors: 0 };
        if !c.dc.is_null() { c.bitmap = CreateDIBSection(source, &info, 0, &mut c.pixels, core::ptr::null_mut(), 0); }
        if c.bitmap.is_null() { ReleaseDC(c.window, source); c.width = 0; return 0; }
        c.previous = SelectObject(c.dc, c.bitmap); c.width = w; c.height = h;
    }
    let copied = BitBlt(c.dc, 0, 0, w, h, source, 0, 0, 0x00cc0020);
    GdiFlush(); ReleaseDC(c.window, source);
    if copied == 0 { return 0; }
    for i in (0..n).step_by(4) {
        *output.add(i) = *c.pixels.add(i+2); *output.add(i+1) = *c.pixels.add(i+1);
        *output.add(i+2) = *c.pixels.add(i); *output.add(i+3) = 255;
    }
    n
}
#[no_mangle]
pub unsafe extern "C" fn capture_destroy(_c: *mut Capture) {}
