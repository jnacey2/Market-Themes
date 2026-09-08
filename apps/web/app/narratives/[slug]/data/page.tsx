import { notFound } from "next/navigation";
import { getNarrativeDetailStatus } from "@market-themes/db";
import { NarrativeDataView } from "../../../../components/narratives/NarrativeDataView";

export const dynamic = "force-dynamic";

export default async function NarrativeDataPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const narrative = await getNarrativeDetailStatus(decodeURIComponent(slug));
  if (!narrative) {
    notFound();
  }
  return <NarrativeDataView narrative={narrative} />;
}
