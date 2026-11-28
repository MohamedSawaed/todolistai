"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { cx } from "../ui";
import { usePrefs } from "../providers";
import type { MascotState } from "@/lib/mascot";

/**
 * The Thinking Blob — PlanMind's assistant character, drawn from the official reference as
 * separate layers (body, arms, eyes, brows, mouth, checklist, orbit, sparkle) so each part can
 * move on its own. The silhouette, eyes and colours never change between states; only the
 * expression and posture do. Motion is CSS (see `.tb` in globals.css): it pauses when the
 * character is offscreen or the tab is hidden, and stops for reduced motion or when the user
 * turns animation off in Settings.
 */
export function ThinkingBlob({
  state = "idle",
  size = 48,
  still = false,
  label,
  decorative = false,
  className,
}: {
  state?: MascotState;
  size?: number;
  /** No animation — logos, lists, notifications. */
  still?: boolean;
  /** Accessible name when the character conveys something; omit when decorative. */
  label?: string;
  /** Hidden entirely (instead of a plain icon) when the user turns the character off. */
  decorative?: boolean;
  className?: string;
}) {
  const { prefs } = usePrefs();
  const id = useId().replace(/:/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const paused = usePaused(ref, still);
  const m = prefs.mascot;

  if (!m.show) {
    if (decorative) return null;
    // the character is off: keep a neutral assistant marker so layouts and meaning stay intact
    return (
      <span className={cx("grid shrink-0 place-items-center rounded-xl bg-primary-soft text-primary", className)} style={{ width: size, height: size }} aria-label={label} role={label ? "img" : undefined}>
        <Sparkles style={{ width: size * 0.5, height: size * 0.5 }} aria-hidden />
      </span>
    );
  }

  const motion = still || m.motion === "off" ? "off" : m.motion;
  const detail = size >= 56 ? "full" : size >= 30 ? "medium" : "tiny";
  const e = EXPRESSIONS[state];

  return (
    <svg
      ref={ref}
      viewBox="180 130 900 900"
      width={size}
      height={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-state={state}
      data-motion={motion}
      data-paused={paused || undefined}
      className={cx("tb pointer-events-none shrink-0 overflow-visible select-none", className)}
    >
      <defs>
        <radialGradient id={`${id}b`} gradientUnits="userSpaceOnUse" cx="690" cy="380" r="640">
          <stop offset="0%" stopColor="#f6e6ff" />
          <stop offset="38%" stopColor="#e1bffb" />
          <stop offset="72%" stopColor="#b685f0" />
          <stop offset="100%" stopColor="#7b47c9" />
        </radialGradient>
        <linearGradient id={`${id}s`} x1="0.2" y1="0.2" x2="0.75" y2="1">
          <stop offset="55%" stopColor="#5b2aa6" stopOpacity="0" />
          <stop offset="100%" stopColor="#4a1d8f" stopOpacity="0.55" />
        </linearGradient>
        <radialGradient id={`${id}e`} cx="50%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#1c0446" />
          <stop offset="62%" stopColor="#2c0a63" />
          <stop offset="100%" stopColor="#7c22d2" />
        </radialGradient>
        <radialGradient id={`${id}g`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a35cff" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#8a46f0" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#8a46f0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}fl`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#b77bff" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#7b3fe0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#d9a8ff" stopOpacity="0.95" />
          <stop offset="50%" stopColor="#c27dff" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#e6c2ff" stopOpacity="0.95" />
        </linearGradient>
        {detail !== "tiny" ? (
          <filter id={`${id}f`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="22" />
          </filter>
        ) : null}
      </defs>

      {/* presence: aura and the light it casts on the floor */}
      <ellipse className="tb-aura" cx="630" cy="600" rx="430" ry="430" fill={`url(#${id}g)`} />
      <ellipse className="tb-floor" cx="625" cy="1004" rx="270" ry="34" fill={`url(#${id}fl)`} />

      {/* the orbit passes behind the body */}
      {detail !== "tiny" ? (
        <g className="tb-ring">
          {detail === "full" ? <ellipse cx="630" cy="712" rx="410" ry="96" transform="rotate(-14.8 630 712)" fill="none" stroke="#c07bff" strokeWidth="22" opacity="0.35" filter={`url(#${id}f)`} /> : null}
          <ellipse cx="630" cy="712" rx="410" ry="96" transform="rotate(-14.8 630 712)" fill="none" stroke={`url(#${id}r)`} strokeWidth="8" />
        </g>
      ) : null}

      <g className="tb-float">
        <g className="tb-pose">
          {detail !== "tiny" ? <path d={SILHOUETTE} fill="#b36cff" opacity="0.55" filter={`url(#${id}f)`} /> : null}

          {/* arms (separate, so they can gesture) */}
          <path className="tb-arm-l" d={ARM_L} fill={`url(#${id}b)`} stroke="#8752d4" strokeOpacity="0.35" strokeWidth="4" />
          <path className="tb-arm-r" d={ARM_R} fill={`url(#${id}b)`} stroke="#8752d4" strokeOpacity="0.35" strokeWidth="4" />

          <g className="tb-body">
            <path d={BODY} fill={`url(#${id}b)`} />
            <path d={BODY} fill={`url(#${id}s)`} />
            {/* glowing rim, as in the reference render */}
            <path d={BODY} fill="none" stroke="#e7cbff" strokeWidth="6" opacity="0.55" />
            {/* soft top light on the curl and crown */}
            <ellipse cx="600" cy="300" rx="120" ry="70" transform="rotate(-18 600 300)" fill="#fff" opacity="0.22" />

            {/* face */}
            <g className="tb-face" style={{ transform: `translate(${e.look[0]}px, ${e.look[1]}px)` }}>
              <g className="tb-eyes">
                {(
                  [
                    [528, 560, 52, 56, e.lidL ?? 0],
                    [760, 550, 48, 53, e.lidR ?? 0],
                  ] as const
                ).map(([cx, cy, rx, ry, lid], i) => (
                  <g key={i} className="tb-eye" style={{ transformOrigin: `${cx}px ${cy}px` }}>
                    <ellipse cx={cx} cy={cy} rx={rx * e.eyeScale} ry={ry * e.eyeScale} fill={`url(#${id}e)`} />
                    <circle cx={cx + 18} cy={cy - 24} r={13 * e.eyeScale} fill="#fff" />
                    <circle cx={cx - 16} cy={cy + 20} r={5.5} fill="#fff" opacity="0.7" />
                    {/* lids: lowered when resting, lifted from below when pleased */}
                    {lid ? (
                      <>
                        <path d={`M${cx - rx - 8} ${cy - ry - 12}H${cx + rx + 8}V${cy - ry + 2 * ry * lid}Q${cx} ${cy - ry + 2 * ry * lid + 16} ${cx - rx - 8} ${cy - ry + 2 * ry * lid}Z`} fill={`url(#${id}b)`} />
                        <path d={`M${cx - rx + 4} ${cy - ry + 2 * ry * lid + 3}Q${cx} ${cy - ry + 2 * ry * lid + 15} ${cx + rx - 4} ${cy - ry + 2 * ry * lid + 3}`} fill="none" stroke="#6c36b8" strokeWidth="5" strokeLinecap="round" opacity="0.55" />
                      </>
                    ) : null}
                    {e.happy ? <path d={`M${cx - rx - 10} ${cy + ry + 8}Q${cx} ${cy + ry * 0.1} ${cx + rx + 10} ${cy + ry + 8}Z`} fill={`url(#${id}b)`} /> : null}
                  </g>
                ))}
              </g>
              {/* brows: soft embossed ridges */}
              <g fill="none" strokeLinecap="round">
                <path className="tb-brow" d={e.browL} stroke="#7c47c4" strokeOpacity="0.45" strokeWidth="20" transform="translate(0 4)" />
                <path className="tb-brow" d={e.browR} stroke="#7c47c4" strokeOpacity="0.45" strokeWidth="18" transform="translate(0 4)" />
                <path className="tb-brow" d={e.browL} stroke="#c896fa" strokeWidth="18" />
                <path className="tb-brow" d={e.browR} stroke="#c896fa" strokeWidth="16" />
              </g>
              <path className="tb-mouth" d={e.mouth} fill={e.mouthFill ? "#2a0b5e" : "none"} stroke="#2a0b5e" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            </g>

            {/* the checklist it carries */}
            {detail === "full" || detail === "medium" ? (
              <g className="tb-list">
                {[745, 800, 855].map((y, i) => (
                  <g key={y} className="tb-check" style={{ animationDelay: `${i * 120}ms` }}>
                    <circle cx={570 - i * 2} cy={y} r="20" fill="#ecd5fd" />
                    <path d={`M${560 - i * 2} ${y}l7 7 12-14`} fill="none" stroke="#9452e2" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
                    <rect x={612 - i * 2} y={y - 11} width={detail === "full" ? 122 - i * 6 : 110} height="22" rx="11" fill="#f0dbfe" opacity="0.95" />
                  </g>
                ))}
              </g>
            ) : null}
          </g>
        </g>
      </g>

      {/* the spark of an idea */}
      {detail !== "tiny" ? <path className="tb-spark" d={star(885, 295, 46)} fill="#fbe4fe" /> : null}
      {/* conflict marker: amber, small, never flashing */}
      {state === "conflict" && detail !== "tiny" ? <circle className="tb-alert" cx="905" cy="430" r="20" fill="#f5b45a" stroke="#fff3df" strokeWidth="5" /> : null}
      {/* goal completed: a few restrained particles and a soft ring */}
      {state === "goal-completed" && detail !== "tiny" ? (
        <g className="tb-confetti" fill="#f2d9ff">
          <path className="tb-p1" d={star(390, 330, 26)} />
          <path className="tb-p2" d={star(980, 470, 20)} />
          <circle className="tb-p3" cx="300" cy="560" r="10" />
          <ellipse className="tb-halo" cx="630" cy="600" rx="380" ry="380" fill="none" stroke="#d7b0ff" strokeWidth="4" />
        </g>
      ) : null}
      {/* listening / speaking: soft ripples beside it */}
      {(state === "listening" || state === "speaking") && detail !== "tiny" ? (
        <g className="tb-waves" fill="none" stroke="#c79aff" strokeWidth="8" strokeLinecap="round">
          <path className="tb-w1" d="M955 560q30 45 0 90" />
          <path className="tb-w2" d="M995 525q48 80 0 160" />
          <path className="tb-w1" d="M305 560q-30 45 0 90" />
          <path className="tb-w2" d="M265 525q-48 80 0 160" />
        </g>
      ) : null}
    </svg>
  );
}

/** Pause animation while offscreen or in a background tab (saves battery). */
function usePaused(ref: React.RefObject<SVGSVGElement | null>, still: boolean) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || still) return;
    let visible = true;
    const update = () => setPaused(!visible || document.visibilityState === "hidden");
    const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([en]) => ((visible = en.isIntersecting), update())) : null;
    io?.observe(el);
    document.addEventListener("visibilitychange", update);
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [ref, still]);
  return paused;
}

