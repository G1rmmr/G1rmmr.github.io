#[cfg(any(target_arch = "wasm32", test))]
mod protocol;

#[cfg(target_arch = "wasm32")]
mod runtime;
