import ProposalPage from "./ProposalPage";

// /start/proposal/<lead_id>: the homeowner's proposal on its own link, for sharing or a reload.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProposalPage id={id} />;
}