function star(x: number, y: number, s: number) {
  const k = s * 0.14;
  return `M${x} ${y - s}C${x + k} ${y - k} ${x + k} ${y - k} ${x + s} ${y}C${x + k} ${y + k} ${x + k} ${y + k} ${x} ${y + s}C${x - k} ${y + k} ${x - k} ${y + k} ${x - s} ${y}C${x - k} ${y - k} ${x - k} ${y - k} ${x} ${y - s}Z`;
}

// ---- geometry, traced from the official reference (1254 × 1254 artboard) ----
/** Head and body: the curl at the top-left is the character's signature. */
const BODY =
  "M520 176C562 166 622 172 668 200C762 252 862 332 902 470C924 545 924 610 905 650C890 688 870 710 856 725C842 770 832 830 826 890C818 930 812 960 812 985C810 1002 762 1006 720 1003C686 1000 666 986 658 958C650 928 608 928 600 958C592 986 570 1002 520 1003C470 1004 438 998 436 975C432 940 424 905 418 880C412 830 408 770 405 725C376 700 340 660 326 615C314 570 322 500 352 452C390 390 450 346 490 320C516 302 535 282 536 262C537 245 520 232 508 215C497 200 500 181 520 176Z";
const ARM_L = "M418 732C380 748 340 790 340 832C340 866 368 884 396 874C418 866 428 842 428 816Z";
const ARM_R = "M846 722C882 742 912 788 913 832C914 866 888 884 860 876C838 870 830 846 830 820Z";
const SILHOUETTE = BODY;

