import { redirect } from "next/navigation";
import { getOptionalSession } from "@/lib/auth";
import { Onboarding } from "@/components/onboarding";

export default async function WelcomePage({ searchParams }: PageProps<"/welcome">) {
  const session = await getOptionalSession();
  const prefs = session ? await session.repo.getPreferences() : null;
  if (prefs?.onboarded) redirect("/");
  const sp = await searchParams;
  return <Onboarding signedIn={!!session} startAt={session ? "prefs" : sp.step === "account" ? "account" : "welcome"} />;
}
