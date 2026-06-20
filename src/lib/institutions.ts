export function institutionLabel(institution: string) {
  return {
    CityUHK: "CityU",
    LingnanU: "LingU",
  }[institution] || institution;
}
