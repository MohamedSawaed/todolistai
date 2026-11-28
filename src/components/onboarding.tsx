"use client";
import { useEffect, useState, useSyncExternalStore } from "react";

const noopSubscribe = () => () => undefined;
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, MousePointerClick, Sparkles } from "lucide-react";
import { usePrefs } from "./providers";
import { Button, Field, Input, cx } from "./ui";
import { Logo } from "./app-shell";
import { ThinkingBlob } from "@/components/mascot/thinking-blob";
import { AvailabilityFields, ClockField, LanguageField, TimezoneField } from "./preferences-form";
import { createSupabaseBrowserClient, googleAuthEnabled } from "@/lib/supabase/client";
import { isValidZone } from "@/lib/scheduling/time";
import type { Preferences } from "@/lib/types";

type Step = "welcome" | "account" | "prefs" | "intro";

export function Onboarding({ signedIn, startAt }: { signedIn: boolean; startAt: Step }) {
  const { prefs, savePrefs, previewPrefs, status, t } = usePrefs();
  const router = useRouter();
  const [step, setStep] = useState<Step>(startAt);
  const [rawDraft, setDraft] = useState<Preferences>(prefs);
  const [tzTouched, setTzTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsAccount = status.storage === "supabase" && !signedIn;

  // the browser's timezone (null during server render), used until the user picks one
  const browserZone = useSyncExternalStore(
    noopSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null,
  );
  const autoZone = !tzTouched && prefs.timezone === "UTC" && browserZone && isValidZone(browserZone) ? browserZone : null;
  const draft = autoZone ? { ...rawDraft, timezone: autoZone } : rawDraft;
  const update = (next: Preferences) => {
    if (next.timezone !== draft.timezone) setTzTouched(true);
    if (next.locale !== draft.locale) previewPrefs({ locale: next.locale }); // switch the screen right away
    setDraft(next);
  };

  const steps: Step[] = needsAccount || startAt === "account" ? ["welcome", "account", "prefs", "intro"] : ["welcome", "prefs", "intro"];
  const index = steps.indexOf(step);

  async function finish() {
    setSaving(true);
    setError(null);
    try {
      await savePrefs({ ...draft, onboarded: true });
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? t(e.message) : t("Couldn't save your preferences"));
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <div className="flex items-center gap-2">
          {status.storage === "local" ? <span className="rounded-full bg-warning-soft px-2.5 py-1 text-[11.5px] font-medium text-warning">{t("Local mode")}</span> : null}
          <select
            aria-label={t("Language")}
            value={draft.locale}
            onChange={(e) => update({ ...draft, locale: e.target.value as Preferences["locale"] })}
            className="h-9 rounded-xl border border-line bg-surface px-2 text-[13px]"
          >
            <option value="en">English</option>
            <option value="ar">العربية</option>
            <option value="he">עברית</option>
          </select>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 pb-16">
        <div className="mb-8 flex gap-1.5" aria-hidden>
          {steps.map((s, i) => (
            <span key={s} className={cx("h-1 flex-1 rounded-full transition-colors duration-500", i <= index ? "bg-primary" : "bg-line")} />
          ))}
        </div>

        {step === "welcome" ? (
          <div key="welcome" className="animate-rise">
            <div className="flex justify-center">
              <ThinkingBlob size={200} decorative />
            </div>
            <h1 className="mt-4 text-center text-[30px] leading-[1.12] font-semibold tracking-tight sm:text-[36px]">{t("Meet your new planning companion.")}</h1>
            <p className="mt-2 text-center text-[16px] text-ink-2">{t("Tell it what you need to do. It helps organize the rest.")}</p>
            <div className="mt-6">
              <WelcomeArt />
            </div>
            <Button variant="primary" size="lg" className="mt-8 w-full sm:w-auto" onClick={() => setStep(needsAccount ? "account" : "prefs")}>
              {t("Get started")}{" "}<ArrowRight className="size-4 rtl:rotate-180" />
            </Button>
          </div>
        ) : null}

        {step === "account" ? (
          <AccountStep
            key="account"
            onDone={() => {
              // signed in: move on (the server sends already-set-up users straight to Today)
              setStep("prefs");
              router.refresh();
            }}
          />
        ) : null}

        {step === "prefs" ? (
          <div key="prefs" className="animate-rise space-y-5">
            <div>
              <h1 className="text-[26px] font-semibold tracking-tight">{t("A few quick preferences")}</h1>
              <p className="mt-1 text-[14px] text-ink-2">{t("So suggestions fit your life. You can change these anytime.")}</p>
            </div>
            <Field label={t("What should we call you? (optional)")} htmlFor="ob-name">
              <Input id="ob-name" value={draft.displayName} onChange={(e) => update({ ...draft, displayName: e.target.value })} maxLength={80} />
            </Field>
            <TimezoneField value={draft.timezone} onChange={(timezone) => update({ ...draft, timezone })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <LanguageField value={draft.locale} onChange={(locale) => update({ ...draft, locale })} />
              <ClockField value={draft.clock} onChange={(clock) => update({ ...draft, clock })} />
            </div>
            <AvailabilityFields prefs={draft} set={update} />
            <div className="flex justify-end pt-2">
              <Button variant="primary" size="lg" onClick={() => setStep("intro")}>
                {t("Continue")}{" "}<ArrowRight className="size-4 rtl:rotate-180" />
              </Button>
            </div>
          </div>
        ) : null}

        {step === "intro" ? (
          <div key="intro" className="animate-rise">
            <div className="flex items-center gap-3">
              <ThinkingBlob state="success" size={96} decorative className="-my-2 shrink-0" />
              <div>
                <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{t("Your plans. Under control.")}</h1>
                <p className="mt-1 text-[14px] text-ink-2">{t("Three ways to plan")}</p>
              </div>
            </div>
            <ul className="mt-6 space-y-3">
              {[
                { icon: MousePointerClick, title: t("Add things yourself"), body: t("Press + (or N on a keyboard) to add an event, task or note. Click any empty time in the calendar to start there.") },
                { icon: Sparkles, title: t("Or just tell the assistant"), body: t("“Tomorrow at 5 PM I need to visit the dentist.” It checks your real calendar and asks before changing anything.") },
                { icon: CalendarDays, title: t("See it all on the calendar"), body: t("Day, week and month views. Drag events to reschedule — conflicts are always flagged first.") },
              ].map((x, i) => (
                <li key={x.title} className="flex animate-rise gap-4 rounded-2xl border border-line bg-surface p-4" style={{ animationDelay: `${i * 80}ms`, animationFillMode: "backwards" }}>
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                    <x.icon className="size-5" />
                  </span>
                  <div>
                    <p className="text-[15px] font-semibold">{x.title}</p>
                    <p className="mt-0.5 text-[13.5px] text-ink-2">{x.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            {error ? (
              <p role="alert" className="mt-4 text-[13px] text-danger">
                {error}
              </p>
            ) : null}
            <div className="mt-8 flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep("prefs")}>
                {t("Back")}
              </Button>
              <Button variant="primary" size="lg" loading={saving} onClick={finish}>
                {t("Start planning")}{" "}<ArrowRight className="size-4 rtl:rotate-180" />
              </Button>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function AccountStep({ onDone }: { onDone: () => void }) {
  const { t } = usePrefs();
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sb = createSupabaseBrowserClient();

  async function submit() {
    if (!sb) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const redirect = `${window.location.origin}/auth/callback?next=/welcome`;
    const res =
      mode === "signup"
        ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect } })
        : await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (res.error) {
      const msg = res.error.message.toLowerCase();
      if (msg.includes("email not confirmed")) return setError(t("This email isn't confirmed yet. Open the confirmation email from Supabase, or ask the app owner to confirm your account."));
      if (msg.includes("invalid login credentials")) return setError(t("Wrong email or password. If you haven't created an account yet, choose “Create an account” below."));
      return setError(t(res.error.message));
    }
    // Supabase returns a user with no identities when the email is already registered
    if (mode === "signup" && res.data.user && res.data.user.identities?.length === 0) {
      setMode("signin");
      return setError(t("An account with this email already exists. Sign in instead."));
    }
    if (!res.data.session) return setNotice(t("Check your inbox to confirm your email, then come back here."));
    onDone();
  }

  return (
    <div className="animate-rise space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">{mode === "signup" ? t("Create your account") : t("Welcome back")}</h1>
        <p className="mt-1 text-[14px] text-ink-2">{t("Only your email — nothing else is required.")}</p>
      </div>
      {googleAuthEnabled ? (
        <>
          <Button
            size="lg"
            className="w-full"
            onClick={() => sb?.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback?next=/welcome` } })}
          >
            {t("Continue with Google")}
          </Button>
          <div className="flex items-center gap-3 text-[12px] text-ink-3">
            <span className="h-px flex-1 bg-line" />{" "}{t("or")}{" "}<span className="h-px flex-1 bg-line" />
          </div>
        </>
      ) : null}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t("Email")} htmlFor="au-email">
          <Input id="au-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t("Password")} htmlFor="au-pass" hint={mode === "signup" ? t("At least 8 characters.") : undefined}>
          <Input id="au-pass" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}
        {notice ? <p className="rounded-xl bg-primary-soft px-3 py-2 text-[13px] text-primary-ink">{notice}</p> : null}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          {mode === "signup" ? t("Create account") : t("Sign in")}
        </Button>
      </form>
      <p className="text-center text-[13px] text-ink-2">
        {mode === "signup" ? t("Already have an account?") : t("New here?")}{" "}
        <button className="font-medium text-primary hover:underline" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
          {mode === "signup" ? t("Sign in") : t("Create an account")}
        </button>
      </p>
    </div>
  );
}

/** A short, clearly-labelled example of how the assistant helps (not a real request). */
function WelcomeArt() {
  const { t } = usePrefs();
  const [found, setFound] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setFound(true), 1600);
    return () => clearTimeout(id);
  }, []);
  return (
    <div className="relative overflow-hidden rounded-3xl border border-line bg-surface p-4 shadow-soft" aria-hidden>
      <span className="absolute end-3 top-3 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium tracking-wide text-ink-3 uppercase">{t("Example")}</span>
      <div className="ms-auto w-fit max-w-[85%] rounded-2xl rounded-se-md bg-primary px-3.5 py-2 text-[13px] text-white">{t("Find an hour for studying tomorrow.")}</div>
      <div className="mt-3 flex items-end gap-2.5">
        <ThinkingBlob state={found ? "suggestion-ready" : "thinking"} size={56} decorative className="shrink-0" />
        {found ? (
          <div data-cat="learning" className="flex min-w-0 flex-1 animate-rise gap-2.5 rounded-2xl border border-line bg-surface p-3">
            <span className="w-1 shrink-0 rounded-full bg-[var(--c)]" />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold">{t("Study session")}</p>
              <p className="text-[12.5px] text-ink-2">{t("Tomorrow · 18:00–19:00 · free in your calendar")}</p>
            </div>
            <span className="ms-auto self-center rounded-lg bg-primary px-2.5 py-1 text-[12px] font-medium text-white">{t("Add")}</span>
          </div>
        ) : (
          <p className="pb-3 text-[13px] text-ink-3">{t("Checking your calendar…")}</p>
        )}
      </div>
    </div>
  );
}
