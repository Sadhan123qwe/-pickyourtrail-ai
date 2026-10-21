import { Suspense } from "react";
import { Planner } from "@/components/planner/planner";
import { Spinner } from "@/components/ui";

export const metadata = { title: "AI trip planner" };

export default function PlanPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center"><Spinner label="Loading planner" /></div>}>
      <Planner />
    </Suspense>
  );
}
