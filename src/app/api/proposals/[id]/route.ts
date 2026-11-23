import { z } from "zod";
import { json, parseBody, route } from "@/lib/api";
import { zIso } from "@/lib/schemas";
import { cancelProposal, confirmProposal, undoProposal } from "@/lib/services/proposals";
import { recordProposalDecision } from "@/lib/ai/assistant";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("confirm"),
    slot: z.object({ start: zIso, end: zIso }).optional(),
    allowOverlap: z.boolean().optional(),
  }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("undo") }),
]);

export const POST = route<Ctx>(async ({ repo }, req, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, schema);
  const prefs = await repo.getPreferences();
  const note = (p: Parameters<typeof recordProposalDecision>[1], what: string) => recordProposalDecision(repo, p, what).catch(() => undefined);

  if (body.action === "confirm") {
    const out = await confirmProposal(repo, prefs, id, { slot: body.slot, allowOverlap: body.allowOverlap });
    if (out.status === "applied") await note(out.proposal, "confirmed (the app saved it)");
    return json(out, out.status === "applied" ? 200 : 409);
  }
  if (body.action === "cancel") {
    const proposal = await cancelProposal(repo, id);
    await note(proposal, "dismissed");
    return json({ status: "cancelled", proposal });
  }
  const proposal = await undoProposal(repo, prefs, id);
  await note(proposal, "undid the previously applied");
  return json({ status: "undone", proposal });
});
