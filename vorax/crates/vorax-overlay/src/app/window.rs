//! Native marks owned by the common Electron host; no tray, menus or hotkeys.
use super::sys::{client_rect,find_game_window,foreground,Hwnd};
use crate::draw::{render,Fonts,Plan};
use std::cell::RefCell;
use std::sync::mpsc::Receiver;
use windows::core::w;
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::*;
pub enum ToUi { Show(Plan,usize,usize), Busy, Unbusy, Clear, Shown(bool), Quit }
struct State { hwnd:HWND, fonts:Fonts, rx:Receiver<ToUi>, plan:Option<Plan>, busy:bool, frame:(usize,usize), shown:bool, accent:usize, placed:Option<(i32,i32,i32,i32)>, visible:bool }
thread_local! { static STATE:RefCell<Option<State>>=const {RefCell::new(None)}; }
#[derive(Clone,Copy)] pub struct Waker(Hwnd);
unsafe impl Send for Waker {}
impl Waker { pub fn wake(&self) { unsafe {let _=PostMessageW(self.0.get(),WM_APP+1,WPARAM(0),LPARAM(0));} } }
fn with_state(f:impl FnOnce(&mut State)) { STATE.with(|s| {if let Some(s)=s.borrow_mut().as_mut(){f(s)}}); }
pub fn create(fonts:Fonts,rx:Receiver<ToUi>,accent:usize)->windows::core::Result<Waker> { unsafe {
 let instance:HINSTANCE=GetModuleHandleW(None)?.into();
 let class=w!("TorchlightVoraxMarks");
 RegisterClassW(&WNDCLASSW{lpfnWndProc:Some(wndproc),hInstance:instance.into(),lpszClassName:class,..Default::default()});
 let hwnd=CreateWindowExW(WS_EX_LAYERED|WS_EX_TRANSPARENT|WS_EX_TOPMOST|WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE,class,w!("Torchlight Overlay - Vorax marks"),WS_POPUP,0,0,1,1,None,None,instance,None)?;
 // Keep the advice out of captures; the application has one shared setting.
 let affinity=if std::env::var("VORAX_CAPTURE_VISIBLE").ok().as_deref()==Some("1"){WDA_NONE}else{WDA_EXCLUDEFROMCAPTURE};
 let _=SetWindowDisplayAffinity(hwnd,affinity);
 STATE.with(|s|*s.borrow_mut()=Some(State{hwnd,fonts,rx,plan:None,busy:false,frame:(0,0),shown:true,accent,placed:None,visible:false}));
 SetTimer(hwnd,1,250,None); Ok(Waker(Hwnd::of(hwnd)))
} }
pub fn run_loop(){unsafe {let mut m=MSG::default();while GetMessageW(&mut m,None,0,0).as_bool(){let _=TranslateMessage(&m);DispatchMessageW(&m);}}}
unsafe extern "system" fn wndproc(hwnd:HWND,msg:u32,wp:WPARAM,lp:LPARAM)->LRESULT {
 if msg==WM_APP+1 {with_state(|s| {while let Ok(m)=s.rx.try_recv(){match m {
  ToUi::Show(p,w,h)=>{s.plan=Some(p);s.frame=(w,h);s.busy=false},ToUi::Busy=>s.busy=true,ToUi::Unbusy=>s.busy=false,
  ToUi::Clear=>{s.plan=None;s.busy=false},ToUi::Shown(on)=>s.shown=on,ToUi::Quit=>{let _=DestroyWindow(s.hwnd);return}
 }}s.placed=None;follow(s)});return LRESULT(0)}
 match msg {WM_TIMER=>{with_state(follow);LRESULT(0)},WM_DESTROY=>{PostQuitMessage(0);LRESULT(0)},_=>DefWindowProcW(hwnd,msg,wp,lp)}
}
fn follow(s: &mut State) {
    let game = find_game_window();
    let front = game.is_some_and(|g| foreground() == g);
    let rect = game.and_then(client_rect);
    let want = s.shown && front && s.plan.is_some() && rect.is_some();
    unsafe {
        if !want {
            if s.visible {
                let _ = ShowWindow(s.hwnd, SW_HIDE);
                s.visible = false;
            }
            return;
        }
        let r = rect.unwrap();
        if s.placed != Some(r) {
            draw(s, r);
            s.placed = Some(r);
        }
        if !s.visible {
            let _ = ShowWindow(s.hwnd, SW_SHOWNOACTIVATE);
            s.visible = true;
        }
        let _ = SetWindowPos(s.hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
}

/// Lays the marks out on the game's picture as it is now (scaled from the picture they were read on) and puts
/// them on screen.
fn draw(s: &State, (x, y, w, h): (i32, i32, i32, i32)) {
    let Some(plan) = &s.plan else { return };
    let (fw, fh) = s.frame;
    let (sx, sy) = if fw > 0 && fh > 0 { (w as f64 / fw as f64, h as f64 / fh as f64) } else { (1.0, 1.0) };
    let mut p = if s.busy { plan.dimmed() } else { plan.clone() };
    if let Some((c, cw, ch)) = &mut p.card {
        c.cx *= sx;
        c.cy *= sy;
        *cw *= sx;
        *ch *= sy;
    }
    if let Some(b) = &mut p.button {
        b.x *= sx;
        b.y *= sy;
        b.w *= sx;
        b.h *= sy;
    }
    for t in p.tanks.iter_mut() {
        t.x *= sx;
        t.y *= sy;
        t.w *= sx;
        t.h *= sy;
    }
    let pm = render(&p, w as u32, h as u32, &s.fonts, crate::draw::accent(s.accent));
    unsafe { put(s.hwnd, x, y, w, h, pm.data()) };
}

pub unsafe fn put(hwnd: HWND, x: i32, y: i32, w: i32, h: i32, rgba: &[u8]) {
    let screen = GetDC(HWND::default());
    let mem = CreateCompatibleDC(screen);
    let bi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: w, biHeight: -h, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default() },
        ..Default::default()
    };
    let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
    if let Ok(bmp) = CreateDIBSection(mem, &bi, DIB_RGB_COLORS, &mut bits, None, 0) {
        let dst = std::slice::from_raw_parts_mut(bits as *mut u8, (w * h * 4) as usize);
        for (d, s) in dst.chunks_exact_mut(4).zip(rgba.chunks_exact(4)) {
            d[0] = s[2];
            d[1] = s[1];
            d[2] = s[0];
            d[3] = s[3];
        }
        let old = SelectObject(mem, bmp);
        let blend = BLENDFUNCTION { BlendOp: AC_SRC_OVER as u8, BlendFlags: 0, SourceConstantAlpha: 255, AlphaFormat: AC_SRC_ALPHA as u8 };
        let (pt, size, src) = (POINT { x, y }, SIZE { cx: w, cy: h }, POINT { x: 0, y: 0 });
        let _ = UpdateLayeredWindow(hwnd, screen, Some(&pt), Some(&size), mem, Some(&src), COLORREF(0), Some(&blend), ULW_ALPHA);
        SelectObject(mem, old);
        let _ = DeleteObject(bmp);
    }
    let _ = DeleteDC(mem);
    ReleaseDC(HWND::default(), screen);
}

