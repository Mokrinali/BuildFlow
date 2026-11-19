import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { rsModeLabel } from "@/lib/i18n/ka";
import { getRsSettings } from "@/server/rs/service";
import { requireUser } from "@/server/session";
import { RsSettingsForm, RsTestButton } from "./rs-forms";

export const metadata: Metadata = { title: "RS.ge" };

export default async function RsPage() {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  const settings = await getRsSettings(user);

  return (
    <>
      <PageHeader title="RS.ge ინტეგრაცია" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <RsSettingsForm
            mode={settings.mode}
            serviceUser={settings.serviceUser}
            hasPassword={settings.hasPassword}
          />
        </Card>
        <Card>
          <h2 className="mb-2 text-lg font-semibold">როგორ მუშაობს</h2>
          <p className="mb-3 text-sm">
            მიმდინარე რეჟიმი: <Badge>{rsModeLabel[settings.mode]}</Badge>
          </p>
          <ul className="mb-4 list-disc space-y-2 pl-5 text-sm">
            <li>
              შეკვეთის გვერდზე, მიწოდებასთან, ჩნდება „RS.ge-დან არჩევა“: მომწოდებლის საიდენტიფიკაციო
              კოდით მოიძებნება მისი ზედნადებები და არჩეულის ნომერი და თარიღი თავისით ჩაიწერება.
            </li>
            <li>
              ხელით შეყვანილი ზედნადები შეიძლება შემოწმდეს RS.ge-ზე: არსებობს და ემთხვევა თუ არა
              მომწოდებელს.
            </li>
            <li>
              BuildFlow RS.ge-ზე მხოლოდ კითხულობს: ზედნადებს არ ქმნის, არ ადასტურებს და არ აუქმებს.
            </li>
            <li>კავშირის გამორთვისას ზედნადები ჩვეულებრივ ხელით ეთითება.</li>
          </ul>
          {settings.mode !== "OFF" && <RsTestButton />}
        </Card>
      </div>
    </>
  );
}
