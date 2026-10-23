mod capture;
pub(crate) mod ocr;
#[path = "host-sys.rs"] mod sys;
mod window;
mod host;
pub use host::run;
