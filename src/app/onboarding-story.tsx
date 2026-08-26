"use client";

import { useEffect, useRef } from "react";
import styles from "./onboarding-story.module.css";

export default function OnboardingStory({ onFinish }: { onFinish: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onFinishRef = useRef(onFinish);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    var TOTAL = 5;
    var phone3d = container.querySelector<HTMLElement>("#phone3d");
    var storybar = container.querySelector<HTMLElement>("#storybar");
    if (!phone3d || !storybar) return;

    var blocks = Array.prototype.slice.call(
      container.querySelectorAll(`.${styles["screen"]} .${styles["block"]}`)
    ) as HTMLElement[];
    var segs = Array.prototype.slice.call(
      storybar.querySelectorAll(`.${styles["seg"]}`)
    ) as HTMLElement[];
    var tapLeft = container.querySelector<HTMLElement>("#tapLeft");
    var tapRight = container.querySelector<HTMLElement>("#tapRight");
    if (!tapLeft || !tapRight) return;

    var current = 0;
    var timer: ReturnType<typeof setTimeout> | null = null;
    var paused = false;
    var isTransitioning = false;
    var tapQueue: number[] = [];
    var MAX_QUEUED = 5; // hard cap so a burst of taps can't pile up indefinitely
    var TRANSITION_MS = 700; // matches the .7s transform transition below

    // Every timeout/rAF the engine schedules is tracked here so the cleanup
    // function can cancel anything still pending after unmount.
    var pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
    var pendingFrames = new Set<number>();

    function trackedTimeout(fn: () => void, ms: number) {
      var id = setTimeout(function () {
        pendingTimeouts.delete(id);
        fn();
      }, ms);
      pendingTimeouts.add(id);
      return id;
    }

    function trackedRAF(fn: () => void) {
      var id = requestAnimationFrame(function () {
        pendingFrames.delete(id);
        fn();
      });
      pendingFrames.add(id);
      return id;
    }

    function setPlay(state: string) {
      document.documentElement.style.setProperty("--play", state);
    }

    function forceReflow(el: HTMLElement) {
      void el.offsetWidth;
    }

    function updateStorybar(index: number) {
      segs.forEach(function (seg, i) {
        seg.classList.remove(styles["active"], styles["done"]);
        var fill = seg.querySelector<HTMLElement>(`.${styles["seg-fill"]}`);
        if (!fill) return;
        // reset animation so it can restart cleanly
        fill.style.animation = "none";
        forceReflow(fill);
        fill.style.animation = "";
        if (i < index) {
          seg.classList.add(styles["done"]);
        } else if (i === index) {
          seg.classList.add(styles["active"]);
          var block = blocks[index];
          var dur = block ? block.dataset.duration || "3000" : "3000";
          fill.style.animationDuration = dur + "ms";
        }
      });
    }

    function updateBarTheme(block: HTMLElement | undefined) {
      // Convention: a block may set data-dark="0" to indicate it sits on a
      // light background, in which case the storybar switches to a dark-on-light
      // variant. Missing/other values default to dark(1) — i.e. the normal
      // white-on-dark storybar — so nothing breaks if a block omits it.
      var isDark = !block || block.dataset.dark !== "0";
      phone3d!.classList.toggle(styles["light-bar"], !isDark);
    }

    function restingTransform(direction: number) {
      // Matches the end-state of the "outgoing" half of activate(), used to
      // pre-hide all non-active blocks on init without a flash.
      return {
        origin: direction > 0 ? "right center" : "left center",
        transform:
          "rotateY(" + (direction > 0 ? -110 : 110) + "deg) translateZ(-60px)",
        opacity: "0",
      };
    }

    function queueNext(ms: number) {
      if (timer) clearTimeout(timer);
      timer = trackedTimeout(function () {
        requestStep(1);
      }, ms);
    }

    // Single choke point for every navigation request (taps + autoplay). While
    // a flip is already in flight, new requests queue instead of overlapping —
    // overlapping activate() calls on the same elements is exactly what caused
    // the rapid-tap race (a stale rAF from an earlier call re-showing a block
    // a later call had already hidden). The target index is resolved lazily,
    // at the moment each queued step actually runs, so "tap right twice fast"
    // still lands on current+2, not current+1 twice.
    function requestStep(direction: number) {
      if (isTransitioning) {
        if (tapQueue.length < MAX_QUEUED) tapQueue.push(direction);
        return;
      }
      // Story plays through once: no wraparound. A backward tap on the first
      // block is a no-op; a forward step off the last block hands control
      // back to the caller instead of looping to block 0.
      if (direction < 0 && current === 0) {
        return;
      }
      if (direction > 0 && current === TOTAL - 1) {
        onFinishRef.current();
        return;
      }
      var target = (current + direction + TOTAL) % TOTAL;
      activate(target, direction);
    }

    function drainQueue() {
      if (paused || !tapQueue.length) return; // held pause freezes queued taps too; resume() drains them
      var direction = tapQueue.shift()!;
      requestStep(direction);
    }

    function activate(index: number, direction: number) {
      var prevIndex = current;
      var prev = blocks[prevIndex];
      var next = blocks[index];
      if (!next) return;
      isTransitioning = true;

      if (prev && prev !== next) {
        prev.style.transformOrigin = direction > 0 ? "right center" : "left center";
        prev.style.transition = "transform .7s cubic-bezier(.4,0,.2,1), opacity .5s";
        prev.style.transform =
          "rotateY(" + (direction > 0 ? -110 : 110) + "deg) translateZ(-60px)";
        prev.style.opacity = "0";
        prev.style.zIndex = "1";
        (function (el: HTMLElement) {
          trackedTimeout(function () {
            el.style.pointerEvents = "none";
          }, 700);
        })(prev);
      }

      next.style.transition = "none";
      next.style.transformOrigin = direction > 0 ? "left center" : "right center";
      next.style.transform =
        "rotateY(" + (direction > 0 ? 110 : -110) + "deg) translateZ(-60px)";
      next.style.opacity = "0";
      next.style.zIndex = "2";
      next.style.pointerEvents = "auto";
      forceReflow(next);

      next.classList.remove(styles["showing"]);
      forceReflow(next);
      next.classList.add(styles["showing"]);

      trackedRAF(function () {
        trackedRAF(function () {
          next.style.transition = "transform .7s cubic-bezier(.4,0,.2,1), opacity .5s";
          next.style.transform = "rotateY(0deg) translateZ(0)";
          next.style.opacity = "1";
        });
      });

      current = index;
      updateStorybar(index);
      updateBarTheme(next);

      if (!paused) {
        var dur = parseInt(next.dataset.duration || "3000", 10);
        queueNext(dur);
      }

      trackedTimeout(function () {
        isTransitioning = false;
        drainQueue();
      }, TRANSITION_MS);
    }

    function pause() {
      if (paused) return;
      paused = true;
      if (timer) clearTimeout(timer);
      setPlay("paused");
      phone3d!.style.animationPlayState = "paused";
    }

    function resume() {
      if (!paused) return;
      paused = false;
      setPlay("running");
      phone3d!.style.animationPlayState = "running";
      if (tapQueue.length) {
        drainQueue();
        return;
      } // queued taps take priority over resuming autoplay
      var block = blocks[current];
      var dur = block ? parseInt(block.dataset.duration || "3000", 10) : 3000;
      queueNext(Math.round(dur * 0.4));
    }

    function initFirst() {
      // Pre-hide every block except index 0 in its resting "not showing" state.
      blocks.forEach(function (block, i) {
        if (i === 0) return;
        var rest = restingTransform(1);
        block.style.transition = "none";
        block.style.transformOrigin = rest.origin;
        block.style.transform = rest.transform;
        block.style.opacity = rest.opacity;
        block.style.zIndex = "1";
        block.style.pointerEvents = "none";
      });

      var first = blocks[0];
      if (!first) return;
      first.style.transition = "none";
      first.style.transformOrigin = "center center";
      first.style.transform = "rotateY(0deg) translateZ(0)";
      first.style.opacity = "1";
      first.style.zIndex = "2";
      first.style.pointerEvents = "auto";
      forceReflow(first);
      first.classList.remove(styles["showing"]);
      forceReflow(first);
      first.classList.add(styles["showing"]);

      current = 0;
      updateStorybar(0);
      updateBarTheme(first);

      var dur = parseInt(first.dataset.duration || "3000", 10);
      queueNext(dur);
    }

    // Pointer handling: tap (< 260ms) navigates, hold (>= 260ms) pauses/resumes.
    function wireTapZone(el: HTMLElement, direction: number) {
      var downAt = 0;
      var onPointerDown = function () {
        downAt = Date.now();
        pause();
      };
      var onPointerUp = function () {
        var elapsed = Date.now() - downAt;
        if (elapsed < 260) {
          // resume() before navigating so a normal tap re-queues autoplay;
          // requestStep() resolves the target index itself, freshly, so a
          // burst of taps steps once per tap instead of racing/collapsing.
          paused = false;
          setPlay("running");
          phone3d!.style.animationPlayState = "running";
          requestStep(direction);
        } else {
          resume();
        }
      };
      var onPointerLeave = function () {
        if (paused) resume();
      };
      var onPointerCancel = function () {
        if (paused) resume();
      };
      el.addEventListener("pointerdown", onPointerDown);
      el.addEventListener("pointerup", onPointerUp);
      el.addEventListener("pointerleave", onPointerLeave);
      el.addEventListener("pointercancel", onPointerCancel);
      return function unwire() {
        el.removeEventListener("pointerdown", onPointerDown);
        el.removeEventListener("pointerup", onPointerUp);
        el.removeEventListener("pointerleave", onPointerLeave);
        el.removeEventListener("pointercancel", onPointerCancel);
      };
    }

    var unwireLeft = wireTapZone(tapLeft, -1);
    var unwireRight = wireTapZone(tapRight, 1);

    initFirst();

    return function cleanup() {
      unwireLeft();
      unwireRight();
      if (timer) clearTimeout(timer);
      pendingTimeouts.forEach(function (id) {
        clearTimeout(id);
      });
      pendingTimeouts.clear();
      pendingFrames.forEach(function (id) {
        cancelAnimationFrame(id);
      });
      pendingFrames.clear();
    };
  }, []);

  return (
    <div ref={containerRef}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <linearGradient id="screens-wallGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4c443d" />
            <stop offset="1" stopColor="#221d1a" />
          </linearGradient>
          <linearGradient id="screens-shelfWood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8a6b4f" />
            <stop offset="1" stopColor="#5e4732" />
          </linearGradient>
          <symbol id="shelf-scene-screens" viewBox="0 0 400 700">
            <rect width="400" height="700" fill="url(#screens-wallGrad)" />
            <g opacity=".5">
              <rect x="14" y="120" width="66" height="120" rx="8" fill="#c8a15c" />
              <rect x="98" y="104" width="60" height="140" rx="8" fill="#8fae7a" />
              <rect x="300" y="112" width="68" height="132" rx="8" fill="#b9705f" />
              <rect x="220" y="96" width="58" height="150" rx="8" fill="#7d93b8" />
            </g>
            <rect x="0" y="430" width="400" height="24" fill="url(#screens-shelfWood)" />
            <rect x="0" y="430" width="400" height="4" fill="#a3855f" opacity=".6" />
            <g>
              <rect x="34" y="230" width="56" height="196" rx="14" fill="#3f8f5c" />
              <rect x="52" y="205" width="20" height="34" rx="6" fill="#2c6b43" />
              <rect x="42" y="300" width="40" height="58" rx="6" fill="#ffffff" opacity=".92" />
              <rect x="48" y="316" width="28" height="4" rx="2" fill="#3f8f5c" />
              <rect x="48" y="326" width="20" height="4" rx="2" fill="#8fc7a3" />
              <rect x="112" y="260" width="92" height="166" rx="10" fill="#e0523f" />
              <rect x="126" y="284" width="64" height="46" rx="6" fill="#ffffff" opacity=".94" />
              <rect x="134" y="298" width="44" height="5" rx="2.5" fill="#e0523f" />
              <rect x="134" y="310" width="30" height="5" rx="2.5" fill="#f2a89c" />
              <rect x="222" y="250" width="86" height="176" rx="10" fill="#eec24a" />
              <rect x="236" y="272" width="58" height="42" rx="6" fill="#ffffff" opacity=".94" />
              <rect x="244" y="286" width="40" height="5" rx="2.5" fill="#c99423" />
              <rect x="244" y="297" width="26" height="5" rx="2.5" fill="#f2d998" />
              <rect x="326" y="286" width="50" height="140" rx="10" fill="#3d6fce" />
              <rect x="326" y="316" width="50" height="34" fill="#ffffff" opacity=".92" />
              <rect x="334" y="326" width="34" height="5" rx="2.5" fill="#3d6fce" />
              <rect x="334" y="336" width="22" height="5" rx="2.5" fill="#9ab6ea" />
            </g>
            <g opacity=".22">
              <rect x="0" y="0" width="400" height="700" fill="url(#screens-wallGrad)" />
            </g>
          </symbol>
        </defs>
      </svg>
      <div className={styles["stage"]}>
        <div className={styles["phone-3d"]} id="phone3d">
          <div className={styles["phone-shell"]}>
            <div className={styles["storybar"]} id="storybar">
              <div className={styles["seg"]}>
                <span className={styles["seg-fill"]}></span>
              </div>
              <div className={styles["seg"]}>
                <span className={styles["seg-fill"]}></span>
              </div>
              <div className={styles["seg"]}>
                <span className={styles["seg-fill"]}></span>
              </div>
              <div className={styles["seg"]}>
                <span className={styles["seg-fill"]}></span>
              </div>
              <div className={styles["seg"]}>
                <span className={styles["seg-fill"]}></span>
              </div>
            </div>
            <div className={styles["screen"]} id="screen">
              <div className={styles["block"]} id="block-camera-off" data-duration="2800" data-dark="0">
                <div className={styles["sky"]}></div>
                <div className={`${styles["topbar"]} ${styles["end"]}`}>
                  <span className={`${styles["glass"]} ${styles["flat"]}`}>
                    <svg viewBox="0 0 24 24">
                      <path d="m7 7 10 10M17 7 7 17" />
                    </svg>
                  </span>
                </div>
                <div className={styles["prompt"]}>
                  <strong className={styles["dark"]}>Scan products for sugar</strong>
                  <p className={styles["sub"]}>Point your camera at a shelf to check what&apos;s inside</p>
                  <button className={styles["on-light"]}>Start scanning</button>
                </div>
              </div>

              <div className={styles["block"]} id="block-girl-intro" data-duration="3500" data-dark="0">
                <div id="girl-intro-block">
                  <svg viewBox="210 0 560 650" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                      <linearGradient id="girl-bgWash" x1="0" y1="0" x2="0.3" y2="1">
                        <stop offset="0" stopColor="#E4EEFC" />
                        <stop offset="1" stopColor="#FFFDF9" />
                      </linearGradient>
                      <filter id="girl-chipShadow" x="-40%" y="-40%" width="180%" height="180%">
                        <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#17171B" floodOpacity="0.22" />
                      </filter>
                    </defs>

                    <rect x="0" y="0" width="900" height="650" fill="url(#girl-bgWash)" />
                    <line x1="40" y1="562" x2="860" y2="562" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" />

                    {/* ============ SHELF UNIT ============ */}
                    <g id="girl-shelf">
                      <line x1="590" y1="120" x2="590" y2="560" stroke="var(--ink)" strokeWidth="9" strokeLinecap="round" />
                      <line x1="820" y1="120" x2="820" y2="560" stroke="var(--ink)" strokeWidth="9" strokeLinecap="round" />
                      <line x1="580" y1="180" x2="830" y2="180" stroke="var(--ink)" strokeWidth="9" strokeLinecap="round" />
                      <line x1="580" y1="340" x2="830" y2="340" stroke="var(--ink)" strokeWidth="9" strokeLinecap="round" />
                      <line x1="580" y1="500" x2="830" y2="500" stroke="var(--ink)" strokeWidth="9" strokeLinecap="round" />

                      {/* top shelf */}
                      <rect x="615" y="130" width="40" height="50" rx="6" fill="var(--paper)" stroke="var(--ink)" strokeWidth="3.5" />
                      <rect x="668" y="122" width="34" height="58" rx="6" fill="var(--signal)" stroke="var(--ink)" strokeWidth="3.5" />
                      <rect x="715" y="135" width="42" height="45" rx="6" fill="var(--paper)" stroke="var(--ink)" strokeWidth="3.5" />
                      <rect x="770" y="128" width="36" height="52" rx="6" fill="var(--amber)" stroke="var(--ink)" strokeWidth="3.5" opacity="0.7" />

                      {/* middle shelf */}
                      <rect x="613" y="262" width="46" height="78" rx="8" fill="var(--paper)" stroke="var(--ink)" strokeWidth="4" />
                      <line x1="622" y1="282" x2="650" y2="282" stroke="var(--ink)" strokeWidth="3" />
                      <line x1="622" y1="296" x2="650" y2="296" stroke="var(--ink)" strokeWidth="3" />

                      {/* TARGET product: kept neutral so the green result-frame reads with contrast */}
                      <rect x="672" y="252" width="60" height="88" rx="10" fill="var(--paper)" stroke="var(--ink)" strokeWidth="4.5" />
                      <line x1="684" y1="278" x2="720" y2="278" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" />
                      <line x1="684" y1="294" x2="712" y2="294" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" />
                      <circle cx="702" cy="316" r="9" fill="var(--signal)" />

                      <rect x="748" y="266" width="44" height="74" rx="8" fill="var(--red)" stroke="var(--ink)" strokeWidth="4" opacity="0.85" />

                      {/* bottom shelf */}
                      <rect x="610" y="440" width="50" height="60" rx="8" fill="var(--signal)" stroke="var(--ink)" strokeWidth="3.5" />
                      <rect x="672" y="435" width="44" height="65" rx="8" fill="var(--paper)" stroke="var(--ink)" strokeWidth="3.5" />
                      <rect x="728" y="448" width="52" height="52" rx="8" fill="var(--amber)" stroke="var(--ink)" strokeWidth="3.5" opacity="0.7" />
                    </g>

                    {/* ===== result frame (green, app-style) + Low Sugar label ===== */}
                    <g id="girl-resultFrame">
                      <rect id="girl-frameGlow" x="656" y="236" width="92" height="120" rx="20" fill="none" stroke="var(--low)" strokeWidth="14" opacity="0.35" />
                      <rect x="664" y="244" width="76" height="104" rx="16" fill="var(--low)" fillOpacity="0.10" stroke="var(--low-deep)" strokeWidth="3.5" />
                    </g>
                    <g id="girl-labelPop" filter="url(#girl-chipShadow)">
                      <rect x="634" y="192" width="136" height="38" rx="19" fill="var(--paper)" />
                      <circle cx="657" cy="211" r="5.5" fill="var(--low-deep)" />
                      <text x="670" y="217" fontSize="16.5" fontWeight="800" fill="var(--ink)">
                        Low Sugar
                      </text>
                    </g>

                    {/* scan beam */}
                    <g id="girl-beam">
                      <line id="girl-beamDash" x1="472" y1="228" x2="670" y2="292" stroke="var(--signal)" strokeWidth="4" strokeLinecap="round" />
                    </g>

                    {/* ============ PERSON (woman) ============ */}
                    <g id="girl-person">
                      {/* back leg */}
                      <path d="M340,420 L322,558" fill="none" stroke="var(--ink)" strokeWidth="34" strokeLinecap="round" />
                      <ellipse cx="318" cy="562" rx="26" ry="13" fill="var(--ember)" stroke="var(--ink)" strokeWidth="4" />

                      {/* front leg */}
                      <path d="M368,420 L398,556" fill="none" stroke="var(--ink)" strokeWidth="34" strokeLinecap="round" />
                      <ellipse cx="402" cy="560" rx="26" ry="13" fill="var(--ember)" stroke="var(--ink)" strokeWidth="4" />

                      {/* resting back arm (hint) */}
                      <path d="M333,320 C316,348 312,378 322,404" fill="none" stroke="var(--skin)" strokeWidth="24" strokeLinecap="round" />
                      <circle cx="322" cy="406" r="14" fill="var(--skin)" stroke="var(--ink)" strokeWidth="3.5" />

                      {/* torso (dress-ish, slight taper) */}
                      <path
                        d="M312,300
                                 C300,300 296,320 298,345
                                 C300,378 296,404 292,424
                                 C292,430 414,430 414,424
                                 C410,404 406,378 408,345
                                 C410,320 406,300 394,300
                                 Z"
                        fill="var(--signal)"
                        stroke="var(--ink)"
                        strokeWidth="4.5"
                        strokeLinejoin="round"
                      />
                      <path d="M300,338 Q353,350 406,338" fill="none" stroke="var(--signal-dark)" strokeWidth="3" opacity="0.55" />

                      {/* neck */}
                      <rect x="337" y="266" width="30" height="38" rx="8" fill="var(--skin)" stroke="var(--ink)" strokeWidth="3.5" />

                      {/* head */}
                      <circle cx="352" cy="240" r="42" fill="var(--skin)" stroke="var(--ink)" strokeWidth="4.5" />

                      {/* hair: previous style, tail volume scaled down ~18% */}
                      <g transform="translate(308,232) scale(0.82) translate(-308,-232)">
                        <ellipse cx="303" cy="278" rx="42" ry="76" fill="var(--ink)" />
                        <path
                          d="M300,232
                                   C278,254 270,292 282,330
                                   C288,346 300,358 314,362
                                   C324,364 334,362 340,356
                                   C320,352 304,338 297,318
                                   C289,296 290,270 302,250
                                   C310,238 316,228 316,228
                                   C310,228 304,230 300,232 Z"
                          fill="var(--ink)"
                        />
                      </g>
                      <ellipse cx="352" cy="204" rx="49" ry="37" fill="var(--ink)" />
                      <path
                        d="M398,206
                                 C412,220 414,240 404,256
                                 C400,242 398,228 390,216
                                 C394,212 397,209 398,206 Z"
                        fill="var(--ink)"
                      />
                      <path
                        d="M394,222
                                 C400,234 399,248 390,258
                                 C388,246 386,234 380,224
                                 C385,222 390,222 394,222 Z"
                        fill="var(--ink)"
                      />

                      {/* face */}
                      <circle cx="338" cy="244" r="3.6" fill="var(--ink)" />
                      <circle cx="368" cy="244" r="3.6" fill="var(--ink)" />
                      <path d="M344,262 Q353,268 362,262" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />

                      {/* ===== raised arm + phone (animated group) ===== */}
                      <g id="girl-armGroup">
                        <path d="M369,312 C398,300 420,278 438,246" fill="none" stroke="var(--skin)" strokeWidth="25" strokeLinecap="round" />
                        <path d="M438,246 C448,236 456,232 468,230" fill="none" stroke="var(--skin)" strokeWidth="22" strokeLinecap="round" />
                        <circle cx="376" cy="316" r="17" fill="var(--signal-dark)" stroke="var(--ink)" strokeWidth="3.5" />

                        <circle cx="472" cy="228" r="15" fill="var(--skin)" stroke="var(--ink)" strokeWidth="3.5" />

                        <g transform="translate(472,228) rotate(-32)">
                          <rect x="-15" y="-30" width="34" height="58" rx="8" fill="var(--ink)" />
                          <rect x="-11" y="-24" width="26" height="42" rx="3" fill="var(--paper)" />
                          <circle cx="2" cy="22" r="2.6" fill="#D9D9DC" />
                          <g id="girl-phoneScanWrap">
                            <clipPath id="girl-screenClip">
                              <rect x="-11" y="-24" width="26" height="42" rx="3" />
                            </clipPath>
                            <g clipPath="url(#girl-screenClip)">
                              <rect id="girl-scanLine" x="-11" y="-26" width="26" height="4" fill="var(--signal)" />
                            </g>
                          </g>
                        </g>
                      </g>
                    </g>
                  </svg>
                </div>
              </div>

              <div className={styles["block"]} id="block-live-search" data-duration="3000">
                <svg className={styles["shelf-photo"]} viewBox="0 0 400 700" preserveAspectRatio="xMidYMid slice">
                  <use href="#shelf-scene-screens" />
                </svg>
                <div className={styles["vignette"]}></div>
                <div className={styles["topbar"]}>
                  <span className={`${styles["glass"]} ${styles["warm"]}`}>
                    <svg viewBox="0 0 24 24">
                      <path d="M9 3h6l-1 6h3l-7 12 1-8H8z" />
                    </svg>
                  </span>
                  <span className={styles["glass"]}>
                    <svg viewBox="0 0 24 24">
                      <path d="m7 7 10 10M17 7 7 17" />
                    </svg>
                  </span>
                </div>
                <div className={styles["guide"]}>
                  <div className={styles["scanline"]}></div>
                </div>
                <div className={styles["hint"]}>Point your camera at products</div>
                <span className={styles["gallery-btn"]}>
                  <svg viewBox="0 0 24 24">
                    <path d="M4 5h16v14H4zM7 15l3-3 2.5 2.5 2-2 2.5 2.5M8 9h.01" />
                  </svg>
                </span>
              </div>

              <div className={styles["block"]} id="block-analyzing-results" data-duration="3800">
                <div className={`${styles["fade-layer"]} ${styles["layer-analyzing"]}`}>
                  <svg className={`${styles["shelf-photo"]} ${styles["dim"]}`} viewBox="0 0 400 700" preserveAspectRatio="xMidYMid slice">
                    <use href="#shelf-scene-screens" />
                  </svg>
                  <div className={styles["dim-overlay"]}></div>
                  <div className={styles["vignette"]}></div>
                  <div className={`${styles["topbar"]} ${styles["end"]}`}>
                    <span className={styles["glass"]}>
                      <svg viewBox="0 0 24 24">
                        <path d="m7 7 10 10M17 7 7 17" />
                      </svg>
                    </span>
                  </div>
                  <span className={styles["spinner"]}></span>
                  <div className={styles["processing-pill"]}>
                    Product found — checking details…
                    <small>Photos are sent for analysis and are not saved.</small>
                  </div>
                </div>
                <div className={`${styles["fade-layer"]} ${styles["layer-results"]}`}>
                  <svg className={styles["shelf-photo"]} viewBox="0 0 400 700" preserveAspectRatio="xMidYMid slice">
                    <use href="#shelf-scene-screens" />
                  </svg>
                  <div className={styles["vignette"]}></div>
                  <div className={`${styles["topbar"]} ${styles["end"]}`}>
                    <span className={styles["glass"]}>
                      <svg viewBox="0 0 24 24">
                        <path d="m7 7 10 10M17 7 7 17" />
                      </svg>
                    </span>
                  </div>
                  <div className={`${styles["overlay"]} ${styles["g"]}`} style={{ left: "2%", top: "27%", width: "17%", height: "36%" }}>
                    <span className={styles["overlay-label"]}>Low</span>
                  </div>
                  <div className={`${styles["overlay"]} ${styles["r"]} ${styles["sel"]}`} style={{ left: "21%", top: "35%", width: "32%", height: "27%" }}>
                    <span className={styles["overlay-label"]}>Very high</span>
                    <span className={styles["overlay-check"]}>
                      <svg viewBox="0 0 24 24">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  </div>
                  <div className={`${styles["overlay"]} ${styles["o"]}`} style={{ left: "55%", top: "33%", width: "30%", height: "29%" }}>
                    <span className={styles["overlay-label"]}>High</span>
                  </div>
                  <span className={`${styles["gallery-btn"]} ${styles["faint"]}`}>
                    <svg viewBox="0 0 24 24">
                      <path d="M4 5h16v14H4zM7 15l3-3 2.5 2.5 2-2 2.5 2.5M8 9h.01" />
                    </svg>
                  </span>
                  <div className={styles["handle"]}>
                    <span className={styles["handle-dot"]}></span>
                    <span>3 products found</span>
                    <span className={styles["handle-detail"]}>Details</span>
                    <svg viewBox="0 0 24 24">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className={styles["block"]} id="block-results-sheet" data-duration="3500">
                <svg className={styles["shelf-photo"]} viewBox="0 0 400 700" preserveAspectRatio="xMidYMid slice">
                  <use href="#shelf-scene-screens" />
                </svg>
                <div className={styles["vignette"]}></div>
                <div className={`${styles["topbar"]} ${styles["end"]}`}>
                  <span className={styles["glass"]}>
                    <svg viewBox="0 0 24 24">
                      <path d="m7 7 10 10M17 7 7 17" />
                    </svg>
                  </span>
                </div>
                <div className={styles["sheet"]}>
                  <div className={styles["sheet-header"]}>
                    <span className={styles["sheet-grabber"]}></span>
                    <b>3 products found</b>
                    <span className={styles["sheet-close"]}>
                      <svg viewBox="0 0 24 24">
                        <path d="m7 7 10 10M17 7 7 17" />
                      </svg>
                    </span>
                  </div>
                  <p className={styles["sheet-intro"]}>Tap a product to see its sugar impact.</p>
                  <div className={`${styles["row"]} ${styles["r1"]}`}>
                    <div className={styles["row-main"]}>
                      <span className={`${styles["orb"]} ${styles["g"]}`}>
                        <svg viewBox="0 0 24 24">
                          <path d="M3 7l9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10" />
                        </svg>
                      </span>
                      <span className={styles["row-name"]}>
                        <strong>Oatly · Barista</strong>
                        <span className={`${styles["status-tag"]} ${styles["confirmed"]}`}>Confirmed</span>
                      </span>
                      <span className={styles["row-val"]}>
                        4g
                        <small>/100g</small>
                      </span>
                      <svg className={styles["row-chev"]} viewBox="0 0 24 24">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </div>
                  </div>
                  <div className={`${styles["row"]} ${styles["r2"]}`}>
                    <div className={styles["row-main"]}>
                      <span className={`${styles["orb"]} ${styles["o"]}`}>
                        <svg viewBox="0 0 24 24">
                          <path d="M3 7l9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10" />
                        </svg>
                      </span>
                      <span className={styles["row-name"]}>
                        <strong>Kellogg&apos;s · Corn Flakes</strong>
                        <span className={`${styles["status-tag"]} ${styles["estimate"]}`}>AI estimate</span>
                      </span>
                      <span className={styles["row-val"]}>
                        17g
                        <small>/100g</small>
                      </span>
                      <svg className={styles["row-chev"]} viewBox="0 0 24 24">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </div>
                  </div>
                  <div className={`${styles["row"]} ${styles["r3"]}`}>
                    <div className={styles["row-main"]}>
                      <span className={`${styles["orb"]} ${styles["r"]}`}>
                        <svg viewBox="0 0 24 24">
                          <path d="M3 7l9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10" />
                        </svg>
                      </span>
                      <span className={styles["row-name"]}>
                        <strong>Coca-Cola · Original</strong>
                        <span className={`${styles["status-tag"]} ${styles["confirmed"]}`}>Confirmed</span>
                      </span>
                      <span className={styles["row-val"]}>
                        39g
                        <small>/100g</small>
                      </span>
                      <svg className={styles["row-chev"]} viewBox="0 0 24 24">
                        <path d="m18 15-6-6-6 6" />
                      </svg>
                    </div>
                    <div className={styles["row-detail"]}>
                      <div style={{ display: "block" }}>
                        <div className={styles["meter-label"]}>
                          <span>Sugar level</span>
                          <strong>Very high sugar</strong>
                        </div>
                        <div className={styles["meter-track"]}>
                          <span className={styles["meter-marker"]} style={{ left: "92%" }}></span>
                        </div>
                      </div>
                      <div>
                        <span>Protein</span>
                        <strong>0g / 100g</strong>
                      </div>
                      <div>
                        <span>Source</span>
                        <strong>Open Food Facts</strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <button className={`${styles["tap-zone"]} ${styles["left"]}`} id="tapLeft" aria-label="Previous"></button>
            <button className={`${styles["tap-zone"]} ${styles["right"]}`} id="tapRight" aria-label="Next"></button>
          </div>
        </div>
      </div>
    </div>
  );
}
