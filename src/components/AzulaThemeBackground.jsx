"use client";

import { useEffect, useRef } from "react";

const rand = (a, b) => Math.random() * (b - a) + a;

function buildBolt(x1, y1, x2, y2, roughness) {
  if (roughness < 2) return [[x1, y1], [x2, y2]];
  const mx = (x1 + x2) / 2 + rand(-roughness, roughness);
  const my = (y1 + y2) / 2 + rand(-roughness * 0.5, roughness * 0.5);
  return [
    ...buildBolt(x1, y1, mx, my, roughness / 2),
    ...buildBolt(mx, my, x2, y2, roughness / 2).slice(1),
  ];
}

class CloudSystem {
  constructor(getSize) {
    this.getSize = getSize;
    this.particles = Array.from({ length: 180 }, () => this.make());
  }

  make(x) {
    const { W, H } = this.getSize();
    return {
      x: x ?? rand(0, W),
      y: rand(0, H * 0.65),
      r: rand(60, 260),
      vx: rand(0.04, 0.18) * (Math.random() < 0.5 ? 1 : -1),
      vy: rand(-0.04, 0.04),
      alpha: rand(0.012, 0.045),
      hue: rand(200, 230),
      sat: rand(30, 70),
    };
  }

  update() {
    const { W, H } = this.getSize();
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -p.r) {
        p.x = W + p.r;
        p.y = rand(0, H * 0.65);
      }
      if (p.x > W + p.r) {
        p.x = -p.r;
        p.y = rand(0, H * 0.65);
      }
      if (p.y < -p.r) p.y = H * 0.65 + p.r;
      if (p.y > H * 0.65 + p.r) p.y = -p.r;
    }
  }

  draw(ctx) {
    for (const p of this.particles) {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, `hsla(${p.hue},${p.sat}%,18%,${p.alpha})`);
      g.addColorStop(0.5, `hsla(${p.hue},${p.sat}%,8%,${p.alpha * 0.5})`);
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r * 1.6, p.r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

class Rain {
  constructor(getSize) {
    this.getSize = getSize;
    this.drops = Array.from({ length: 560 }, () => this.make(true));
  }

  make(init) {
    const { W, H } = this.getSize();
    return {
      x: rand(0, W),
      y: init ? rand(0, H) : rand(-80, -10),
      len: rand(18, 52),
      speed: rand(18, 34),
      alpha: rand(0.1, 0.3),
      width: rand(0.5, 1.15),
    };
  }

  update() {
    const { H } = this.getSize();
    for (let i = 0; i < this.drops.length; i += 1) {
      const d = this.drops[i];
      d.x += 1.2;
      d.y += d.speed;
      if (d.y > H + 50) this.drops[i] = this.make(false);
    }
  }

  draw(ctx) {
    ctx.save();
    for (const d of this.drops) {
      ctx.strokeStyle = `rgba(150,220,255,${d.alpha})`;
      ctx.lineWidth = d.width;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + d.len * 0.12, d.y + d.len);
      ctx.stroke();
    }
    ctx.restore();
  }
}

class LightningSystem {
  constructor(getSize, addTimer) {
    this.getSize = getSize;
    this.addTimer = addTimer;
    this.bolts = [];
    this.flashes = [];
    this.nextStrike = rand(600, 2000);
    this.elapsed = 0;
  }

  spawnStrike() {
    const { W, H } = this.getSize();
    const x1 = rand(W * 0.05, W * 0.95);
    const y1 = rand(0, H * 0.15);
    const x2 = x1 + rand(-120, 120);
    const y2 = rand(H * 0.45, H * 0.88);
    const roughness = rand(60, 140);
    const pts = buildBolt(x1, y1, x2, y2, roughness);

    const branches = [];
    for (let i = 3; i < pts.length - 2; i += 1) {
      if (Math.random() < 0.18) {
        const bLen = rand(0.2, 0.55);
        const [bx1, by1] = pts[i];
        const bx2 = bx1 + (x2 - x1) * bLen + rand(-80, 80);
        const by2 = by1 + (y2 - y1) * bLen;
        branches.push({ pts: buildBolt(bx1, by1, bx2, by2, roughness * 0.4), life: 1, alpha: rand(0.3, 0.6) });
      }
    }

    this.bolts.push({
      pts,
      branches,
      life: 1,
      decay: rand(0.035, 0.07),
    });

    this.flashes.push({ alpha: rand(0.08, 0.18), decay: rand(0.04, 0.09), cx: x1, cy: y1 * 0.5 });
    if (Math.random() < 0.4) {
      this.addTimer(
        window.setTimeout(() => {
          this.flashes.push({ alpha: rand(0.04, 0.1), decay: 0.06, cx: x1, cy: 0 });
        }, rand(40, 120))
      );
    }
  }

  update(dt) {
    this.elapsed += dt;
    if (this.elapsed >= this.nextStrike) {
      this.spawnStrike();
      if (Math.random() < 0.3) {
        this.addTimer(window.setTimeout(() => this.spawnStrike(), rand(60, 180)));
      }
      this.elapsed = 0;
      this.nextStrike = rand(700, 3200);
    }

    this.bolts = this.bolts.filter((b) => {
      b.life -= b.decay;
      b.branches.forEach((br) => {
        br.life -= b.decay * 1.4;
      });
      return b.life > 0;
    });

    this.flashes = this.flashes.filter((f) => {
      f.alpha -= f.decay;
      return f.alpha > 0;
    });
  }

