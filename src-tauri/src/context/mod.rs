pub mod assembler;
pub mod inject;

pub use assembler::{
    assemble, AssembleInput, Assembled, AssemblyLog, InjectionInput, SlotLog,
    CHAPTER_WINDOW_CHARS, PREV_WINDOW_CHARS,
};
