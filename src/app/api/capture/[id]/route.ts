import { json, parseBody, route } from "@/lib/api";
import { captureActionSchema, confirmCapture, discardCapture } from "@/lib/services/capture";
import { recordProposalDecision } from "@/lib/ai/assistant";
import type { CapturePayload } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/** Save the items the user approved from an import (or discard it). Safe to retry. */
export const POST = route<Ctx>(async ({ repo }, req, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, captureActionSchema);
  if (body.action === "discard") {
    const proposal = await discardCapture(repo, id);
    await recordProposalDecision(repo, proposal, "discarded the import").catch(() => undefined);
    return json({ proposal });
  }
  const prefs = await repo.getPreferences();
  const proposal = await confirmCapture(repo, prefs, id, body);
  const outcomes = Object.values((proposal.payload as CapturePayload).outcomes ?? {});
  const saved = outcomes.filter((o) => o.status === "added" || o.status === "updated").length;
  await recordProposalDecision(repo, proposal, `saved ${saved} item(s) from the import in`).catch(() => undefined);
  return json({ proposal });
});
