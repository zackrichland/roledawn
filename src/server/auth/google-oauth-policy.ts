export function hasEnabledGoogleProvider(settings: unknown): boolean {
  if (!settings || typeof settings !== "object") {
    return false;
  }

  const external = Reflect.get(settings, "external");

  return Boolean(
    external &&
      typeof external === "object" &&
      Reflect.get(external, "google") === true,
  );
}
