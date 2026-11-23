import { redirect } from "next/navigation";
import { getOptionalSession } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await getOptionalSession();
  if (!session) redirect("/welcome");
  const prefs = await session.repo.getPreferences();
  if (!prefs.onboarded) redirect("/welcome");
  return <AppShell>{children}</AppShell>;
}
