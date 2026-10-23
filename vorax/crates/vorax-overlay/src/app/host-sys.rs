use std::path::PathBuf;
use windows::Win32::Foundation::{HWND,POINT,RECT};
use windows::Win32::Graphics::Gdi::ClientToScreen;
use windows::Win32::UI::WindowsAndMessaging::{GetClientRect,GetForegroundWindow,IsIconic,IsWindow};
#[derive(Clone,Copy,Debug,PartialEq,Eq)]pub struct Hwnd(pub isize);
impl Hwnd {pub fn get(self)->HWND{HWND(self.0 as *mut core::ffi::c_void)}pub fn of(h:HWND)->Self{Self(h.0 as isize)}}
pub fn find_game_window()->Option<Hwnd>{
 let h=Hwnd(std::env::var("TORCHLIGHT_GAME_HWND").ok()?.parse().ok()?);
 unsafe {IsWindow(h.get()).as_bool().then_some(h)}
}
pub fn client_rect(h:Hwnd)->Option<(i32,i32,i32,i32)>{unsafe{
 if IsIconic(h.get()).as_bool(){return None}
 let mut r=RECT::default();GetClientRect(h.get(),&mut r).ok()?;
 let mut p=POINT{x:0,y:0};if !ClientToScreen(h.get(),&mut p).as_bool(){return None}
 let(w,hh)=(r.right-r.left,r.bottom-r.top);(w>0&&hh>0).then_some((p.x,p.y,w,hh))
}}
pub fn foreground()->Hwnd{Hwnd::of(unsafe{GetForegroundWindow()})}
pub fn note(msg:&str){
 let path=std::env::var_os("TORCHLIGHT_USER_DATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("logs/vorax.log");
 if let Some(dir)=path.parent(){let _=std::fs::create_dir_all(dir);}
 if std::fs::metadata(&path).is_ok_and(|m|m.len()>2_000_000){let _=std::fs::rename(&path,path.with_extension("old.log"));}
 use std::io::Write;if let Ok(mut f)=std::fs::OpenOptions::new().create(true).append(true).open(path){let _=writeln!(f,"{msg}");}
}
