// src/capabilities/policies.ts
//
// What a business offers through Zaina and its own rules for it, from its
// settings, added to her instructions on every message: which things are
// booked here and which the team arranges, the deposit to confirm (the
// business's, and any offering's own), the ways to pay, cancellation, and
// times. Two hotels on the same module can work differently (one takes
// payment in full to confirm, another a 30% deposit); Zaina is told which
// this one is, and that its rules win over anything usual for its kind of
// business. A rule the business hasn't set is said to be not set: she says
// the team will confirm, rather than describe what is usual.

import { getBusinessSettings } from "../businesses/settings.ts";
import { listOfferings } from "../booking/offerings.ts";
import type { PricingRules } from "../booking/pricing.ts";
import { depositText, getBookingSettings, offeringDepositText, paymentMethodsText, paymentOptionsOf } from "../booking/settings.ts";
import { describeWeek } from "../booking/slots.ts";
import type { Business, BookingSettings, Offering } from "../db/schema.ts";
import { addExtras } from "../engine/extras.ts";
import { PASS_REQUEST } from "../leads/extra-tools.ts";
import { bookingModules, CAPABILITIES, capabilitiesOf, type Capability } from "./catalog.ts";

/** "Its own rule: Honeymoon Suite, paid in full to confirm." for offerings whose deposit differs from the business's. */
function ownDeposits(offerings: Offering[], settings: BookingSettings, rest: string): string {
  const own = offerings
    .map((offering) => ({ name: offering.name, text: offeringDepositText(offering.pricing as PricingRules, settings, rest) }))
    .filter((entry): entry is { name: string; text: string } => Boolean(entry.text));
  return own.length ? ` Their own deposit: ${own.map((entry) => `${entry.name}, ${entry.text}`).join("; ")}.` : "";
}

const BOOKED_HERE: Partial<Record<Capability, { tools: string; rest: string }>> = {
  rooms: { tools: "list_rooms, check_availability, create_booking", rest: "at the property" },
  tables: { tools: "list_services, check_times, create_appointment", rest: "when you arrive" },
  appointments: { tools: "list_services, check_times, create_appointment", rest: "when you arrive" },
};

/** The business's own setup and rules, for Zaina's instructions. Empty for a business on its own system. */
export async function policiesPrompt(business: Business): Promise<string> {
  if (business.businessType === "custom") return "";
  const [settings, booking, offerings] = await Promise.all([
    getBusinessSettings(business.id),
    getBookingSettings(business.id),
    listOfferings(business.id, { activeOnly: true }),
  ]);
  const name = settings?.displayName ?? business.name;
  const enabled = capabilitiesOf(business, settings);
  const modules = bookingModules(business, enabled);
  const booksHere = (capability: Capability) => capability === "rooms" ? modules.rooms : capability === "tables" ? modules.slotKinds.includes("table") : capability === "appointments" ? modules.slotKinds.includes("service") : false;

  const offers: string[] = [];
  for (const capability of enabled) {
    const info = CAPABILITIES[capability];
    const here = BOOKED_HERE[capability];
    if (here && booksHere(capability)) {
      const own = ownDeposits(offerings.filter((offering) => offering.kind === info.offeringKind), booking, here.rest);
      offers.push(`- ${info.label}: booked here (${here.tools}). To confirm: ${depositText(booking, here.rest)}.${own}`);
    } else if (here) {
      // Booked by the team (Starter plan): Zaina takes the request.
      offers.push(`- ${info.label}: the team takes these bookings. Don't say one is free or booked: take what they'd like, the date${capability === "rooms" ? "s and how many guests" : ", the time and how many people"}, and the customer's name and number, and pass it on (create_lead). ${name}'s rule to confirm: ${depositText(booking, here.rest)}.`);
    } else {
      offers.push(`- ${info.label}: arranged by the team. Quote only prices get_prices gives; take ${info.details}, and the customer's name and number, and pass it on (${PASS_REQUEST}). Never say one is booked or confirmed.`);
    }
  }

  const lines = [
    `\n\n${name}'s own setup and rules. They come from ${name}'s settings: they are this business's rules, and they win over anything usual for its kind of business or anything you think is common. Never describe a rule, price or service that isn't here, in your tools or in the business information; if a customer asks about one, say you'll check with the team, and offer to pass the question on.`,
    offers.length ? `What ${name} offers through you:\n${offers.join("\n")}\nAnything else isn't offered through you: don't say it's available; if a customer wants it, offer to pass the request to the team.` : `${name} doesn't take bookings through you: answer from its information and price list, and pass bookings and requests to the team (create_lead).`,
  ];

  const takesAnyBooking = modules.rooms || modules.slotKinds.length > 0 || enabled.some((capability) => BOOKED_HERE[capability]);
  if (takesAnyBooking) {
    const options = paymentOptionsOf(booking);
    const online = paymentMethodsText(options);
    const ways = [online ? `${online} online` : "", options.payAtVenue ? "in person" : ""].filter(Boolean).join("; ");
    lines.push(`Ways to pay: ${ways || "not set up: the team arranges payment"}.`);
    lines.push(`Cancellation: ${booking.cancellationPolicy?.trim() ? booking.cancellationPolicy.trim() : `not set by ${name}: if asked, say the team will confirm. Never describe a usual policy or promise a refund.`}`);
  }
  if (enabled.includes("rooms")) lines.push(`Check-in from ${booking.checkInTime}; check-out by ${booking.checkOutTime}.`);
  if (enabled.includes("tables") || enabled.includes("appointments")) {
    const week = describeWeek(booking.openingHours);
    if (Object.keys(booking.openingHours ?? {}).length) lines.push(`Opening hours: ${week}.`);
  }
  return lines.join("\n");
}

export function registerPolicyExtras(): void {
  addExtras(async (business: Business) => ({ prompt: await policiesPrompt(business) }));
}
