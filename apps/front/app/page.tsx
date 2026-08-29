'use client';

import { useState } from 'react';
import RippleDistortion from './RippleDistortion';

const Arrow = () => <span aria-hidden="true">↗</span>;

export default function Home() {
  const [orbActive, setOrbActive] = useState(false);

  return (
    <main className="hero-shell">
      <RippleDistortion
        src="/hero-v2.png"
        brushSize={97.5}
        strength={0.105}
        swirl={1}
        rings={2.5}
        grayscale
        spread={5.75}
      />

      <div className="hero-vignette" aria-hidden="true" />
      <div className="film-grain" aria-hidden="true" />

      <nav className="site-nav" aria-label="主导航">
        <a className="wordmark" href="#top" aria-label="ECHOMERE 洄映首页">
          <span>ECHOMERE</span>
          <i aria-hidden="true" />
          <em>洄映</em>
        </a>
        <a className="enter-link" href="/login">
          进入洄映 <Arrow />
        </a>
      </nav>

      <section className="hero-content" id="top">
        <div className="hero-copy" id="begin">
          <p className="kicker">ECHO · WATER · MIRROR</p>
          <h1><span>一念成漪</span><span>照见未见</span></h1>
          <p className="intro">
            以八字与星盘为双重映照，<br />
            于时间的回响中，辨认此刻的自己。
          </p>
        </div>

      </section>

      <div className="echo-orb-stage">
        <button
          className={`echo-orb${orbActive ? ' is-active' : ''}`}
          type="button"
          aria-label="建立回响"
          aria-pressed={orbActive}
          onClick={() => {
            setOrbActive(true);
            window.setTimeout(() => window.location.assign('/login'), 360);
          }}
        >
          <span className="orb-aura" aria-hidden="true" />
          <span className="orb-flow flow-one" aria-hidden="true" />
          <span className="orb-flow flow-two" aria-hidden="true" />
          <span className="orb-flow flow-three" aria-hidden="true" />
          <span className="orb-copy">
            <span>建立回响</span>
          </span>
        </button>
      </div>

      <div className="surface-note" aria-hidden="true">
        <span>MOVE TO DISTURB THE SURFACE</span>
        <i />
        <span>23° 08′</span>
      </div>
    </main>
  );
}
