"use client";
import { useEffect, useState } from "react";
import { usePrefs } from "@/components/providers";
import { Info } from "lucide-react";
import { ThinkingBlob } from "@/components/blob";
import { ChatView } from "@/components/chat";
import { takeSharedContent, type CaptureDraft } from "@/lib/client/capture";

export default function AssistantPage() {
  const { t } = usePrefs();
  const [incoming, setIncoming] = useState<CaptureDraft | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);

  // Arrived from "Share → PlanMind" in another app: pick up what was shared.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("share") !== "1") return;
    window.history.replaceState(null, "", "/assistant");
    void takeSharedContent().then(({ draft, droppedFiles }) => {
      if (draft) setIncoming(draft);
      if (droppedFiles) setShareNote(t("The shared file didn't come through. Open it again with “Upload screenshot” or “Upload document” below."));
      else if (!draft) setShareNote(t("Nothing was received from the share. Try sharing again, or upload or paste it below."));
    });
  }, [t]);

  return (
    <div className="flex h-[calc(100dvh-76px-env(safe-area-inset-bottom))] flex-col lg:h-dvh">
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3.5 sm:px-6">
        <ThinkingBlob size={36} />
        <div>
          <h1 className="text-[16px] font-semibold tracking-tight">{t("Assistant")}</h1>
          <p className="text-[12px] text-ink-2">{t("Plans with your real calendar. Changes always wait for your OK.")}</p>
        </div>
      </header>
      {shareNote ? (
        <p role="status" className="mx-4 mt-3 flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-[12.5px] sm:mx-6">
          <Info className="mt-0.5 size-3.5 shrink-0 text-warning" />
          {shareNote}
        </p>
      ) : null}
      <ChatView incoming={incoming} />
    </div>
  );
}
