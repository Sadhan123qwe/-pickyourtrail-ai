"use client";

import { useState } from "react";
import { DESTINATION_OPTIONS } from "./destination-options";
import { INTERESTS, INTEREST_LABELS, type Interest } from "@/lib/catalog/types";
import { CURRENCIES, FIELD_LABELS, type FieldKey, type TripProfile } from "@/lib/planner/profile";
import { Alert, Button, Field, Input, Modal, Select, cn } from "@/components/ui";

/**
 * Structured editor for one discovery topic. Saves through
 * PATCH /api/trips/preferences/[id], the same profile the chat uses.
 */
export function FieldEditor({
  field,
  profile,
  onClose,
  onSave,
}: {
  field: FieldKey | null;
  profile: TripProfile;
  onClose: () => void;
  onSave: (updates: Partial<TripProfile>, clear: FieldKey[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<TripProfile>>({});
  const [text, setText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!field) return null;
  const v = { ...profile, ...draft };
  const set = (patch: Partial<TripProfile>) => setDraft((d) => ({ ...d, ...patch }));
  const num = (s: string) => (s === "" ? null : Math.max(0, Math.round(Number(s))));

  async function save(clear = false) {
    setBusy(true);
    setError(null);
    try {
      const updates = { ...draft };
      if (field === "childrenAges" && text.ages !== undefined) {
        updates.childrenAges = text.ages.split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 17);
      }
      if (field === "requirements" && text.dietary !== undefined) updates.dietary = text.dietary.split(",").map((s) => s.trim()).filter(Boolean);
      if (field === "mustSee" && text.mustSee !== undefined) updates.mustSee = text.mustSee.split(",").map((s) => s.trim()).filter(Boolean);
      await onSave(clear ? {} : updates, clear ? [field!] : []);
      setDraft({});
      setText({});
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Edit: ${FIELD_LABELS[field]}`}>
      <div className="space-y-4">
        {field === "destination" && (
          <Field label="Destination" htmlFor="fe-dest">
            <Select id="fe-dest" value={v.destinationId ?? ""} onChange={(e) => set({ destinationId: e.target.value || null })}>
              <option value="">Choose…</option>
              {DESTINATION_OPTIONS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {field === "duration" && (
          <Field label="Number of days" htmlFor="fe-days">
            <Input id="fe-days" type="number" min={1} max={60} value={v.durationDays ?? ""} onChange={(e) => set({ durationDays: num(e.target.value) })} />
          </Field>
        )}
        {field === "dates" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date" htmlFor="fe-start">
                <Input id="fe-start" type="date" value={v.startDate ?? ""} onChange={(e) => set({ startDate: e.target.value || null, endDate: null })} />
              </Field>
              <Field label="End date" htmlFor="fe-end">
                <Input id="fe-end" type="date" value={v.endDate ?? ""} min={v.startDate ?? undefined} onChange={(e) => set({ endDate: e.target.value || null, durationDays: null })} />
              </Field>
            </div>
            <Field label="Or just a month" htmlFor="fe-month" hint="Leave exact dates empty if you only know the month.">
              <Input id="fe-month" type="month" value={v.travelMonth ?? ""} onChange={(e) => set({ travelMonth: e.target.value || null, startDate: null, endDate: null })} />
            </Field>
            <Field label="Flexibility" htmlFor="fe-flex">
              <Select id="fe-flex" value={v.dateFlexibility ?? ""} onChange={(e) => set({ dateFlexibility: (e.target.value || null) as TripProfile["dateFlexibility"] })}>
                <option value="">Not specified</option>
                <option value="fixed">Fixed dates</option>
                <option value="few_days">± a few days</option>
                <option value="flexible">Flexible</option>
              </Select>
            </Field>
          </>
        )}
        {field === "travellers" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Adults" htmlFor="fe-adults">
              <Input id="fe-adults" type="number" min={1} max={30} value={v.adults ?? ""} onChange={(e) => set({ adults: num(e.target.value) || null })} />
            </Field>
            <Field label="Children (under 18)" htmlFor="fe-children">
              <Input id="fe-children" type="number" min={0} max={20} value={v.children ?? ""} onChange={(e) => set({ children: num(e.target.value), childrenAges: [] })} />
            </Field>
          </div>
        )}
        {field === "childrenAges" && (
          <Field label="Children's ages" htmlFor="fe-ages" hint="Separate with commas, e.g. 5, 8">
            <Input id="fe-ages" value={text.ages ?? profile.childrenAges.join(", ")} onChange={(e) => setText({ ...text, ages: e.target.value })} />
          </Field>
        )}
        {field === "departureCity" && (
          <Field label="Departure city" htmlFor="fe-city">
            <Input id="fe-city" maxLength={60} value={v.departureCity ?? ""} onChange={(e) => set({ departureCity: e.target.value || null })} />
          </Field>
        )}
        {field === "budget" && (
          <>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Field label="Amount" htmlFor="fe-budget">
                <Input id="fe-budget" type="number" min={1} value={v.budgetAmount ?? ""} onChange={(e) => set({ budgetAmount: num(e.target.value) || null })} />
              </Field>
              <Field label="Currency" htmlFor="fe-cur">
                <Select id="fe-cur" value={v.currency} onChange={(e) => set({ currency: e.target.value as TripProfile["currency"] })}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Budget is" htmlFor="fe-scope">
              <Select id="fe-scope" value={v.budgetScope ?? "total"} onChange={(e) => set({ budgetScope: e.target.value as "total" | "per_person" })}>
                <option value="total">Total for everyone</option>
                <option value="per_person">Per person</option>
              </Select>
            </Field>
          </>
        )}
        {field === "budgetIncludesFlights" && (
          <Field label="Does the budget include flights?" htmlFor="fe-bif">
            <Select id="fe-bif" value={v.budgetIncludesFlights === null ? "" : String(v.budgetIncludesFlights)} onChange={(e) => set({ budgetIncludesFlights: e.target.value === "" ? null : e.target.value === "true" })}>
              <option value="">Not specified</option>
              <option value="true">Yes, includes flights</option>
              <option value="false">No, excludes flights</option>
            </Select>
          </Field>
        )}
        {field === "tripType" && (
          <>
            <Field label="Trip type" htmlFor="fe-type">
              <Select id="fe-type" value={v.tripType ?? ""} onChange={(e) => set({ tripType: (e.target.value || null) as TripProfile["tripType"] })}>
                <option value="">Not specified</option>
                {["family", "couple", "honeymoon", "friends", "solo", "business", "group"].map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Occasion (optional)" htmlFor="fe-occ">
              <Input id="fe-occ" maxLength={80} value={v.occasion ?? ""} onChange={(e) => set({ occasion: e.target.value || null })} />
            </Field>
          </>
        )}
        {field === "interests" && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Interests</legend>
            <div className="flex flex-wrap gap-2">
              {INTERESTS.map((i) => {
                const on = v.interests.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ interests: on ? v.interests.filter((x) => x !== i) : [...v.interests, i as Interest] })}
                    className={cn("rounded-full border px-3 py-1 text-sm", on ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-surface-muted")}
                  >
                    {INTEREST_LABELS[i]}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        {field === "pace" && (
          <Field label="Pace" htmlFor="fe-pace">
            <Select id="fe-pace" value={v.pace ?? ""} onChange={(e) => set({ pace: (e.target.value || null) as TripProfile["pace"] })}>
              <option value="">Not specified</option>
              <option value="relaxed">Relaxed</option>
              <option value="balanced">Balanced</option>
              <option value="packed">Packed</option>
            </Select>
          </Field>
        )}
        {field === "accommodation" && (
          <Field label="Stay" htmlFor="fe-acc">
            <Select id="fe-acc" value={v.accommodation ?? ""} onChange={(e) => set({ accommodation: (e.target.value || null) as TripProfile["accommodation"] })}>
              <option value="">Not specified</option>
              <option value="budget">Budget / 3★</option>
              <option value="midrange">Comfort / 4★</option>
              <option value="luxury">Luxury / 5★</option>
            </Select>
          </Field>
        )}
        {field === "transport" && (
          <Field label="Flights" htmlFor="fe-flights">
            <Select
              id="fe-flights"
              value={v.needsFlights === false ? "own" : (v.flightClass ?? "")}
              onChange={(e) =>
                set(e.target.value === "own" ? { needsFlights: false, flightClass: null } : { needsFlights: e.target.value ? true : null, flightClass: (e.target.value || null) as TripProfile["flightClass"] })
              }
            >
              <option value="">Not specified</option>
              <option value="economy">Include economy flights</option>
              <option value="premium_economy">Include premium economy</option>
              <option value="business">Include business class</option>
              <option value="own">I&apos;ll book flights myself</option>
            </Select>
          </Field>
        )}
        {field === "requirements" && (
          <>
            <Field label="Dietary needs" htmlFor="fe-diet" hint="Comma-separated, e.g. vegetarian, Jain">
              <Input id="fe-diet" value={text.dietary ?? profile.dietary.join(", ")} onChange={(e) => setText({ ...text, dietary: e.target.value })} />
            </Field>
            <Field label="Accessibility or other needs" htmlFor="fe-access">
              <Input id="fe-access" maxLength={200} value={v.accessibility ?? ""} onChange={(e) => set({ accessibility: e.target.value || null })} />
            </Field>
          </>
        )}
        {field === "mustSee" && (
          <>
            <Field label="Must-see places" htmlFor="fe-must" hint="Comma-separated">
              <Input id="fe-must" value={text.mustSee ?? profile.mustSee.join(", ")} onChange={(e) => setText({ ...text, mustSee: e.target.value })} />
            </Field>
            <Field label="Special requests" htmlFor="fe-req">
              <Input id="fe-req" maxLength={300} value={v.specialRequests ?? ""} onChange={(e) => set({ specialRequests: e.target.value || null })} />
            </Field>
          </>
        )}
        {error && <Alert tone="red">{error}</Alert>}
        <div className="flex flex-wrap justify-between gap-2 pt-2">
          <Button variant="ghost" onClick={() => save(true)} disabled={busy}>
            Clear &amp; ask again
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => save(false)} loading={busy}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