  drawBoltPath(ctx, pts, width, color) {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  draw(ctx) {
    const { H, W } = this.getSize();
    for (const f of this.flashes) {
      const g = ctx.createRadialGradient(f.cx, f.cy, 0, f.cx, H * 0.5, H * 0.8);
      g.addColorStop(0, `rgba(80,160,255,${f.alpha})`);
      g.addColorStop(0.4, `rgba(30,80,180,${f.alpha * 0.4})`);
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const b of this.bolts) {
      const a = b.life;
      ctx.shadowBlur = 0;
      ctx.globalAlpha = a * 0.15;
      this.drawBoltPath(ctx, b.pts, 18, "rgba(60,140,255,1)");

      ctx.globalAlpha = a * 0.35;
      this.drawBoltPath(ctx, b.pts, 6, "rgba(100,190,255,1)");

      ctx.globalAlpha = a * 0.9;
      ctx.shadowBlur = 18;
      ctx.shadowColor = `rgba(160,220,255,${a})`;
      this.drawBoltPath(ctx, b.pts, 1.5, `rgba(220,240,255,${a})`);

      for (const br of b.branches) {
        if (br.life <= 0) continue;
        ctx.globalAlpha = br.alpha * br.life * 0.6;
        this.drawBoltPath(ctx, br.pts, 3, "rgba(80,160,255,1)");
        ctx.globalAlpha = br.alpha * br.life * 0.9;
        ctx.shadowBlur = 8;
        ctx.shadowColor = `rgba(140,210,255,${br.life})`;
        this.drawBoltPath(ctx, br.pts, 0.8, `rgba(200,230,255,${br.life})`);
      }
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

class DistantFlicker {
  constructor(getSize) {
    this.getSize = getSize;
    this.flickers = [];
    this.next = rand(1200, 3000);
    this.elapsed = 0;
  }

  update(dt) {
    const { W } = this.getSize();
    this.elapsed += dt;
    if (this.elapsed > this.next) {
      this.flickers.push({ x: rand(0, W), alpha: rand(0.03, 0.08), decay: rand(0.008, 0.018) });
      this.elapsed = 0;
      this.next = rand(800, 2500);
    }
    this.flickers = this.flickers.filter((f) => {
      f.alpha -= f.decay;
      return f.alpha > 0;
    });
  }

  draw(ctx) {
    const { H, W } = this.getSize();
    for (const f of this.flickers) {
      const g = ctx.createRadialGradient(f.x, H * 0.3, 0, f.x, H * 0.3, W * 0.35);
      g.addColorStop(0, `rgba(60,120,255,${f.alpha})`);
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H * 0.75);
    }
  }
}

function drawHorizon(ctx, W, H, t) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#000305");
  sky.addColorStop(0.35, "#010810");
  sky.addColorStop(0.65, "#020c18");
  sky.addColorStop(1, "#030f1a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  const pulse = 0.5 + 0.5 * Math.sin(t * 0.0004);
  const hz = ctx.createLinearGradient(0, H * 0.55, 0, H * 0.85);
  hz.addColorStop(0, `rgba(10,50,120,${0.04 + pulse * 0.04})`);
  hz.addColorStop(0.5, `rgba(5,30,80,${0.06 + pulse * 0.03})`);
  hz.addColorStop(1, "transparent");
  ctx.fillStyle = hz;
  ctx.fillRect(0, H * 0.55, W, H * 0.3);
}

function drawGroundReflection(ctx, W, H) {
  const g = ctx.createLinearGradient(0, H * 0.82, 0, H);
  g.addColorStop(0, "rgba(0,20,60,0.0)");
  g.addColorStop(0.4, "rgba(0,15,50,0.12)");
  g.addColorStop(1, "rgba(0,5,20,0.3)");
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.82, W, H * 0.18);
}

export default function AzulaThemeBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    let W = 0;
    let H = 0;
    let frame = 0;
    let last = 0;
    const timers = new Set();

    const addTimer = (id) => timers.add(id);
    const getSize = () => ({ W, H });
    const resize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };

    resize();
    window.addEventListener("resize", resize);

    const clouds = new CloudSystem(getSize);
    const rain = new Rain(getSize);
    const lightning = new LightningSystem(getSize, addTimer);
    const distant = new DistantFlicker(getSize);

    const loop = (ts) => {
      const dt = ts - last;
      last = ts;

      drawHorizon(ctx, W, H, ts);
      distant.update(dt);
      distant.draw(ctx);
      clouds.update();
      clouds.draw(ctx);
      rain.update();
      rain.draw(ctx);
      drawGroundReflection(ctx, W, H);
      lightning.update(dt);
      lightning.draw(ctx);

      frame = window.requestAnimationFrame(loop);
    };

    frame = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <canvas ref={canvasRef} className="fixed inset-0 block h-full w-full" />
      <div
        className="fixed inset-0 z-[1]"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\' opacity=\'1\'/%3E%3C/svg%3E")',
          opacity: 0.04,
        }}
      />
    </div>
  );
}
