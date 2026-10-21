import "server-only";

/**
 * Booking provider adapter boundary. A real integration (GDS, hotel bed bank,
 * or Pickyourtrail's internal booking system) would implement this interface.
 * The demo adapter never contacts anyone and NEVER reports a confirmation.
 */
export interface BookingSubmission {
  handoffId: string;
  tripId: string;
  itineraryId: string | null;
  totalEstimate: number | null;
}

export interface BookingProviderResult {
  providerStatus: "not_submitted" | "submitted" | "provider_confirmed" | "provider_failed";
  providerReference: string | null;
  message: string;
}

export interface BookingProvider {
  name: string;
  live: boolean;
  submit(input: BookingSubmission): Promise<BookingProviderResult>;
}

export const demoBookingProvider: BookingProvider = {
  name: "demo-handoff-desk",
  live: false,
  async submit() {
    return {
      providerStatus: "not_submitted",
      providerReference: null,
      message:
        "Demo mode: no booking provider is connected. Your request was handed to the travel-expert queue; nothing has been booked or charged.",
    };
  },
};

export function getBookingProvider(): BookingProvider {
  return demoBookingProvider;
}
