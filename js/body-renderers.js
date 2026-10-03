(function (global) {
  "use strict";

  const BodyRendererRegistry = Object.create(null);

  function registerBodyRenderer(name, fn) {
    if (typeof name !== "string" || !name) throw new Error("Body renderer name is required.");
    if (typeof fn !== "function") throw new Error("Body renderer must be a function.");
    BodyRendererRegistry[name] = fn;
    return fn;
  }

  function resolveBodyRenderer(fish) {
    const design = fish && (fish.design || fish.lineage) ? (fish.design || fish.lineage) : null;
    const body = design && design.body ? design.body : null;
    const bodyType = body && typeof body.type === "string" ? body.type : "spine";
    return BodyRendererRegistry[bodyType] || BodyRendererRegistry.spine || null;
  }

  function drawSpineBody(ctx, fish, m, bodyColor, outlineStyle) {
    const self = this;
    const cx = self._cx, cy = self._cy;
    self._bodyPath(ctx, m);
    ctx.fillStyle = bodyColor;
    ctx.fill();
    if (outlineStyle) { ctx.strokeStyle = outlineStyle; ctx.lineWidth = 1.1; ctx.stroke(); }
  }

  function drawBellBody(ctx, fish, m, bodyColor, outlineStyle) {
    const self = this;
    const cx = self._cx, cy = self._cy;
    let minX = Number.POSITIVE_INFINITY, maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < m; i++) {
      minX = Math.min(minX, cx[i]); maxX = Math.max(maxX, cx[i]);
      minY = Math.min(minY, cy[i]); maxY = Math.max(maxY, cy[i]);
    }
    const cxMid = (minX + maxX) * 0.5;
    const cyMid = (minY + maxY) * 0.5;
    const rx = Math.max(8, (maxX - minX) * 0.65);
    const ry = Math.max(8, (maxY - minY) * 0.9);
    ctx.beginPath();
    ctx.ellipse(cxMid, cyMid, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = bodyColor;
    ctx.fill();
    if (outlineStyle) {
      ctx.strokeStyle = outlineStyle;
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cxMid - rx * 0.55, cyMid + ry * 0.55);
    ctx.quadraticCurveTo(cxMid, cyMid + ry * 1.2, cxMid + rx * 0.55, cyMid + ry * 0.55);
    ctx.strokeStyle = outlineStyle || bodyColor;
    ctx.stroke();
  }

  function drawWingBody(ctx, fish, m, bodyColor, outlineStyle) {
    const self = this;
    const cx = self._cx, cy = self._cy;
    const idx = Math.max(1, Math.min(m - 2, Math.round(m * 0.45)));
    const ax = cx[idx], ay = cy[idx];
    const leftX = cx[0], leftY = cy[0];
    const rightX = cx[m - 1], rightY = cy[m - 1];
    const span = Math.hypot(rightX - leftX, rightY - leftY) * 0.8;

    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(ax - span * 0.7, ay - 10, leftX, leftY);
    ctx.quadraticCurveTo(ax - span * 0.2, ay + 18, ax, ay);
    ctx.closePath();
    ctx.fillStyle = bodyColor;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(ax + span * 0.7, ay - 10, rightX, rightY);
    ctx.quadraticCurveTo(ax + span * 0.2, ay + 18, ax, ay);
    ctx.closePath();
    ctx.fillStyle = bodyColor;
    ctx.fill();

    if (outlineStyle) {
      ctx.strokeStyle = outlineStyle;
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
  }

  function drawRibbonBody(ctx, fish, m, bodyColor, outlineStyle) {
    const self = this;
    const cx = self._cx, cy = self._cy;
    ctx.beginPath();
    ctx.moveTo(cx[0], cy[0]);
    for (let i = 1; i < m; i++) {
      const t = i / (m - 1);
      const x = cx[i] + Math.sin(t * Math.PI * 6 + fish.swimPhase || 0) * (fish.size * 0.12);
      const y = cy[i] + Math.cos(t * Math.PI * 8 + fish.swimPhase || 0) * (fish.size * 0.2);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(cx[m - 1], cy[m - 1]);
    ctx.strokeStyle = outlineStyle || bodyColor;
    ctx.lineWidth = Math.max(2, fish.size * 0.18);
    ctx.stroke();
  }

  function drawInflateBody(ctx, fish, m, bodyColor, outlineStyle) {
    const self = this;
    const cx = self._cx, cy = self._cy;
    const sizeScale = 1 + (fish.size / 80) * 0.75;
    ctx.beginPath();
    for (let i = 0; i < m; i++) {
      const x = cx[i];
      const y = cy[i];
      const px = (x - cx[0]) * sizeScale;
      const py = (y - cy[0]) * sizeScale;
      if (i === 0) ctx.moveTo(px + cx[0], py + cy[0]);
      else ctx.lineTo(px + cx[0], py + cy[0]);
    }
    ctx.closePath();
    ctx.fillStyle = bodyColor;
    ctx.fill();
    if (outlineStyle) { ctx.strokeStyle = outlineStyle; ctx.lineWidth = 1.2; ctx.stroke(); }
  }

  registerBodyRenderer("spine", drawSpineBody);
  registerBodyRenderer("bell", drawBellBody);
  registerBodyRenderer("wing", drawWingBody);
  registerBodyRenderer("inflate", drawInflateBody);
  registerBodyRenderer("ribbon", drawRibbonBody);
  registerBodyRenderer("jet", drawSpineBody);
  registerBodyRenderer("flat", drawSpineBody);
  registerBodyRenderer("rigid", drawSpineBody);

  global.BodyRendererRegistry = BodyRendererRegistry;
  global.registerBodyRenderer = registerBodyRenderer;
  global.resolveBodyRenderer = resolveBodyRenderer;
})(typeof window !== "undefined" ? window : globalThis);
