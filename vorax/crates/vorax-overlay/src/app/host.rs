//! A managed Vorax backend. The common host owns the log, settings and tray.
use super::{capture::Capturer,ocr::Ocr,sys,window::{self,ToUi}};
use crate::pipeline::{Pipeline,Outcome};
use serde::Deserialize;
use std::io::{BufRead,Write};
use std::sync::mpsc;

#[derive(Deserialize)]
struct Command { cmd:String, trigger:Option<String>, shown:Option<bool>, now:Option<bool> }
enum Work { Read(Option<String>,bool), Quit }
pub fn event(value:serde_json::Value){let mut out=std::io::stdout().lock();let _=writeln!(out,"{value}");let _=out.flush();}
pub fn run(args:&[String]) {
 if !args.iter().any(|a|a=="--hosted") {return}
 unsafe {let _=windows::Win32::UI::HiDpi::SetProcessDpiAwarenessContext(windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);}
 let Some(fonts)=crate::draw::Fonts::system() else {event(serde_json::json!({"event":"error","reason":"No system font"}));return};
 let (to_ui,from_worker)=mpsc::channel();
 let waker=match window::create(fonts,from_worker,crate::arg(args,"--accent").unwrap_or(0)){Ok(w)=>w,Err(e)=>{event(serde_json::json!({"event":"error","reason":e.to_string()}));return}};
 let (to_work,from_host)=mpsc::channel();
 let ui=to_ui.clone();
 std::thread::spawn(move || {
  for line in std::io::stdin().lock().lines().map_while(Result::ok) {
   let Ok(c)=serde_json::from_str::<Command>(&line) else {continue};
   match c.cmd.as_str(){
    "read"=>{let _=to_work.send(Work::Read(c.trigger,c.now.unwrap_or(false)));},
    "shown"=>{let _=ui.send(ToUi::Shown(c.shown.unwrap_or(true)));waker.wake();},
    "quit"=>break,
    _=>{}
   }
  }
  let _=to_work.send(Work::Quit);let _=ui.send(ToUi::Quit);waker.wake();
 });
 let shelley=crate::arg::<i32>(args,"--shelley").unwrap_or(6).clamp(1,6);
 std::thread::spawn(move || {
  unsafe {let _=windows::Win32::System::WinRT::RoInitialize(windows::Win32::System::WinRT::RO_INIT_MULTITHREADED);}
  let mut pipe=Pipeline::new(shelley);
  let mut capturer=None;
  let mut ocr=None;
  let send=|m|{let _=to_ui.send(m);waker.wake();};
  while let Ok(work)=from_host.recv() {
   let Work::Read(mut trigger,mut now)=work else {return};
   // Keep only the newest queued read; a screen reset is never discarded.
   while let Ok(next)=from_host.try_recv(){match next{Work::Quit=>return,Work::Read(t,n)=>{if trigger.as_deref()!=Some("screen"){trigger=t}now=n}}}
   let Some(game)=sys::find_game_window() else {send(ToUi::Clear);continue};
   if capturer.is_none(){capturer=Capturer::new().ok();ocr=Ocr::new().ok();}
   let Some(capture)=&capturer else {event(serde_json::json!({"event":"error","reason":"Windows capture unavailable"}));continue};
   send(ToUi::Busy);
   let started=std::time::Instant::now();
   // Capture sessions start and stop per requested board, as in Smart.3.
   let image=match if now {capture.grab(game)} else {capture.grab_stable(game)}{Ok(Some(f))=>f,_=>{send(ToUi::Unbusy);event(serde_json::json!({"event":"read","kind":"no-frame"}));continue}};
   let mut text=|img:&vorax_scan::pixels::Img|ocr.as_ref().and_then(|o|o.read(img).ok()).unwrap_or_default();
   let reader:crate::pipeline::TextReader=if ocr.is_some(){Some(&mut text)}else{None};
   match pipe.run(&image,trigger.as_deref(),reader){
    Outcome::Advice{reading,advice,plan,read_ms}=>{
     let (w,h)=vorax_scan::window::windowed_game(&image).map_or((image.width,image.height),|a|(a.w as usize,a.h as usize));
     event(serde_json::json!({"event":"read","kind":"advice","readMs":read_ms,"solveMs":advice.ms,"totalMs":started.elapsed().as_millis(),"unknown":advice.unknown.len(),"round":reading.state.round,"relook":pipe.wants_relook()}));
     send(ToUi::Show(plan,w,h));
    },
    Outcome::Animating=>{send(ToUi::Unbusy);event(serde_json::json!({"event":"read","kind":"animating"}));},
    Outcome::NotGame=>{send(ToUi::Clear);event(serde_json::json!({"event":"read","kind":"not-game"}));}
   }
  }
 });
 event(serde_json::json!({"event":"ready","pid":std::process::id(),"shelley":shelley,"threads":std::env::var("RAYON_NUM_THREADS").ok()}));
 window::run_loop();
 // Do not join a stale calculation on EOF. Returning exits only this managed
 // process; it cannot leave an orphan or block the host's shutdown.
}
