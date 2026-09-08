import { redirect } from "next/navigation";
export default async function StoryboardPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ window?: string }>;
}) {
  const { id } = await params;
  const { window } = await searchParams;
  redirect(
    `/themes/${encodeURIComponent(id)}?window=${window === "30d" ? "30d" : "7d"}`
  );
}
