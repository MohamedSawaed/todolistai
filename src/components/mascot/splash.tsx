"use client";
import { useEffect, useState } from "react";
import { usePrefs } from "../providers";
import { ThinkingBlob } from "./thinking-blob";

const KEY = "planmind.introduced";

/**
 * First-launch introduction: a soft glow, the character appears, opens its eyes, and the
 * name follows (about 2.5 s). Shown once per device; a tap skips it; it never blocks returning
 * users (the inline script in the root layout only enables it when it hasn't been seen).
 */
export function Splash() {
  const { t } = usePrefs();
  const [awake, setAwake] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (!root.hasAttribute("data-splash")) return;
    const quick = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finish = () => {
      try {
        localStorage.setItem(KEY, "1");
      } catch {
        /* storage unavailable: it may show again, which is harmless */
      }
      root.removeAttribute("data-splash");
    };
    const wake = setTimeout(() => setAwake(true), quick ? 0 : 950);
    const done = setTimeout(finish, quick ? 700 : 2600);
    return () => {
      clearTimeout(wake);
      clearTimeout(done);
    };
  }, []);

  return (
    <div
      className="pm-splash"
      role="presentation"
      onClick={() => {
        try {
          localStorage.setItem(KEY, "1");
        } catch {
          /* ignore */
        }
        document.documentElement.removeAttribute("data-splash");
      }}
    >
      <div className="pm-splash-glow" aria-hidden />
      <div className="relative flex flex-col items-center">
        <div className="pm-splash-char">
          <ThinkingBlob state={awake ? "suggestion-ready" : "resting"} size={176} decorative />
        </div>
        <p className="pm-splash-name">PlanMind</p>
        <p className="mt-1 text-[13px] text-[#b9a9df]" style={{ animation: "pm-name 500ms ease-out 1.45s both" }}>
          {t("Your plans. Under control.")}
        </p>
      </div>
    </div>
  );
}
