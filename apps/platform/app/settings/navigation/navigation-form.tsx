"use client";
import { FormField, Input } from "@opentenant/design-system";
import { SettingsForm, SettingsInput } from "../_components/settings-form";
export function NavigationForm({ itemId, label, order, visible, locked }: { itemId: string; label: string; order: number; visible: boolean; locked: string[] }) {
  return <SettingsForm endpoint="/api/settings/navigation" submitLabel="Save navigation">
    <input type="hidden" name="itemId" value={itemId} />
    <SettingsInput name="label" label="Label" value={label} maxLength={40} disabled={locked.includes("label")} />
    <SettingsInput name="order" label="Sort order" value={order} type="number" min={-100} max={100} disabled={locked.includes("order")} />
    {!locked.includes("visible") ? <input type="hidden" name="visible" value="false" /> : null}
    <FormField name="visible" label="Visible" help="Show this item in tenant navigation." disabled={locked.includes("visible")}>{control => <Input {...control} type="checkbox" value="true" defaultChecked={visible} className="size-6" />}</FormField>
  </SettingsForm>;
}
