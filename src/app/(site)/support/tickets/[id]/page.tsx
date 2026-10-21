import { CustomerTicket } from "@/components/support/customer-ticket";

export const metadata = { title: "Support ticket" };

export default async function TicketPage(props: PageProps<"/support/tickets/[id]">) {
  const { id } = await props.params;
  return <CustomerTicket id={id} />;
}
