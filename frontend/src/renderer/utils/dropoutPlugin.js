/**
 * Creates a custom Chart.js plugin to draw vertical highlighted bands for data dropouts.
 * 
 * @param {Array} gaps Array of gap objects: { startTime, endTime, duration }
 * @param {number} startTs The absolute starting timestamp of the loaded run
 */
export const createDropoutPlugin = (gaps, startTs) => {
  return {
    id: 'dropoutHighlights',
    beforeDraw: (chart) => {
      if (!gaps || gaps.length === 0) return;
      const ctx = chart.ctx;
      const xScales = chart.scales.x;
      const yScales = chart.scales.y;

      gaps.forEach(gap => {
        // Map absolute timestamps to relative time numbers
        const relStart = gap.startTime - startTs;
        const relEnd = gap.endTime - startTs;

        const startX = xScales.getPixelForValue(relStart);
        const endX = xScales.getPixelForValue(relEnd);

        if (startX <= endX) {
          ctx.save();
          // Draw translucent band using gap-specific colors
          ctx.fillStyle = gap.color || 'rgba(239, 68, 68, 0.12)';
          ctx.fillRect(startX, yScales.top, endX - startX, yScales.bottom - yScales.top);

          // Draw double borders for the gap
          ctx.strokeStyle = gap.borderColor || 'rgba(239, 68, 68, 0.4)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(startX, yScales.top);
          ctx.lineTo(startX, yScales.bottom);
          ctx.moveTo(endX, yScales.top);
          ctx.lineTo(endX, yScales.bottom);
          ctx.stroke();

          // Write a small label on top if it has enough horizontal width
          if (endX - startX > 32) {
            ctx.fillStyle = gap.textColor || '#ef4444';
            ctx.font = 'bold 9px var(--font-sans)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(gap.label || 'DROP', startX + (endX - startX) / 2, yScales.top + 15);
            ctx.fillStyle = '#f8fafc';
            ctx.font = '8px var(--font-sans)';
            ctx.fillText(`${gap.duration.toFixed(1)}s`, startX + (endX - startX) / 2, yScales.top + 28);
          }
          ctx.restore();
        }
      });
    }
  };
};
