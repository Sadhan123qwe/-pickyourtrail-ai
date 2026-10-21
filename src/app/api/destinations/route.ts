import { route } from "@/lib/http";
import { listDestinationSummaries } from "@/lib/catalog/destinations";

/** Static demo catalog: served without any AI call. */
export const GET = route({}, () => ({ items: listDestinationSummaries(), demo: true }));
