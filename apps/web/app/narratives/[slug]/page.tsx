import { notFound } from "next/navigation";
import { getNarrativeDetailStatus } from "@market-themes/db";
import { NarrativeStoryboard } from "../../../components/narratives/NarrativeStoryboard";

export const dynamic = "force-dynamic";

export default async function NarrativePage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const narrative = await getNarrativeDetailStatus(decodeURIComponent(slug));
  if (!narrative) {
    notFound();
  }
  return <NarrativeStoryboard narrative={narrative} />;
}
