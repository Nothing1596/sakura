// Only host RMS summaries enter this bounded history. Rendering never clocks audio capture.
export function createAsrWaveform({ canvas, window }) {
  const context = canvas.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let running = false;
  let frame = null;
  let bucketAt = null;
  let peak = 0;
  let smooth = 0;
  let history = [];
  function draw(now) {
    if (!running || !context) return;
    const interval = reduced.matches ? 600 : 150;
    if (bucketAt === null) bucketAt = now;
    if (now - bucketAt >= interval) {
      smooth += (peak - smooth) * (peak > smooth ? 0.65 : 0.4);
      history.push(smooth);
      history = history.slice(-160);
      peak = 0;
      bucketAt = now;
    }
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = window.getComputedStyle(canvas).color;
    context.lineWidth = 3;
    context.lineCap = "round";
    const shift = reduced.matches ? 0 : Math.min(1, (now - bucketAt) / interval) * 6;
    const count = Math.ceil(width / 6) + 1;
    context.beginPath();
    for (let index = 0; index < count; index += 1) {
      const x = width - index * 6 - shift;
      const level = history[history.length - 1 - index] || 0;
      const amplitude = Math.max(0.1, Math.min(1, level) * (height - 5) / 2);
      context.moveTo(x, height / 2 - amplitude);
      context.lineTo(x, height / 2 + amplitude);
    }
    context.stroke();
    frame = window.requestAnimationFrame(draw);
  }
  return Object.freeze({
    push(level) { peak = Math.max(peak, level); },
    start() {
      if (running) return;
      running = true; history = []; peak = 0; smooth = 0; bucketAt = null;
      frame = window.requestAnimationFrame(draw);
    },
    stop() { running = false; window.cancelAnimationFrame(frame); frame = null; },
  });
}
