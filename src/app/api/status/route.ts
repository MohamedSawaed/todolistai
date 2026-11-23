import { aiConfigured, storageMode } from "@/lib/config";
import { json } from "@/lib/api";

// Public: tells the UI which backends are configured (never exposes secrets).
export function GET() {
  return json({ storage: storageMode(), ai: aiConfigured() });
}
