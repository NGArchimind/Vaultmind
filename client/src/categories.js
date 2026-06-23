// Non-project "Other" time reasons. Labels only — no pay/allowance logic anywhere.
export const CATEGORIES = [
  { value: "holiday",       label: "Holiday" },
  { value: "sickness",      label: "Sickness" },
  { value: "bank_holiday",  label: "Bank Holiday" },
  { value: "training",      label: "Training / CPD" },
  { value: "internal",      label: "Internal / Non-billable" },
  { value: "maternity",     label: "Maternity" },
  { value: "paternity",     label: "Paternity" },
  { value: "compassionate", label: "Compassionate" },
  { value: "medical",       label: "Medical Appointment" },
  { value: "unpaid",        label: "Unpaid Leave" },
  { value: "unauthorised",  label: "Unauthorised" },
  { value: "other",         label: "Other" },
];

export function categoryLabel(value) {
  return CATEGORIES.find(c => c.value === value)?.label || value;
}
