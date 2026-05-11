// Default grid layouts per breakpoint + widget constraints
// Used as fallback when user has no saved layout

export const GRID_COLS = { lg: 12, md: 12, sm: 2, xs: 1 };
export const GRID_BREAKPOINTS = { lg: 1024, md: 768, sm: 640, xs: 0 };
export const GRID_ROW_HEIGHT = 140;
export const GRID_MARGIN = [16, 16];

// Widget size constraints
export const WIDGET_CONSTRAINTS = {
  'stat-0':          { minW: 2, minH: 1, maxW: 6,  maxH: 2 },
  'stat-1':          { minW: 2, minH: 1, maxW: 6,  maxH: 2 },
  'stat-2':          { minW: 2, minH: 1, maxW: 6,  maxH: 2 },
  'stat-3':          { minW: 2, minH: 1, maxW: 6,  maxH: 2 },
  'today-focus':     { minW: 3, minH: 2, maxW: 12, maxH: 6 },
  'calendar-heatmap':{ minW: 4, minH: 2, maxW: 12, maxH: 5 },
  'event-calendar':  { minW: 4, minH: 3, maxW: 12, maxH: 8 },
  'recent-tasks':    { minW: 4, minH: 2, maxW: 12, maxH: 6 },
  'activity-feed':   { minW: 3, minH: 2, maxW: 12, maxH: 6 },
  'recent-notes':    { minW: 4, minH: 2, maxW: 12, maxH: 5 },
};

// Default layout for lg (12-column desktop)
// rowHeight=140px, so h:1=140px, h:2=296px (2*140+16gap), h:3=452px
const lgLayout = [
  { i: 'stat-0',           x: 0,  y: 0, w: 3,  h: 1 },
  { i: 'stat-1',           x: 3,  y: 0, w: 3,  h: 1 },
  { i: 'stat-2',           x: 6,  y: 0, w: 3,  h: 1 },
  { i: 'stat-3',           x: 9,  y: 0, w: 3,  h: 1 },
  { i: 'today-focus',      x: 0,  y: 1, w: 4,  h: 3 },
  { i: 'calendar-heatmap', x: 4,  y: 1, w: 8,  h: 2 },
  { i: 'event-calendar',   x: 4,  y: 3, w: 4,  h: 4 },
  { i: 'recent-tasks',     x: 0,  y: 4, w: 4,  h: 3 },
  { i: 'activity-feed',    x: 8,  y: 3, w: 4,  h: 4 },
  { i: 'recent-notes',     x: 0,  y: 7, w: 12, h: 2 },
];

// Default layout for sm (2-column tablet)
const smLayout = [
  { i: 'stat-0',           x: 0, y: 0, w: 1, h: 1 },
  { i: 'stat-1',           x: 1, y: 0, w: 1, h: 1 },
  { i: 'stat-2',           x: 0, y: 1, w: 1, h: 1 },
  { i: 'stat-3',           x: 1, y: 1, w: 1, h: 1 },
  { i: 'today-focus',      x: 0, y: 2, w: 2, h: 3 },
  { i: 'calendar-heatmap', x: 0, y: 5, w: 2, h: 2 },
  { i: 'event-calendar',   x: 0, y: 7, w: 2, h: 4 },
  { i: 'recent-tasks',     x: 0, y: 11, w: 2, h: 3 },
  { i: 'activity-feed',    x: 0, y: 14, w: 2, h: 3 },
  { i: 'recent-notes',     x: 0, y: 17, w: 2, h: 2 },
];

// Default layout for xs (1-column mobile) — locked, no drag
const xsLayout = [
  { i: 'stat-0',           x: 0, y: 0,  w: 1, h: 1, static: true },
  { i: 'stat-1',           x: 0, y: 1,  w: 1, h: 1, static: true },
  { i: 'stat-2',           x: 0, y: 2,  w: 1, h: 1, static: true },
  { i: 'stat-3',           x: 0, y: 3,  w: 1, h: 1, static: true },
  { i: 'today-focus',      x: 0, y: 4,  w: 1, h: 3, static: true },
  { i: 'calendar-heatmap', x: 0, y: 7,  w: 1, h: 2, static: true },
  { i: 'event-calendar',   x: 0, y: 9,  w: 1, h: 4, static: true },
  { i: 'recent-tasks',     x: 0, y: 13, w: 1, h: 3, static: true },
  { i: 'activity-feed',    x: 0, y: 16, w: 1, h: 3, static: true },
  { i: 'recent-notes',     x: 0, y: 19, w: 1, h: 2, static: true },
];

export const DEFAULT_LAYOUTS = { lg: lgLayout, sm: smLayout, xs: xsLayout };
