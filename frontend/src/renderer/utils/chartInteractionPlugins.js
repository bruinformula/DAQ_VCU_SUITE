/**
 * Vertical crosshair plugin: draws a dashed vertical line at the current
 * mouse X position to make value-reading from the chart unambiguous.
 *
 * Reads the crosshair X coordinate from `chart.$crosshairX`, which the
 * host component sets directly. The plugin does not force redraws — it
 * relies on the chart's own hover-driven render pass (which already runs
 * on every mousemove when tooltip intersect=false).
 */
export const crosshairPlugin = {
  id: 'crosshair',
  afterDatasetsDraw(chart) {
    const x = chart.$crosshairX;
    if (x == null) return;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    if (!xScale || !yScale) return;
    if (x < xScale.left || x > xScale.right) return;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, yScale.top);
    ctx.lineTo(x, yScale.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.7)';
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();
  }
};
