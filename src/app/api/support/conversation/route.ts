import { route } from "@/lib/http";
import { supportConversation } from "@/lib/services/support";

/** The caller's most recent support chat, so the conversation persists across reloads. */
export const GET = route({}, ({ actor }) => supportConversation(actor));
