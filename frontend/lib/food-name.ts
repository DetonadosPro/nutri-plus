export function foodDisplayName(food: { description: string; displayName?: string | null }) {
  return food.displayName?.trim() || food.description;
}
