import { notFound, permanentRedirect } from "next/navigation";
import { getNarrativeDetailStatus } from "@market-themes/db";
import { narrativePath } from "../../../lib/narrative-paths";

export const dynamic = "force-dynamic";

/** Legacy route: storyboards now live at /narratives/<slug>. */
export default async function StoryboardRedirect({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const narrative = await getNarrativeDetailStatus(decodeURIComponent(id));
  if (!narrative) {
    notFound();
  }
  permanentRedirect(narrativePath(narrative.slug));
}
