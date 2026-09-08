import { NarrativeBoard } from "../../components/narratives/NarrativeBoard";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const params = await searchParams;
  return <NarrativeBoard window={params.window === "30d" ? "30d" : "7d"} />;
}
