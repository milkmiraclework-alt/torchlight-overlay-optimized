pub mod api;
pub mod engine;
pub mod job;
pub mod model;
pub mod policy;

#[cfg(target_arch = "wasm32")]
mod wasm {
    use crate::api::Core;
    use std::cell::RefCell;
    thread_local! {static CORE:RefCell<Core>=RefCell::new(Core::default());static OUTPUT:RefCell<Vec<u8>>=const{RefCell::new(Vec::new())};}
    #[no_mangle]
    pub extern "C" fn alloc(len: usize) -> *mut u8 {
        let mut b = vec![0u8; len];
        let p = b.as_mut_ptr();
        std::mem::forget(b);
        p
    }
    #[no_mangle]
    pub unsafe extern "C" fn dealloc(p: *mut u8, len: usize) {
        drop(Vec::from_raw_parts(p, len, len))
    }
    #[no_mangle]
    pub unsafe extern "C" fn request(p: *const u8, len: usize) -> usize {
        let result = serde_json::from_slice(std::slice::from_raw_parts(p, len))
            .map_err(|e| e.to_string())
            .and_then(|v| CORE.with(|c| c.borrow_mut().handle(v)));
        let value = match result {
            Ok(v) => v,
            Err(e) => serde_json::json!({"error":e}),
        };
        OUTPUT.with(|out| {
            *out.borrow_mut() = serde_json::to_vec(&value).unwrap();
            out.borrow().len()
        })
    }
    #[no_mangle]
    pub extern "C" fn response() -> *const u8 {
        OUTPUT.with(|out| out.borrow().as_ptr())
    }
}
