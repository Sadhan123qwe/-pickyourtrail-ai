/**
 * DEMONSTRATION CONTENT ONLY. These documents are sample policies written for
 * this prototype. They are NOT official Pickyourtrail policies, terms or
 * contact details, and must not be presented to real customers as such.
 */
export interface SeedDoc {
  slug: string;
  title: string;
  category: string;
  audience: "public" | "internal";
  tags: string;
  body: string;
}

const DISCLAIMER = "Demonstration content: sample policy for this prototype, not an official Pickyourtrail policy.";

export const KNOWLEDGE_SEED: SeedDoc[] = [
  {
    slug: "cancellation-refund-policy",
    title: "Cancellation and refund policy (demo)",
    category: "Policies",
    audience: "public",
    tags: "cancel cancellation refund money back cancel trip",
    body: `${DISCLAIMER}

Cancellations must be requested in writing through support. A travel expert reviews every cancellation request; the AI assistant cannot cancel bookings or approve refunds.

Sample cancellation charges for land arrangements (hotels, transfers, activities): more than 30 days before departure, 10% of the land cost; 15 to 30 days before departure, 25%; fewer than 15 days before departure, up to 100% depending on supplier terms.

Flight tickets follow the airline's fare rules. Many economy fares are partly or fully non-refundable, so the refundable amount can only be confirmed by a travel expert after checking with the airline.

Approved refunds are processed to the original payment method, typically within 7 to 14 business days after supplier refunds are received.`,
  },
  {
    slug: "booking-changes",
    title: "Changing dates, names or travellers (demo)",
    category: "Policies",
    audience: "public",
    tags: "change reschedule modify dates name correction add traveller postpone",
    body: `${DISCLAIMER}

Before a booking is confirmed, you can change anything in your plan for free — edit your itinerary in the app or ask your travel expert.

After confirmation, date changes depend on hotel, activity and airline availability and may involve fare differences or change fees. A travel expert will share the exact cost before making any change.

Name corrections on flight tickets must match passports exactly. Contact support as soon as you notice a spelling mistake; some airlines allow minor corrections for a fee.`,
  },
  {
    slug: "payments-emi",
    title: "Payments, EMI and invoices (demo)",
    category: "Payments",
    audience: "public",
    tags: "payment pay emi card upi invoice charged twice transaction receipt",
    body: `${DISCLAIMER}

Nothing is charged when you generate or save an itinerary. Payment is only requested after a travel expert confirms availability and sends you a final quote.

Accepted payment methods in this demo policy are UPI, debit and credit cards, net banking, and no-cost EMI on selected cards.

If you see a duplicate charge, raise a support ticket with the transaction reference. Duplicate charges are investigated with the payment gateway and are usually reversed within 5 to 7 business days.`,
  },
  {
    slug: "visa-assistance",
    title: "Visa assistance (demo)",
    category: "Documents",
    audience: "public",
    tags: "visa passport documents e-visa entry requirements schengen",
    body: `${DISCLAIMER}

Visa rules change frequently. Our travel experts can share a document checklist and help with applications, but the final decision always rests with the embassy or immigration authority.

Passports should normally be valid for at least six months beyond your return date and have blank pages available.

Apply early for Schengen (Switzerland), Japan and Singapore visas. Destination pages in this app show general notes only; always verify current requirements before travel.`,
  },
  {
    slug: "travel-insurance",
    title: "Travel insurance (demo)",
    category: "Documents",
    audience: "public",
    tags: "insurance medical cover claim baggage loss",
    body: `${DISCLAIMER}

We recommend comprehensive travel insurance covering medical emergencies, trip cancellation and baggage loss. Some countries require proof of medical cover for the visa.

Insurance claims are handled by the insurer. Keep receipts, medical reports and police reports where relevant, and contact the insurer's helpline as soon as possible.`,
  },
  {
    slug: "on-trip-emergency",
    title: "On-trip emergency support (demo)",
    category: "Support",
    audience: "public",
    tags: "emergency urgent stranded missed flight lost passport medical hospital stolen help",
    body: `${DISCLAIMER}

If you face an urgent problem during your trip — a missed flight, a hotel that cannot accommodate you, a lost passport or a medical issue — mark it as urgent in support. Urgent requests go straight to a human agent; the AI assistant does not handle emergencies.

For a lost or stolen passport, report it to the local police and contact the nearest Indian embassy or consulate for an emergency certificate. Keep copies of your passport and visa.

For medical emergencies, contact local emergency services first, then your insurer.

In this demo, no real helpline number is provided.`,
  },
  {
    slug: "how-planning-and-booking-work",
    title: "How AI trip planning and booking requests work (demo)",
    category: "Getting started",
    audience: "public",
    tags: "how it works ai planner itinerary price estimate booking confirmation handoff",
    body: `${DISCLAIMER}

The AI trip planner asks about your trip and creates a day-by-day itinerary. All prices shown are estimates based on sample data — they are not live fares, rates or availability.

When you are happy with your plan, you can send a booking request. This hands your itinerary to a travel expert, who checks availability and prepares a final quote. Your trip is only booked after the expert confirms with suppliers and you complete payment.

You can keep editing saved trips at any time before confirmation.`,
  },
  {
    slug: "flights-baggage",
    title: "Flights and baggage (demo)",
    category: "Flights",
    audience: "public",
    tags: "flight baggage luggage allowance check-in seat meal",
    body: `${DISCLAIMER}

Baggage allowance depends on the airline and fare type. Low-cost carriers often include only cabin baggage. Your final quote lists the allowance for each flight.

Web check-in usually opens 24 to 48 hours before departure. Seat selection and special meals can be requested through your travel expert, subject to airline rules.`,
  },
  {
    slug: "sales-playbook",
    title: "Sales follow-up playbook (internal demo)",
    category: "Sales",
    audience: "internal",
    tags: "lead follow up sales stage qualify proposal script template conversion",
    body: `${DISCLAIMER}

First contact: call or WhatsApp every new AI-planner lead within 24 hours. Reference their destination, dates and itinerary so the customer doesn't repeat themselves.

Qualification checklist: confirm travel dates, party size, budget range, decision-maker, and whether flights are needed. Move the lead to Qualified only when dates and budget are confirmed.

Proposal: send a quote within 48 hours of qualification. Highlight two or three activities that match the customer's stated interests.

Follow-up cadence: day 1, day 3 and day 7 after the proposal. After three unanswered follow-ups, mark the lead Lost with the reason "No response".

Never promise prices or availability before ops confirms with suppliers.`,
  },
  {
    slug: "support-escalation-sop",
    title: "Support escalation SOP (internal demo)",
    category: "Support",
    audience: "internal",
    tags: "support escalation priority sla urgent ticket response resolution",
    body: `${DISCLAIMER}

Priority targets for first human response: Urgent within 15 minutes, High within 2 hours, Normal within 24 hours, Low within 48 hours.

Escalate immediately when a traveller is stranded, unwell, has lost documents, or is within 24 hours of departure with a problem. Urgent tickets are auto-escalated by the system.

Refunds and cancellations are policy-sensitive: only a human agent may confirm refund amounts, after checking supplier terms.

When resolving a ticket, summarise the outcome in the customer reply and ask for a satisfaction rating.`,
  },
  {
    slug: "booking-handoff-sop",
    title: "Booking handoff operations SOP (internal demo)",
    category: "Operations",
    audience: "internal",
    tags: "booking handoff ops quote supplier confirmation status pending failed",
    body: `${DISCLAIMER}

Every booking request from the app arrives as a handoff with status Pending review. Assign it, check supplier availability, and move it to In review.

Send the customer a final quote and set the status to Quote sent. Record the quoted total.

A booking is only confirmed when the supplier or booking provider returns a confirmation reference. Never mark a trip as booked without that reference. In this demo no provider is connected, so provider confirmation is never recorded.

If suppliers can't fulfil the request, set the handoff to Failed with a note and contact the customer with alternatives.`,
  },
  {
    slug: "destination-selling-notes",
    title: "Destination selling notes (internal demo)",
    category: "Sales",
    audience: "internal",
    tags: "destination bali thailand dubai singapore maldives pitch upsell season",
    body: `${DISCLAIMER}

Bali: strongest April to September. Pitch Ubud culture plus a beach base; families love Waterbom and the Monkey Forest. Upsell private-pool villas for couples.

Thailand (Phuket & Krabi): best November to April. Island tours sell well; suggest splitting stays between Phuket and Krabi for trips of six days or more.

Dubai: best November to March. Desert safari and Burj Khalifa are must-sells; Aquaventure is the top family upsell.

Singapore: year-round; ideal for families with young children (Universal Studios, Night Safari).

Maldives: honeymoon focus; overwater villas drive most of the value.`,
  },
];
