// =============================================================================
// GRADEBOOK UI CONFIGURATION
// -----------------------------------------------------------------------------
// ASSESSMENT_COL_WIDTH_PX controls the width (in pixels) of EVERY individual
// assessment date/score column in the gradebook grid.
//
// 👉 To make the gradebook columns wider or narrower, change this ONE number.
//    (56 = compact width + enough room for MM/DD/YYYY with inner padding.)
// =============================================================================
export const ASSESSMENT_COL_WIDTH_PX = 56;

// Width of the per-period "Grade" column.
export const GRADE_COL_WIDTH_PX = 56;

// Width of the "Final Grade" column.
export const FINAL_GRADE_COL_WIDTH_PX = 64;

// Widths of the sticky "#" and "Student Name" columns.
// NOTE: NUM_COL_WIDTH_PX must match the `left` offset of `.sticky-col-2`
// in globals.css (currently 40px) so the name column pins correctly.
export const NUM_COL_WIDTH_PX = 40;
export const NAME_COL_WIDTH_PX = 160;          // default — user-resizable, persisted in localStorage
export const NAME_COL_MIN_PX = 110;
export const NAME_COL_MAX_PX = 420;

// The floating horizontal scrollbar pinned near the bottom of the gradebook
// (so you never scroll to the last student just to move sideways).
export const STICKY_SCROLLBAR_WIDTH_PX = 500;
