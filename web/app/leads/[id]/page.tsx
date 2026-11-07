import { redirect } from "next/navigation";

// The lead page now lives in the board's open card.
export default async function LeadRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/h/${encodeURIComponent(id)}`);
}
