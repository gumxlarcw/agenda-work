import { Responsive, useContainerWidth } from 'react-grid-layout';
import {
  GRID_COLS, GRID_BREAKPOINTS, GRID_ROW_HEIGHT, GRID_MARGIN, WIDGET_CONSTRAINTS,
} from './defaultLayout';

export default function BentoGrid({ layouts, onLayoutChange, children }) {
  const { width, containerRef, mounted } = useContainerWidth();

  return (
    <div ref={containerRef}>
      {mounted && (
        <Responsive
          className="dashboard-grid"
          width={width}
          layouts={layouts}
          breakpoints={GRID_BREAKPOINTS}
          cols={GRID_COLS}
          rowHeight={GRID_ROW_HEIGHT}
          margin={GRID_MARGIN}
          onLayoutChange={onLayoutChange}
          draggableCancel=".no-drag"
          resizeHandles={['se']}
          compactType="vertical"
          useCSSTransforms
        >
          {children}
        </Responsive>
      )}
    </div>
  );
}

// Apply min/max constraints to a grid item's data-grid
export function getGridItemProps(widgetId) {
  return WIDGET_CONSTRAINTS[widgetId] || {};
}

export const glassCard =
  'bg-white/70 backdrop-blur-xl border border-white/30 rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.06)] transition-all duration-300';
