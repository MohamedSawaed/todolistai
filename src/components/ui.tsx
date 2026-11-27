"use client";
import { clsx } from "clsx";
import { Check, Loader2, X } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import type { Category } from "@/lib/types";
import { usePrefs } from "./providers";

export const cx = clsx;

// ---------------------------------------------------------------- Button
type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover shadow-[0_1px_2px_rgb(76_63_174/0.25)]",
  secondary: "bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-2",
  ghost: "text-ink-2 hover:text-ink hover:bg-surface-2",
  danger: "bg-danger text-white hover:opacity-90",
  soft: "bg-primary-soft text-primary-ink hover:brightness-[0.97]",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-5 text-[15px] gap-2 rounded-xl",
  icon: "h-10 w-10 rounded-xl",
  "icon-sm": "h-8 w-8 rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }>(
  function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={cx(
          "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background,color,border,opacity,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
          variants[variant],
          sizes[size],
          className,
        )}
        disabled={disabled || loading}
        {...rest}
      >
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {children}
      </button>
    );
  },
);

// ---------------------------------------------------------------- Form fields
export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

const fieldBase =
  "w-full min-w-0 rounded-xl border bg-surface px-3 text-[14.5px] text-ink placeholder:text-ink-3 transition-colors outline-none focus:border-primary focus:ring-4 focus:ring-primary/10";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cx(fieldBase, "h-10", invalid ? "border-danger" : "border-line", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea(
  { className, invalid, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx(fieldBase, "min-h-20 resize-y py-2.5", invalid ? "border-danger" : "border-line", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(fieldBase, "h-10 border-line pe-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  className?: string;
  size?: "sm" | "md";
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("inline-flex rounded-xl bg-surface-2 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-[9px] font-medium transition-all",
            size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-8 px-3 text-[13px]",
            value === o.value ? "bg-surface text-ink shadow-[0_1px_3px_rgb(24_24_40/0.08)]" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Checkbox
export function CheckCircle({
  checked,
  onChange,
  label,
  category,
  size = "md",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  category?: Category;
  size?: "sm" | "md";
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      data-cat={category}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cx(
        "group relative grid shrink-0 place-items-center rounded-full border-[1.5px] transition-all duration-200",
        size === "sm" ? "size-[18px]" : "size-[22px]",
        checked ? "border-transparent bg-[var(--c,var(--primary))]" : "border-line-strong hover:border-[var(--c,var(--primary))]",
      )}
    >
      {checked ? <Check className="size-3 animate-pop text-white" strokeWidth={3} aria-hidden /> : null}
    </button>
  );
}

// ---------------------------------------------------------------- Sheet (bottom sheet on mobile, dialog on desktop)
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
  description,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  description?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const { t } = usePrefs();
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusFirst = () => {
      const el = panel.current?.querySelector<HTMLElement>("[data-autofocus], input, textarea, select, button:not([data-close])");
      el?.focus();
    };
    const focusTimer = setTimeout(focusFirst, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
      if (e.key === "Tab" && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(
          (el) => !el.hasAttribute("disabled"),
        );
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 animate-fade-in bg-[rgb(20_20_32/0.32)] backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          "relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-line bg-surface shadow-float animate-sheet sm:animate-rise sm:rounded-3xl",
          wide ? "sm:max-w-2xl" : "sm:max-w-lg",
        )}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-2 sm:px-6 sm:pt-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[17px] font-semibold tracking-tight">
              {title}
            </h2>
            {description ? <p className="mt-0.5 text-[13px] text-ink-2">{description}</p> : null}
          </div>
          <Button data-close variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("Close")} className="-me-1.5">
            <X className="size-4" />
          </Button>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3.5 pb-[max(14px,env(safe-area-inset-bottom))] sm:px-6">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- misc
export function CategoryDot({ category, className }: { category: Category; className?: string }) {
  return <span data-cat={category} className={cx("inline-block size-2 shrink-0 rounded-full bg-[var(--c)]", className)} aria-hidden />;
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "primary" | "warning" | "danger" | "success"; className?: string }) {
  const tones = {
    neutral: "bg-surface-2 text-ink-2",
    primary: "bg-primary-soft text-primary-ink",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
    success: "bg-[var(--cat-health-soft)] text-[var(--cat-health-ink)]",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium", tones[tone], className)}>{children}</span>;
}

export function Skeleton({ className }: { className?: string }) {
  // a span so it can sit inside text elements without invalid nesting
  return <span className={cx("skeleton block", className)} aria-hidden />;
}

export function EmptyState({ icon, art, title, body, actions }: { icon?: ReactNode; art?: ReactNode; title: string; body?: string; actions?: ReactNode }) {
  return (
    <div className="flex animate-fade-in flex-col items-center rounded-3xl border border-dashed border-line-strong px-6 py-12 text-center">
      {art ? <div className="mb-3">{art}</div> : <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary">{icon}</div>}
      <p className="text-[15px] font-semibold">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-[13.5px] text-ink-2">{body}</p> : null}
      {actions ? <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line bg-surface-2 px-1.5 py-px font-sans text-[11px] text-ink-2">{children}</kbd>;
}
