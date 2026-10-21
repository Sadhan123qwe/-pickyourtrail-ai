import { ReviewView } from "@/components/trips/review-view";

export const metadata = { title: "Review & book" };

export default async function ReviewPage(props: PageProps<"/trips/[id]/review">) {
  const { id } = await props.params;
  return <ReviewView tripId={id} />;
}