interface Expression {
  browL: string;
  browR: string;
  mouth: string;
  mouthFill?: boolean;
  /** Pupil direction in artboard units. */
  look: [number, number];
  eyeScale: number;
  /** 0..1 how far each upper lid comes down. */
  lidL?: number;
  lidR?: number;
  happy?: boolean;
}

// The reference expression: one brow low and knowing, one raised, a small confident smile.
const IDLE: Expression = { browL: "M466 500Q526 478 586 494", browR: "M703 438Q745 394 790 408", mouth: "M614 612Q648 632 692 608", look: [0, 0], eyeScale: 1, lidL: 0.3 };

export const EXPRESSIONS: Record<MascotState, Expression> = {
  idle: IDLE,
  thinking: { browL: "M468 497Q526 476 584 489", browR: "M703 426Q746 380 792 397", mouth: "M630 618Q652 625 674 615", look: [8, -10], eyeScale: 1, lidL: 0.2 },
  listening: { browL: "M470 490Q526 470 584 482", browR: "M703 432Q746 404 790 416", mouth: "M624 610Q648 622 672 609", look: [0, -2], eyeScale: 1.03 },
  speaking: { browL: "M470 494Q526 474 584 486", browR: "M703 432Q746 400 790 413", mouth: "M630 606Q650 630 672 606Q650 616 630 606Z", mouthFill: true, look: [0, 0], eyeScale: 1 },
  conflict: { browL: "M470 482Q526 460 584 472", browR: "M703 422Q746 384 792 398", mouth: "M628 616Q651 619 674 614", look: [10, 0], eyeScale: 1.08 },
  "suggestion-ready": { browL: "M468 496Q526 474 584 489", browR: "M703 430Q746 388 790 404", mouth: "M606 608Q646 638 694 605", look: [4, -2], eyeScale: 1.04, lidL: 0.15 },
  success: { browL: "M470 490Q526 468 584 482", browR: "M703 430Q746 396 790 410", mouth: "M602 602Q648 642 698 598", look: [0, 0], eyeScale: 1, happy: true },
  "goal-completed": { browL: "M470 478Q526 456 584 470", browR: "M703 418Q746 378 792 394", mouth: "M612 600Q648 646 690 600Q648 618 612 600Z", mouthFill: true, look: [0, -4], eyeScale: 1.06 },
  resting: { browL: "M470 500Q526 488 584 497", browR: "M703 446Q746 430 790 440", mouth: "M626 610Q650 622 674 610", look: [0, 4], eyeScale: 1, lidL: 0.52, lidR: 0.5 },
  error: { browL: "M470 503Q522 494 584 478", browR: "M703 420Q746 426 790 442", mouth: "M626 622Q650 606 676 620", look: [0, 6], eyeScale: 0.98, lidL: 0.15, lidR: 0.15 },
};
