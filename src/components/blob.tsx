"use client";
import { useId } from "react";
import { cx } from "./ui";

/**
 * The Thinking Blob — PlanMind's assistant, drawn as a small soft-bodied companion.
 *
 * One SVG, seven states. All motion is CSS (see `.blob-*` in globals.css): cheap, smooth,
 * and stopped automatically when the device asks for reduced motion. Every animation ends
 * on the resting pose, so a reduced-motion user still sees the right expression.
 */
export type BlobState = "idle" | "thinking" | "listening" | "responding" | "conflict" | "success" | "resting";

export function ThinkingBlob({
  state = "idle",
  size = 48,
  still = false,
  label,
  className,
}: {
  state?: BlobState;
  /** Rendered size in px. Below 32px the decorations (sparks, rings) are left out. */
  size?: number;
  /** No animation — for logos, icons and long lists. */
  still?: boolean;
  /** Accessible name; omit when the blob is decorative (the default). */
  label?: string;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const detailed = size >= 32;
  const eyes = state === "success" ? "happy" : state === "resting" ? "closed" : "open";

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-state={state}
      className={cx("blob shrink-0 overflow-visible", !still && "blob-live", className)}
    >
      <defs>
        <radialGradient id={`${id}-body`} cx="38%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#fffdf8" />
          <stop offset="45%" stopColor="#f3eefe" />
          <stop offset="80%" stopColor="#d8cdf7" />
          <stop offset="100%" stopColor="#b9a9ee" />
        </radialGradient>
        <radialGradient id={`${id}-aura`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#9d8cf5" stopOpacity="0.55" />
          <stop offset="60%" stopColor="#8d7ff0" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#8d7ff0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-core`} cx="50%" cy="78%" r="45%">
          <stop offset="0%" stopColor="#a796f7" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#a796f7" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* presence: a soft violet aura that brightens when it's busy */}
      <circle className="blob-aura" cx="50" cy="54" r="46" fill={`url(#${id}-aura)`} />

      {detailed && state === "listening" ? (
        <g fill="none" stroke="#a094f5" strokeWidth="1.2">
          <circle className="blob-ring" cx="50" cy="55" r="34" />
          <circle className="blob-ring blob-ring-2" cx="50" cy="55" r="34" />
        </g>
      ) : null}

      {/* ground shadow keeps it anchored while it floats */}
      <ellipse className="blob-shadow" cx="50" cy="91.5" rx="26" ry="3.2" fill="#1b1830" opacity="0.28" />

      <g className="blob-float">
        <g className="blob-body">
          <path
            d="M48 21C65 20 79 32 82.5 49 85.5 63 89 79 75 85.5 64 89 36 89 25.5 85.5 11.5 80 14 63 17.5 49 21 33 32 22 48 21Z"
            fill={`url(#${id}-body)`}
            stroke="#c8bcf5"
            strokeOpacity="0.55"
            strokeWidth="0.8"
          />
          {/* inner glow and a glossy highlight for a soft, premium finish */}
          <path d="M48 21C65 20 79 32 82.5 49 85.5 63 89 79 75 85.5 64 89 36 89 25.5 85.5 11.5 80 14 63 17.5 49 21 33 32 22 48 21Z" fill={`url(#${id}-core)`} />
          <ellipse cx="35.5" cy="34" rx="9.5" ry="5" transform="rotate(-30 35.5 34)" fill="#fff" opacity="0.75" />
          <circle cx="46" cy="28.5" r="1.6" fill="#fff" opacity="0.7" />

          {/* cheeks */}
          {state === "success" || state === "idle" || state === "responding" ? (
            <g fill="#c4b3f5" opacity="0.45">
              <ellipse cx="32.5" cy="62" rx="4.6" ry="2.6" />
              <ellipse cx="67.5" cy="62" rx="4.6" ry="2.6" />
            </g>
          ) : null}

          {/* eyes carry most of the emotion */}
          <g className="blob-eyes">
            {eyes === "open" ? (
              <g className="blob-blink">
                <ellipse cx="40" cy="54" rx={state === "conflict" ? 5 : 4.3} ry={state === "conflict" ? 5.4 : 5.8} fill="#25213a" />
                <ellipse cx="60" cy="54" rx={state === "conflict" ? 5 : 4.3} ry={state === "conflict" ? 5.4 : 5.8} fill="#25213a" />
                <circle cx="41.6" cy="51.6" r="1.5" fill="#fff" />
                <circle cx="61.6" cy="51.6" r="1.5" fill="#fff" />
                <circle cx="38.6" cy="57" r="0.7" fill="#fff" opacity="0.6" />
                <circle cx="58.6" cy="57" r="0.7" fill="#fff" opacity="0.6" />
              </g>
            ) : eyes === "happy" ? (
              <g fill="none" stroke="#25213a" strokeWidth="2.6" strokeLinecap="round">
                <path d="M35.5 56c1.5-3.6 7.5-3.6 9 0" />
                <path d="M55.5 56c1.5-3.6 7.5-3.6 9 0" />
              </g>
            ) : (
              <g fill="none" stroke="#25213a" strokeWidth="2.2" strokeLinecap="round">
                <path d="M35.5 54.5c1.6 2.4 7.4 2.4 9 0" />
                <path d="M55.5 54.5c1.6 2.4 7.4 2.4 9 0" />
              </g>
            )}
          </g>

          {/* a tiny mouth, only where it adds something */}
          {state === "success" ? (
            <path d="M45.5 64.5c2.6 2.6 6.4 2.6 9 0" fill="none" stroke="#25213a" strokeWidth="1.8" strokeLinecap="round" />
          ) : state === "thinking" ? (
            <ellipse cx="51.5" cy="65" rx="1.6" ry="1.3" fill="#25213a" opacity="0.75" />
          ) : state === "conflict" ? (
            <path d="M47 65.5h6" stroke="#25213a" strokeWidth="1.7" strokeLinecap="round" />
          ) : state === "resting" ? null : (
            <path d="M47.2 64.2c1.6 1.6 4 1.6 5.6 0" fill="none" stroke="#25213a" strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
          )}
        </g>
      </g>

      {/* thinking: three small sparks orbit like passing thoughts */}
      {detailed && state === "thinking" ? (
        <g className="blob-orbit">
          <circle cx="50" cy="8" r="2.2" fill="#c9c1ff" />
          <circle cx="88" cy="40" r="1.6" fill="#a094f5" opacity="0.8" />
          <circle cx="14" cy="34" r="1.3" fill="#e4deff" opacity="0.7" />
        </g>
      ) : null}

      {/* success / resting: a few quiet stars, nothing loud */}
      {detailed && (state === "success" || state === "resting") ? (
        <g className="blob-twinkle" fill={state === "success" ? "#c9c1ff" : "#a094f5"}>
          <Star x={84} y={20} s={state === "success" ? 5 : 3.6} />
          {state === "success" ? <Star x={14} y={28} s={3.6} delay /> : null}
        </g>
      ) : null}
    </svg>
  );
}

function Star({ x, y, s, delay }: { x: number; y: number; s: number; delay?: boolean }) {
  return (
    <path
      className={delay ? "blob-star blob-star-2" : "blob-star"}
      d={`M${x} ${y - s}C${x + s * 0.15} ${y - s * 0.15} ${x + s * 0.15} ${y - s * 0.15} ${x + s} ${y}C${x + s * 0.15} ${y + s * 0.15} ${x + s * 0.15} ${y + s * 0.15} ${x} ${y + s}C${x - s * 0.15} ${y + s * 0.15} ${x - s * 0.15} ${y + s * 0.15} ${x - s} ${y}C${x - s * 0.15} ${y - s * 0.15} ${x - s * 0.15} ${y - s * 0.15} ${x} ${y - s}Z`}
    />
  );
}

/** The blob with a short line of text — for the moments where the assistant speaks up. */
export function BlobNote({ state, children, className }: { state: BlobState; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-center gap-2.5", className)}>
      <ThinkingBlob state={state} size={36} />
      <p className="text-[13px] font-medium text-ink-2">{children}</p>
    </div>
  );
}
