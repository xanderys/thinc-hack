import Board from "@/components/board/Board";

export default async function House({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Board openId={decodeURIComponent(id)} />;
}
