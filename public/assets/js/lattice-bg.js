// Requires anime.js and a #lattice canvas.
(() => {
  const canvas = document.getElementById("lattice");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H, dpr;
  let nodes = [];
  const mouse = { x: -1e4, y: -1e4 };
  const intro = {
    phase: "done",
    seedOpacity: 0,
    seedRadius: 2,
    seedGlow: 0,
    rippleRadius: 0,
    rippleMax: 0,
    rippleOpacity: 0.6,
    ambientOpacity: 1,
    centerX: 0,
    centerY: 0,
  };
  const GRID = 55,
    CONN_DIST = 130,
    MOUSE_R = 220,
    SUB_NODES_PER = 3;

  function setCanvasSize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    intro.centerX = W / 2;
    intro.centerY = H * 0.45;
    intro.rippleMax = Math.sqrt(W * W + H * H);
  }

  function makeNode(bx, by, tier, type) {
    const rm = { bright: 1.4, mid: 1.0, dim: 0.65, micro: 0.45 },
      om = { bright: 0.5, mid: 0.25, dim: 0.12, micro: 0.18 };
    return {
      bx,
      by,
      x: bx,
      y: by,
      radius: rm[tier] || 1,
      baseOpacity: om[tier] || 0.2,
      tier,
      type,
      phase: Math.random() * Math.PI * 2,
      phaseY: Math.random() * Math.PI * 2,
      distFromCenter: 0,
    };
  }

  function buildLattice() {
    nodes = [];
    const pad = GRID * 2,
      cols = Math.ceil((W + pad * 2) / GRID),
      rows = Math.ceil((H + pad * 2) / GRID);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const stagger = (r % 2) * (GRID * 0.5);
        const bx = -pad + c * GRID + stagger,
          by = -pad + r * GRID;
        const tier = Math.random();
        nodes.push(
          makeNode(
            bx,
            by,
            tier > 0.7 ? "bright" : tier > 0.3 ? "mid" : "dim",
            "main",
          ),
        );
        if (Math.random() > 0.7) {
          const count = 1 + Math.floor(Math.random() * SUB_NODES_PER);
          for (let s = 0; s < count; s++) {
            const angle = ((Math.PI * 2) / count) * s + Math.random() * 0.5;
            const dist = 8 + Math.random() * 18;
            nodes.push(
              makeNode(
                bx + Math.cos(angle) * dist,
                by + Math.sin(angle) * dist,
                "micro",
                "satellite",
              ),
            );
          }
        }
      }
    }
    nodes.forEach((n) => {
      const dx = n.bx - intro.centerX,
        dy = n.by - intro.centerY;
      n.distFromCenter = Math.sqrt(dx * dx + dy * dy);
    });
    nodes.forEach((n) => {
      const d1 = 4000 + Math.random() * 6000,
        d2 = 4000 + Math.random() * 6000;
      const amp =
        n.type === "satellite"
          ? 6 + Math.random() * 10
          : 10 + Math.random() * 20;
      anime({
        targets: n,
        x: [
          { value: n.bx + Math.cos(n.phase) * amp, duration: d1 },
          {
            value: n.bx - Math.cos(n.phase + 1) * amp * 0.6,
            duration: d2,
          },
        ],
        y: [
          { value: n.by + Math.sin(n.phaseY) * amp, duration: d2 },
          {
            value: n.by - Math.sin(n.phaseY + 1) * amp * 0.6,
            duration: d1,
          },
        ],
        easing: "easeInOutSine",
        loop: true,
        direction: "alternate",
        delay: Math.random() * 2000,
      });
      if (n.tier === "bright" || Math.random() > 0.8)
        anime({
          targets: n,
          radius: [n.radius, n.radius * 1.6],
          easing: "easeInOutSine",
          duration: 2000 + Math.random() * 3000,
          loop: true,
          direction: "alternate",
          delay: Math.random() * 2000,
        });
    });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (intro.phase !== "done") {
      if (intro.seedOpacity > 0) {
        const sg = intro.seedGlow;
        if (sg > 0) {
          const grd = ctx.createRadialGradient(
            intro.centerX,
            intro.centerY,
            0,
            intro.centerX,
            intro.centerY,
            60 * sg,
          );
          grd.addColorStop(0, `rgba(220,220,230,${0.12 * sg})`);
          grd.addColorStop(1, "rgba(220,220,230,0)");
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(intro.centerX, intro.centerY, 60 * sg, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(intro.centerX, intro.centerY, intro.seedRadius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(240,240,250,${intro.seedOpacity})`;
        ctx.fill();
      }
      if (intro.rippleRadius > 0 && intro.rippleOpacity > 0) {
        ctx.beginPath();
        ctx.arc(
          intro.centerX,
          intro.centerY,
          intro.rippleRadius,
          0,
          Math.PI * 2,
        );
        ctx.strokeStyle = `rgba(200,200,210,${intro.rippleOpacity * 0.5})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    const ao = intro.phase === "done" ? 1 : intro.ambientOpacity;
    if (ao > 0) {
      const cd2 = CONN_DIST * CONN_DIST,
        mr2 = MOUSE_R * MOUSE_R;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        if (a.type === "satellite") continue;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          if (b.type === "satellite") continue;
          const dx = a.x - b.x,
            dy = a.y - b.y,
            d2 = dx * dx + dy * dy;
          if (d2 < cd2) {
            const dist = Math.sqrt(d2);
            const f = 1 - dist / CONN_DIST;
            let alpha = f * 0.07 * ao;
            const mx = (a.x + b.x) / 2,
              my = (a.y + b.y) / 2;
            const mdx = mouse.x - mx,
              mdy = mouse.y - my,
              md2 = mdx * mdx + mdy * mdy;
            if (md2 < mr2) {
              const mf = 1 - Math.sqrt(md2) / MOUSE_R;
              alpha = Math.min(0.6, alpha + mf * mf * 0.5 * ao);
            }
            if (alpha > 0.01) {
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
              ctx.lineWidth = 0.5;
              ctx.stroke();
            }
          }
        }
      }
      if (mouse.x > -1e3) {
        const rot = Date.now() * 0.0008;
        for (let ring = 0; ring < 2; ring++) {
          const rr = 35 + ring * 25;
          const sides = 6;
          const alpha = (0.03 - ring * 0.008) * ao;
          ctx.beginPath();
          for (let s = 0; s <= sides; s++) {
            const angle = ((Math.PI * 2) / sides) * s + rot;
            const px = mouse.x + Math.cos(angle) * rr;
            const py = mouse.y + Math.sin(angle) * rr;
            s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.strokeStyle = `rgba(200,200,210,${alpha})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        let alpha = n.baseOpacity * ao,
          r = n.radius,
          bo = 0;
        const ndx = mouse.x - n.x,
          ndy = mouse.y - n.y,
          nd2 = ndx * ndx + ndy * ndy;
        if (nd2 < mr2) {
          const f = 1 - Math.sqrt(nd2) / MOUSE_R;
          bo = f * f;
          alpha = Math.min(0.9, alpha + bo * 0.6 * ao);
          r += bo * 2.2;
        }
        if (nd2 < mr2 * 0.3 && n.tier === "bright") {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * 3.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.06})`;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.fill();
      }
    }
    requestAnimationFrame(draw);
  }

  document.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  document.addEventListener("mouseleave", () => {
    mouse.x = -1e4;
    mouse.y = -1e4;
  });

  setCanvasSize();
  buildLattice();
  draw();

  window.LatticeBG = {
    intro,
    rebuild() {
      anime.remove(nodes);
      setCanvasSize();
      buildLattice();
    },
  };
})();
