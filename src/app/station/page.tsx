import Link from "next/link";
import { requireRole } from "@/server/session";
import { getActiveCampStations } from "@/server/stations";
import { PageHelp } from "@/app/_components/PageHelp";

export const dynamic = "force-dynamic";

/** Station picker — a volunteer chooses the station they're working. */
export default async function StationPickerPage() {
  await requireRole("STATION_VOLUNTEER", "DOCTOR");
  const { campName, stations } = await getActiveCampStations();

  return (
    <main className="mx-auto max-w-screen-sm px-4 py-8">
      <PageHelp
        id="station-picker"
        title="Stations"
        subtitle={campName ? `${campName} — pick your station` : "No active camp."}
        items={[
          {
            label: "Pick your station",
            body: "Tap the station you're staffing to open its live patient queue.",
          },
          {
            label: "Color dots",
            body: "Each station's color matches the dots on patient badges, so you can spot who belongs in your line.",
          },
        ]}
      />

      <ul className="mt-6 space-y-2">
        {stations.map((s) => (
          <li key={s.key}>
            <Link
              href={`/station/${s.key}`}
              className="flex min-h-tap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3"
            >
              <span
                className="inline-block h-4 w-4 rounded-full"
                style={{ backgroundColor: s.colorHex ?? "#888" }}
              />
              <span className="font-medium">{s.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
