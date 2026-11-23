"use client";
import { Sparkles } from "lucide-react";
import { ChatView } from "@/components/chat";

export default function AssistantPage() {
  return (
    <div className="flex h-[calc(100dvh-76px-env(safe-area-inset-bottom))] flex-col lg:h-dvh">
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3.5 sm:px-6">
        <span className="grid size-8 place-items-center rounded-xl bg-primary-soft text-primary">
          <Sparkles className="size-4" />
        </span>
        <div>
          <h1 className="text-[16px] font-semibold tracking-tight">Assistant</h1>
          <p className="text-[12px] text-ink-2">Plans with your real calendar. Changes always wait for your OK.</p>
        </div>
      </header>
      <ChatView />
    </div>
  );
}
