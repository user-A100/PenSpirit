pub mod assembler;
pub mod inject;

pub use assembler::{
    assemble, trim_history, AssembleInput, Assembled, AssemblyLog, InjectionInput, Mode, SlotLog,
    AFTER_WINDOW_CHARS, CHAPTER_WINDOW_CHARS, PREV_WINDOW_CHARS, SELECTION_MAX_CHARS,
};
